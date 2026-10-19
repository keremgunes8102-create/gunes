import { sql } from '../db.ts';
import { config } from '../config.ts';
import { HttpError, badRequest, type Router } from '../http.ts';
import { createSession, destroyAllSessions, destroySession, membershipsOf, requireUser } from '../auth.ts';
import { burnPasswordCheck, hashPassword, rateLimit, randomToken, sha256, sixDigitCode, verifyPassword } from '../security.ts';
import { emailSchema, optionalPhone, passwordSchema, trimmed, z } from '../validation.ts';
import { audit } from '../audit.ts';
import { notify } from '../notify.ts';
import { emailConfigured, smsConfigured } from '../config.ts';
import { LEGAL_DOC_VERSION } from '../../shared/constants.ts';

const registerSchema = z.object({
  full_name: trimmed(2, 120),
  email: emailSchema,
  phone: optionalPhone,
  password: passwordSchema,
  accept_terms: z.literal(true, { errorMap: () => ({ message: 'Devam etmek için kullanım koşullarını kabul etmelisiniz.' }) }),
  privacy_notice_ack: z.literal(true, { errorMap: () => ({ message: 'Aydınlatma metnini okuduğunuzu onaylamalısınız.' }) }),
  marketing_email: z.boolean().optional().default(false),
  marketing_sms: z.boolean().optional().default(false),
});

export async function getMe(userId: string) {
  const memberships = await membershipsOf(userId);
  const [{ unread }] = await sql<{ unread: number }[]>`SELECT count(*)::int AS unread FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`;
  return { memberships, unreadNotifications: unread };
}

