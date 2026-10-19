// Zamanlanmış görevler: bekleyen taleplerin süresinin dolması, hatırlatmalar, e-posta/SMS kuyruğu,
// süresi dolan oturumların temizlenmesi ve hesap silme taleplerinin işlenmesi.
// Varsayılan olarak web süreci içinde dakikada bir çalışır. Birden fazla sunucuda yalnızca biri çalıştırmalıdır
// (RUN_JOBS_IN_PROCESS=0 ve ayrı "npm run jobs" süreci), ayrıca her görev danışma kilidiyle tekilleştirilir.

import { sql } from './db.ts';
import { expireStalePending } from './booking.ts';
import { dispatchOutbound, notify } from './notify.ts';
import { formatDateTime } from '../shared/format.ts';
import { anonymizeUser } from './users.ts';

export async function sendReminders() {
  // Kullanıcının tercih ettiği süre kala (varsayılan 24 saat) onaylı randevular için tek seferlik hatırlatma
  const rows = await sql<{ id: string; customer_user_id: string; start_at: Date; public_reference: string; name: string; timezone: string; reminder_hours: number }[]>`
    SELECT a.id, a.customer_user_id, a.start_at, a.public_reference, b.name, b.timezone, COALESCE(p.reminder_hours, 24) AS reminder_hours
    FROM appointments a
    JOIN businesses b ON b.id = a.business_id
    LEFT JOIN notification_preferences p ON p.user_id = a.customer_user_id
    WHERE a.status = 'confirmed' AND a.customer_user_id IS NOT NULL
      AND COALESCE(p.reminders, true)
      AND a.start_at > now()
      AND a.start_at <= now() + make_interval(hours => COALESCE(p.reminder_hours, 24))
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = a.customer_user_id AND n.dedupe_key = 'reminder:' || a.id::text)`;
  for (const r of rows) {
    await notify(sql, {
      userId: r.customer_user_id,
      type: 'appointment_reminder',
      title: 'Randevunuz yaklaşıyor',
      body: `${r.name} — ${formatDateTime(r.start_at, r.timezone)}. Randevu no: ${r.public_reference}`,
      link: `/hesabim/randevular/${r.public_reference}`,
      dedupeKey: `reminder:${r.id}`, // aynı randevu için ikinci hatırlatma oluşturulmaz
      channels: { email: true, sms: true },
    });
  }
  return rows.length;
}

export async function processAccountDeletions() {
  const graceDays = Number(process.env.ACCOUNT_DELETION_GRACE_DAYS ?? 14);
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE account_status = 'deletion_requested' AND deletion_requested_at < now() - make_interval(days => ${graceDays})`;
  for (const r of rows) await anonymizeUser(r.id, null);
  return rows.length;
}

export async function runJobsOnce() {
  // Tek seferde yalnızca bir süreç çalıştırsın
  return sql.begin(async (tx) => {
    const [{ locked }] = await tx<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(424242) AS locked`;
    if (!locked) return { skipped: true };
    const expired = await expireStalePending(sql);
    const reminders = await sendReminders();
    const outbound = await dispatchOutbound();
    const sessions = await sql`DELETE FROM sessions WHERE expires_at < now()`;
    const deletions = await processAccountDeletions();
    return { expired, reminders, outbound, sessionsCleared: sessions.count, deletions };
  });
}

export function startJobRunner(intervalMs = 60_000) {
  const tick = () =>
    runJobsOnce().catch((e) => {
      console.error('[GÖREV] hata:', (e as Error).message);
    });
  setTimeout(tick, 5_000).unref();
  setInterval(tick, intervalMs).unref();
}
