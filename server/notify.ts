// Bildirimler: uygulama içi bildirim her zaman oluşturulur. E-posta/SMS kuyruğa alınır;
// servis yapılandırılmamışsa gönderilmiş gibi gösterilmez ('skipped_unconfigured').

import { config, emailConfigured, smsConfigured } from './config.ts';
import { sql, type Db } from './db.ts';

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  /** Aynı anahtarla ikinci bildirim oluşturulmaz (tekrar gönderimi engeller) */
  dedupeKey?: string;
  channels?: { email?: boolean; sms?: boolean };
}

export async function notify(db: Db, n: NotifyInput) {
  await db`
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    VALUES (${n.userId}, ${n.type}, ${n.title}, ${n.body}, ${n.link ?? null}, ${n.dedupeKey ?? null})
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`;

  if (!n.channels?.email && !n.channels?.sms) return;
  const [u] = await db<{ email: string; phone: string | null; email_service: boolean | null; sms_service: boolean | null; account_status: string }[]>`
    SELECT u.email, u.phone, p.email_service, p.sms_service, u.account_status
    FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id WHERE u.id = ${n.userId}`;
  if (!u || u.account_status === 'deleted') return;
  const link = n.link ? `${config.appUrl}${n.link}` : '';
  if (n.channels.email) {
    const allowed = u.email_service !== false;
    await db`
      INSERT INTO outbound_messages (user_id, channel, recipient, subject, body, dedupe_key, status)
      VALUES (${n.userId}, 'email', ${u.email}, ${n.title}, ${`${n.body}${link ? `\n\n${link}` : ''}`},
              ${n.dedupeKey ? `email:${n.userId}:${n.dedupeKey}` : null}, ${allowed ? 'queued' : 'skipped_preference'})
      ON CONFLICT (dedupe_key) DO NOTHING`;
  }
  if (n.channels.sms && u.phone) {
    const allowed = u.sms_service !== false;
    await db`
      INSERT INTO outbound_messages (user_id, channel, recipient, body, dedupe_key, status)
      VALUES (${n.userId}, 'sms', ${u.phone}, ${`KOLTUK: ${n.body}`.slice(0, 300)},
              ${n.dedupeKey ? `sms:${n.userId}:${n.dedupeKey}` : null}, ${allowed ? 'queued' : 'skipped_preference'})
      ON CONFLICT (dedupe_key) DO NOTHING`;
  }
}

/** İşletmenin sahibi ve yöneticilerine bildirim */
export async function notifyBusinessManagers(db: Db, businessId: string, n: Omit<NotifyInput, 'userId'>) {
  const rows = await db<{ user_id: string }[]>`
    SELECT user_id FROM business_members
    WHERE business_id = ${businessId} AND invitation_status = 'accepted' AND role IN ('owner', 'manager') AND user_id IS NOT NULL`;
  for (const r of rows) await notify(db, { ...n, userId: r.user_id });
}

// ---------------------------------------------------------------------------
// Gönderim (zamanlanmış görev tarafından çağrılır)
// ---------------------------------------------------------------------------
async function sendEmail(to: string, subject: string, body: string): Promise<string> {
  if (config.email.provider === 'resend') {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.email.from, to, subject, text: body }),
    });
    if (!r.ok) throw new Error(`E-posta servisi ${r.status} döndürdü`);
    const j = (await r.json()) as { id?: string };
    return j.id ?? 'ok';
  }
  throw new Error(`Desteklenmeyen e-posta sağlayıcısı: ${config.email.provider}`);
}

async function sendSms(to: string, body: string): Promise<string> {
  if (config.sms.provider === 'netgsm') {
    const params = new URLSearchParams({
      usercode: config.sms.username,
      password: config.sms.password,
      gsmno: to.replace(/^\+/, ''),
      message: body,
      msgheader: config.sms.header,
      dil: 'TR',
    });
    const r = await fetch(`https://api.netgsm.com.tr/sms/send/get?${params}`);
    const text = (await r.text()).trim();
    if (!r.ok || !/^(00|01|02)/.test(text)) throw new Error(`SMS servisi hata kodu döndürdü: ${text.slice(0, 20)}`);
    return text.split(' ')[1] ?? text;
  }
  throw new Error(`Desteklenmeyen SMS sağlayıcısı: ${config.sms.provider}`);
}

export async function dispatchOutbound(limit = 50) {
  const rows = await sql<{ id: string; channel: 'email' | 'sms'; recipient: string; subject: string | null; body: string; attempts: number }[]>`
    UPDATE outbound_messages SET attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM outbound_messages WHERE status = 'queued' ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING id, channel, recipient, subject, body, attempts`;
  let sent = 0;
  let skipped = 0;
  for (const m of rows) {
    const configured = m.channel === 'email' ? emailConfigured() : smsConfigured();
    if (!configured) {
      await sql`UPDATE outbound_messages SET status = 'skipped_unconfigured', last_error = 'Servis yapılandırılmadı' WHERE id = ${m.id}`;
      skipped++;
      continue;
    }
    try {
      const ref = m.channel === 'email' ? await sendEmail(m.recipient, m.subject ?? 'KOLTUK', m.body) : await sendSms(m.recipient, m.body);
      await sql`UPDATE outbound_messages SET status = 'sent', sent_at = now(), provider_ref = ${ref}, last_error = null WHERE id = ${m.id}`;
      sent++;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await sql`UPDATE outbound_messages SET status = ${m.attempts >= 5 ? 'failed' : 'queued'}, last_error = ${msg} WHERE id = ${m.id}`;
    }
  }
  return { processed: rows.length, sent, skipped };
}

export function integrationStatus() {
  return {
    email: emailConfigured() ? { configured: true, provider: config.email.provider } : { configured: false },
    sms: smsConfigured() ? { configured: true, provider: config.sms.provider } : { configured: false },
    payments: { configured: false },
    maps: { configured: false, note: 'Harita gösterimi OpenStreetMap gömülü görünümüyle yapılır; ücretli harita servisi bağlı değil.' },
  };
}