export function registerAuthRoutes(r: Router) {
  r.get('/api/auth/me', async (ctx) => {
    if (!ctx.user) return { user: null, csrfToken: null };
    const extra = await getMe(ctx.user.id);
    return { user: ctx.user, csrfToken: ctx.session?.csrf_token, ...extra };
  });

  r.post('/api/auth/register', async (ctx) => {
    rateLimit(`register:${ctx.ip}`, 10, 3_600_000);
    const body = await ctx.json(registerSchema);
    const [exists] = await sql`SELECT 1 FROM users WHERE lower(email) = ${body.email}`;
    if (exists) throw new HttpError(409, 'email_taken', 'Bu e-posta adresiyle kayıtlı bir hesap var. Giriş yapmayı deneyin.', { email: 'Bu e-posta zaten kayıtlı.' });
    if (body.phone) {
      const [p] = await sql`SELECT 1 FROM users WHERE phone = ${body.phone} AND account_status <> 'deleted'`;
      if (p) throw new HttpError(409, 'phone_taken', 'Bu telefon numarası başka bir hesapta kayıtlı.', { phone: 'Bu numara zaten kayıtlı.' });
    }
    const hash = await hashPassword(body.password);
    const user = await sql.begin(async (tx) => {
      const [u] = await tx<{ id: string }[]>`
        INSERT INTO users (full_name, email, phone, password_hash) VALUES (${body.full_name}, ${body.email}, ${body.phone}, ${hash}) RETURNING id`;
      await tx`INSERT INTO notification_preferences (user_id) VALUES (${u.id})`;
      const consents: [string, boolean][] = [
        ['terms', true],
        ['privacy_notice', true],
        ['marketing_email', body.marketing_email],
        ['marketing_sms', body.marketing_sms],
      ];
      for (const [type, granted] of consents) {
        await tx`INSERT INTO consents (user_id, consent_type, granted, document_version, ip) VALUES (${u.id}, ${type}, ${granted}, ${LEGAL_DOC_VERSION}, ${ctx.ip})`;
      }
      await notify(tx, { userId: u.id, type: 'welcome', title: "KOLTUK'a hoş geldiniz", body: 'Hesabınız oluşturuldu. E-posta adresinizi doğrulayarak hesabınızı güvenceye alabilirsiniz.', link: '/hesabim/profil', dedupeKey: 'welcome' });
      await audit({ actor: u.id, action: 'user.register', targetType: 'user', targetId: u.id, ip: ctx.ip }, tx);
      return u;
    });
    const csrf = await createSession(ctx, user.id);
    ctx.status = 201;
    const [u] = await sql`SELECT id, full_name, email, phone, platform_role, account_status, email_verified_at, phone_verified_at FROM users WHERE id = ${user.id}`;
    return { user: u, csrfToken: csrf, memberships: [], unreadNotifications: 1 };
  });

  r.post('/api/auth/login', async (ctx) => {
    const body = await ctx.json(z.object({ email: z.string().trim().toLowerCase().min(1).max(200), password: z.string().min(1).max(200) }));
    rateLimit(`login-ip:${ctx.ip}`, 30, 15 * 60_000);
    rateLimit(`login-email:${body.email}`, 8, 15 * 60_000);
    const [u] = await sql<{ id: string; password_hash: string; account_status: string }[]>`
      SELECT id, password_hash, account_status FROM users WHERE lower(email) = ${body.email}`;
    if (!u) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, 'invalid_credentials', 'E-posta veya şifre hatalı.');
    }
    if (!(await verifyPassword(body.password, u.password_hash))) {
      await audit({ actor: u.id, action: 'user.login_failed', targetType: 'user', targetId: u.id, ip: ctx.ip });
      throw new HttpError(401, 'invalid_credentials', 'E-posta veya şifre hatalı.');
    }
    if (u.account_status === 'suspended') throw new HttpError(403, 'suspended', 'Hesabınız askıya alınmış. Destek için bizimle iletişime geçin.');
    if (u.account_status === 'deleted') throw new HttpError(401, 'invalid_credentials', 'E-posta veya şifre hatalı.');
    if (ctx.session) await destroySession(ctx);
    const csrf = await createSession(ctx, u.id);
    await audit({ actor: u.id, action: 'user.login', targetType: 'user', targetId: u.id, ip: ctx.ip });
    const [user] = await sql`SELECT id, full_name, email, phone, platform_role, account_status, email_verified_at, phone_verified_at FROM users WHERE id = ${u.id}`;
    return { user, csrfToken: csrf, ...(await getMe(u.id)) };
  });

  r.post('/api/auth/logout', async (ctx) => {
    await destroySession(ctx);
    return { ok: true };
  });

  // --- Doğrulama kodları ---------------------------------------------------
  r.post('/api/auth/verify/request', async (ctx) => {
    const user = requireUser(ctx);
    const { channel } = await ctx.json(z.object({ channel: z.enum(['email', 'sms']) }));
    rateLimit(`verify:${user.id}:${channel}`, 5, 3_600_000);
    if (channel === 'sms' && !user.phone) throw badRequest('Önce profilinize telefon numarası ekleyin.');
    if (channel === 'email' && user.email_verified_at) throw badRequest('E-posta adresiniz zaten doğrulanmış.');
    if (channel === 'sms' && user.phone_verified_at) throw badRequest('Telefon numaranız zaten doğrulanmış.');
    const configured = channel === 'email' ? emailConfigured() : smsConfigured();
    if (!configured && !config.devShowCodes) {
      throw new HttpError(503, 'not_configured', channel === 'email'
        ? 'E-posta servisi henüz yapılandırılmadı; doğrulama kodu gönderilemiyor.'
        : 'SMS servisi henüz yapılandırılmadı; doğrulama kodu gönderilemiyor.');
    }
    const code = sixDigitCode();
    await sql`UPDATE verification_codes SET consumed_at = now() WHERE user_id = ${user.id} AND channel = ${channel} AND consumed_at IS NULL`;
    await sql`INSERT INTO verification_codes (user_id, channel, code_hash, expires_at) VALUES (${user.id}, ${channel}, ${sha256(code)}, now() + interval '15 minutes')`;
    if (configured) {
      await sql`INSERT INTO outbound_messages (user_id, channel, recipient, subject, body) VALUES (${user.id}, ${channel},
        ${channel === 'email' ? user.email : user.phone!}, 'KOLTUK doğrulama kodu', ${`KOLTUK doğrulama kodunuz: ${code}. Kod 15 dakika geçerlidir.`})`;
      return { sent: true };
    }
    // Geliştirme modu: servis yok, kod gönderilmedi — yalnızca yerel geliştirme için ekranda gösterilir.
    return { sent: false, devCode: code, message: 'Geliştirme modu: mesaj servisi yapılandırılmadığı için kod gönderilmedi.' };
  });

  r.post('/api/auth/verify/confirm', async (ctx) => {
    const user = requireUser(ctx);
    const { channel, code } = await ctx.json(z.object({ channel: z.enum(['email', 'sms']), code: z.string().trim().regex(/^\d{6}$/, '6 haneli kodu girin.') }));
    rateLimit(`verify-confirm:${user.id}`, 10, 15 * 60_000);
    const [v] = await sql<{ id: string; code_hash: string; attempts: number }[]>`
      SELECT id, code_hash, attempts FROM verification_codes
      WHERE user_id = ${user.id} AND channel = ${channel} AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`;
    if (!v || v.attempts >= 5) throw badRequest('Kodun süresi dolmuş. Yeni kod isteyin.');
    if (v.code_hash !== sha256(code)) {
      await sql`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ${v.id}`;
      throw new HttpError(422, 'invalid_code', 'Kod hatalı.', { code: 'Kod hatalı.' });
    }
    await sql`UPDATE verification_codes SET consumed_at = now() WHERE id = ${v.id}`;
    if (channel === 'email') await sql`UPDATE users SET email_verified_at = now() WHERE id = ${user.id}`;
    else await sql`UPDATE users SET phone_verified_at = now() WHERE id = ${user.id}`;
    await audit({ actor: user.id, action: `user.verify_${channel}`, targetType: 'user', targetId: user.id, ip: ctx.ip });
    return { ok: true };
  });

  // --- Şifre işlemleri ------------------------------------------------------
  r.post('/api/auth/password/forgot', async (ctx) => {
    const { email } = await ctx.json(z.object({ email: emailSchema }));
    rateLimit(`forgot:${ctx.ip}`, 5, 3_600_000);
    rateLimit(`forgot-email:${email}`, 3, 3_600_000);
    const [u] = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE lower(email) = ${email} AND account_status IN ('active', 'deletion_requested')`;
    let devLink: string | undefined;
    if (u) {
      const token = randomToken(32);
      await sql`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (${u.id}, ${sha256(token)}, now() + interval '1 hour')`;
      const link = `${config.appUrl}/sifre-sifirla?token=${token}`;
      if (emailConfigured()) {
        await sql`INSERT INTO outbound_messages (user_id, channel, recipient, subject, body) VALUES (${u.id}, 'email', ${u.email},
          'KOLTUK şifre sıfırlama', ${`Şifrenizi sıfırlamak için bağlantı (1 saat geçerli):\n${link}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayın.`})`;
      } else if (config.devShowCodes) {
        devLink = `/sifre-sifirla?token=${token}`;
      }
    }
    // Hesabın var olup olmadığını ifşa etmemek için her durumda aynı yanıt
    return {
      ok: true,
      emailConfigured: emailConfigured(),
      message: 'Bu adrese kayıtlı bir hesap varsa şifre sıfırlama bağlantısı gönderilecektir.',
      ...(devLink ? { devLink } : {}),
    };
  });

  r.post('/api/auth/password/reset', async (ctx) => {
    const body = await ctx.json(z.object({ token: z.string().min(20).max(100), password: passwordSchema }));
    rateLimit(`reset:${ctx.ip}`, 10, 3_600_000);
    const [pr] = await sql<{ id: string; user_id: string }[]>`
      SELECT id, user_id FROM password_resets WHERE token_hash = ${sha256(body.token)} AND consumed_at IS NULL AND expires_at > now()`;
    if (!pr) throw badRequest('Bağlantı geçersiz veya süresi dolmuş. Yeniden şifre sıfırlama isteyin.');
    const hash = await hashPassword(body.password);
    await sql.begin(async (tx) => {
      await tx`UPDATE users SET password_hash = ${hash} WHERE id = ${pr.user_id}`;
      await tx`UPDATE password_resets SET consumed_at = now() WHERE user_id = ${pr.user_id} AND consumed_at IS NULL`;
      await tx`DELETE FROM sessions WHERE user_id = ${pr.user_id}`;
      await audit({ actor: pr.user_id, action: 'user.password_reset', targetType: 'user', targetId: pr.user_id, ip: ctx.ip }, tx);
    });
    return { ok: true };
  });

  r.post('/api/auth/password/change', async (ctx) => {
    const user = requireUser(ctx);
    const body = await ctx.json(z.object({ current_password: z.string().min(1), new_password: passwordSchema }));
    rateLimit(`pwchange:${user.id}`, 5, 15 * 60_000);
    const [u] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${user.id}`;
    if (!(await verifyPassword(body.current_password, u.password_hash))) {
      throw new HttpError(422, 'invalid_password', 'Mevcut şifre hatalı.', { current_password: 'Mevcut şifre hatalı.' });
    }
    await sql`UPDATE users SET password_hash = ${await hashPassword(body.new_password)} WHERE id = ${user.id}`;
    await destroyAllSessions(user.id, ctx.session?.id);
    await audit({ actor: user.id, action: 'user.password_change', targetType: 'user', targetId: user.id, ip: ctx.ip });
    return { ok: true };
  });
}
