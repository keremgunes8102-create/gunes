import { config } from './config.ts';
import { sql, type Db } from './db.ts';
import { forbidden, notFound, unauthorized, type Ctx, type SessionUser } from './http.ts';
import { randomToken, sha256 } from './security.ts';
import type { MemberRole } from '../shared/constants.ts';

export const SESSION_COOKIE = 'koltuk_session';

const userColumns = sql`u.id, u.full_name, u.email, u.phone, u.platform_role, u.account_status, u.email_verified_at, u.phone_verified_at`;

export async function createSession(ctx: Ctx, userId: string) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
  await sql`
    INSERT INTO sessions (id, user_id, csrf_token, expires_at, ip, user_agent)
    VALUES (${sha256(token)}, ${userId}, ${csrf}, ${expires}, ${ctx.ip}, ${String(ctx.req.headers['user-agent'] ?? '').slice(0, 300)})`;
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${userId}`;
  ctx.setCookie(SESSION_COOKIE, token, { maxAge: config.sessionDays * 86400, httpOnly: true, sameSite: 'Lax' });
  ctx.session = { id: sha256(token), csrf_token: csrf };
  return csrf;
}

export async function loadSession(ctx: Ctx) {
  const token = ctx.cookies[SESSION_COOKIE];
  if (!token || token.length > 100) return;
  const rows = await sql<(SessionUser & { session_id: string; csrf_token: string })[]>`
    SELECT ${userColumns}, s.id AS session_id, s.csrf_token
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sha256(token)} AND s.expires_at > now() AND u.account_status IN ('active', 'deletion_requested')`;
  const row = rows[0];
  if (!row) {
    ctx.setCookie(SESSION_COOKIE, '', { maxAge: 0 });
    return;
  }
  const { session_id, csrf_token, ...user } = row;
  ctx.user = user;
  ctx.session = { id: session_id, csrf_token };
}

export async function destroySession(ctx: Ctx) {
  if (ctx.session) await sql`DELETE FROM sessions WHERE id = ${ctx.session.id}`;
  ctx.setCookie(SESSION_COOKIE, '', { maxAge: 0 });
  ctx.user = null;
  ctx.session = null;
}

export async function destroyAllSessions(userId: string, exceptSessionId?: string) {
  if (exceptSessionId) await sql`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${exceptSessionId}`;
  else await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

export function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) throw unauthorized();
  if (ctx.user.account_status !== 'active' && ctx.user.account_status !== 'deletion_requested') throw forbidden('Hesabınız aktif değil.');
  return ctx.user;
}

export function requireAdmin(ctx: Ctx): SessionUser {
  const u = requireUser(ctx);
  if (u.platform_role !== 'admin') throw forbidden();
  return u;
}

export interface Membership {
  business_id: string;
  role: MemberRole;
  employee_id: string | null;
}

/**
 * İşletme üyeliğini sunucu tarafında doğrular. Kullanıcının bu işletmede kabul edilmiş üyeliği yoksa 404 döner
 * (işletmenin varlığını ifşa etmemek için). Rol yetersizse 403.
 */
export async function requireMember(ctx: Ctx, businessId: string, roles: MemberRole[] = ['owner', 'manager', 'staff'], db: Db = sql): Promise<Membership> {
  const u = requireUser(ctx);
  const rows = await db<Membership[]>`
    SELECT business_id, role, employee_id FROM business_members
    WHERE business_id = ${businessId} AND user_id = ${u.id} AND invitation_status = 'accepted'`;
  const m = rows[0];
  if (!m) throw notFound('İşletme bulunamadı.');
  if (!roles.includes(m.role)) throw forbidden('Bu işlem için işletme yöneticisi yetkisi gerekir.');
  return m;
}

export async function membershipsOf(userId: string) {
  return sql<{ business_id: string; role: MemberRole; employee_id: string | null; name: string; slug: string; verification_status: string; setup_step: number }[]>`
    SELECT m.business_id, m.role, m.employee_id, b.name, b.slug, b.verification_status, b.setup_step
    FROM business_members m JOIN businesses b ON b.id = m.business_id
    WHERE m.user_id = ${userId} AND m.invitation_status = 'accepted'
    ORDER BY (m.role = 'owner') DESC, b.created_at`;
}
