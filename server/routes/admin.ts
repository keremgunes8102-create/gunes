// Platform yönetici API'si. Tüm uç noktalar sunucu tarafında platform_role = 'admin' kontrolü yapar.
import { sql } from '../db.ts';
import { badRequest, notFound, type Router } from '../http.ts';
import { requireAdmin } from '../auth.ts';
import { audit } from '../audit.ts';
import { notify, notifyBusinessManagers, integrationStatus } from '../notify.ts';
import { anonymizeUser } from '../users.ts';
import { optionalText, trimmed, uuid, z } from '../validation.ts';
import { BUSINESS_TYPES } from '../../shared/constants.ts';
import { slugify } from '../../shared/format.ts';

export function registerAdminRoutes(r: Router) {
  r.get('/api/admin/stats', async (ctx) => {
    requireAdmin(ctx);
    const [s] = await sql`
      SELECT (SELECT count(*)::int FROM users WHERE account_status <> 'deleted') AS users,
             (SELECT count(*)::int FROM users WHERE created_at > now() - interval '30 days') AS users_30d,
             (SELECT count(*)::int FROM businesses WHERE verification_status = 'approved') AS businesses_approved,
             (SELECT count(*)::int FROM businesses WHERE verification_status = 'pending_review') AS businesses_pending,
             (SELECT count(*)::int FROM businesses WHERE is_demo) AS businesses_demo,
             (SELECT count(*)::int FROM appointments WHERE created_at > now() - interval '30 days') AS appointments_30d,
             (SELECT count(*)::int FROM appointments WHERE status = 'completed' AND start_at > now() - interval '30 days') AS completed_30d,
             (SELECT count(*)::int FROM appointments WHERE status IN ('cancelled_by_customer', 'cancelled_by_business') AND start_at > now() - interval '30 days') AS cancelled_30d,
             (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports,
             (SELECT count(*)::int FROM data_requests WHERE status IN ('open', 'in_progress')) AS open_data_requests,
             (SELECT count(*)::int FROM reviews WHERE created_at > now() - interval '30 days') AS reviews_30d`;
    const daily = await sql`SELECT to_char(created_at AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM appointments WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`;
    return { stats: s, daily, integrations: integrationStatus() };
  });

  // --- İşletmeler ----------------------------------------------------------
  r.get('/api/admin/businesses', async (ctx) => {
    requireAdmin(ctx);
    const status = ctx.query.get('status');
    const q = ctx.query.get('q')?.trim() || null;
    return sql`
      SELECT b.id, b.name, b.slug, b.business_type, b.city, b.district, b.verification_status, b.publication_status, b.is_demo,
             b.submitted_at, b.approved_at, b.created_at, b.location_verified, b.verification_note,
             u.full_name AS owner_name, u.email AS owner_email,
             (SELECT count(*)::int FROM appointments a WHERE a.business_id = b.id) AS appointment_count,
             (SELECT count(*)::int FROM reports rp WHERE rp.target_type = 'business' AND rp.target_id = b.id AND rp.status = 'open') AS open_reports
      FROM businesses b JOIN users u ON u.id = b.owner_user_id
      WHERE (${status}::text IS NULL OR b.verification_status = ${status})
        AND (${q}::text IS NULL OR b.name ILIKE ${'%' + (q ?? '') + '%'} OR u.email ILIKE ${'%' + (q ?? '') + '%'})
      ORDER BY CASE WHEN b.verification_status = 'pending_review' THEN 0 ELSE 1 END, b.submitted_at NULLS LAST, b.created_at DESC
      LIMIT 300`;
  });

  r.get('/api/admin/businesses/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = uuid.parse(ctx.params.id);
    const [b] = await sql`SELECT b.*, u.full_name AS owner_name, u.email AS owner_email, u.phone AS owner_phone, u.email_verified_at AS owner_email_verified
      FROM businesses b JOIN users u ON u.id = b.owner_user_id WHERE b.id = ${id}`;
    if (!b) throw notFound();
    const [services, employees, stations, hours, history] = await Promise.all([
      sql`SELECT name, duration_minutes, price_type, price_amount::text, price_max_amount::text, is_active FROM services WHERE business_id = ${id} ORDER BY sort_order`,
      sql`SELECT display_name, title, is_active, accepts_bookings FROM employees WHERE business_id = ${id} ORDER BY sort_order`,
      sql`SELECT name, station_type, capacity, is_active FROM stations WHERE business_id = ${id}`,
      sql`SELECT weekday, to_char(opening_time, 'HH24:MI') AS start, to_char(closing_time, 'HH24:MI') AS end FROM business_hours WHERE business_id = ${id} ORDER BY weekday, opening_time`,
      sql`SELECT l.action, l.metadata, l.created_at, u.full_name AS actor FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id
          WHERE l.business_id = ${id} AND l.action LIKE 'admin.%' ORDER BY l.created_at DESC LIMIT 20`,
    ]);
    return { business: b, services, employees, stations, hours, history };
  });

  r.post('/api/admin/businesses/:id/decision', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = uuid.parse(ctx.params.id);
    const body = await ctx.json(
      z.object({ decision: z.enum(['approve', 'reject', 'suspend', 'reinstate', 'request_info']), note: optionalText(1000) }).superRefine((v, c) => {
        if (['reject', 'suspend', 'request_info'].includes(v.decision) && !v.note) c.addIssue({ code: 'custom', path: ['note'], message: 'Gerekçe yazmanız gerekiyor.' });
      }),
    );
    const [b] = await sql<{ verification_status: string; name: string }[]>`SELECT verification_status, name FROM businesses WHERE id = ${id}`;
    if (!b) throw notFound();
    const allowed: Record<string, string[]> = {
      approve: ['pending_review', 'rejected'],
      reject: ['pending_review'],
      request_info: ['pending_review'],
      suspend: ['approved'],
      reinstate: ['suspended'],
    };
    if (!allowed[body.decision].includes(b.verification_status)) throw badRequest('Bu işletmenin mevcut durumunda bu karar verilemez.');
    const next = { approve: 'approved', reject: 'rejected', request_info: 'draft', suspend: 'suspended', reinstate: 'approved' }[body.decision];
    await sql`UPDATE businesses SET verification_status = ${next}, verification_note = ${body.note},
              approved_at = CASE WHEN ${next} = 'approved' AND approved_at IS NULL THEN now() ELSE approved_at END WHERE id = ${id}`;
    const messages: Record<string, [string, string]> = {
      approve: ['İşletmeniz onaylandı', `${b.name} artık KOLTUK'ta yayında ve online randevu alabilir.`],
      reject: ['İşletme başvurunuz reddedildi', `Gerekçe: ${body.note}. Bilgileri düzenleyip yeniden başvurabilirsiniz.`],
      request_info: ['Başvurunuz için ek bilgi gerekiyor', `${body.note}. Bilgileri tamamlayıp yeniden gönderin.`],
      suspend: ['İşletmeniz geçici olarak askıya alındı', `Gerekçe: ${body.note}. Bu süre içinde yeni online randevu alınamaz.`],
      reinstate: ['İşletmeniz yeniden yayında', `${b.name} tekrar online randevu alabilir.`],
    };
    const [title, msg] = messages[body.decision];
    await notifyBusinessManagers(sql, id, { type: `business_${body.decision}`, title, body: msg, link: '/panel', dedupeKey: `decision:${id}:${Date.now()}`, channels: { email: true } });
    await audit({ actor: admin.id, businessId: id, action: `admin.business_${body.decision}`, targetType: 'business', targetId: id, metadata: { note: body.note }, ip: ctx.ip });
    return { ok: true, status: next };
  });

  r.post('/api/admin/businesses/:id/location-verified', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = uuid.parse(ctx.params.id);
    const { verified } = await ctx.json(z.object({ verified: z.boolean() }));
    await sql`UPDATE businesses SET location_verified = ${verified} WHERE id = ${id}`;
    await audit({ actor: admin.id, businessId: id, action: 'admin.location_verified', metadata: { verified }, ip: ctx.ip });
    return { ok: true };
  });

  r.post('/api/admin/businesses/:id/plan', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = uuid.parse(ctx.params.id);
    const { plan_code, expires_at } = await ctx.json(z.object({ plan_code: z.string().min(1), expires_at: z.string().datetime({ offset: true }).nullable().optional() }));
    const [p] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = ${plan_code}`;
    if (!p) throw notFound('Paket bulunamadı.');
    await sql.begin(async (tx) => {
      await tx`UPDATE subscriptions SET status = 'cancelled' WHERE business_id = ${id} AND status IN ('active', 'trialing', 'past_due')`;
      await tx`INSERT INTO subscriptions (business_id, plan_id, status, expires_at, external_provider_reference)
               VALUES (${id}, ${p.id}, 'active', ${expires_at ? new Date(expires_at) : null}, 'manual:admin')`;
      await audit({ actor: admin.id, businessId: id, action: 'admin.plan_assign', metadata: { plan_code }, ip: ctx.ip }, tx);
    });
    return { ok: true };
  });

  // --- Kullanıcılar --------------------------------------------------------
  r.get('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    const q = ctx.query.get('q')?.trim() || null;
    return sql`SELECT id, full_name, email, phone, platform_role, account_status, email_verified_at, created_at, last_login_at,
                      (SELECT count(*)::int FROM appointments a WHERE a.customer_user_id = u.id) AS appointment_count,
                      (SELECT count(*)::int FROM business_members m WHERE m.user_id = u.id AND m.invitation_status = 'accepted') AS business_count
               FROM users u WHERE (${q}::text IS NULL OR full_name ILIKE ${'%' + (q ?? '') + '%'} OR email ILIKE ${'%' + (q ?? '') + '%'})
               ORDER BY created_at DESC LIMIT 200`;
  });
  r.post('/api/admin/users/:id/status', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = uuid.parse(ctx.params.id);
    const { status, note } = await ctx.json(z.object({ status: z.enum(['active', 'suspended']), note: optionalText(500) }));
    if (id === admin.id) throw badRequest('Kendi hesabınızın durumunu değiştiremezsiniz.');
    const res = await sql`UPDATE users SET account_status = ${status} WHERE id = ${id} AND account_status IN ('active', 'suspended')`;
    if (!res.count) throw notFound();
    if (status === 'suspended') await sql`DELETE FROM sessions WHERE user_id = ${id}`;
    await audit({ actor: admin.id, action: `admin.user_${status}`, targetType: 'user', targetId: id, metadata: { note }, ip: ctx.ip });
    return { ok: true };
  });

  // --- Yorumlar ve şikâyetler ---------------------------------------------
  r.get('/api/admin/reviews', async (ctx) => {
    requireAdmin(ctx);
    const status = ctx.query.get('status');
    return sql`SELECT r.id, r.rating, r.comment, r.moderation_status, r.created_at, b.name AS business_name, u.full_name AS author,
                      (SELECT count(*)::int FROM reports rp WHERE rp.target_type = 'review' AND rp.target_id = r.id AND rp.status = 'open') AS open_reports
               FROM reviews r JOIN businesses b ON b.id = r.business_id LEFT JOIN users u ON u.id = r.customer_user_id
               WHERE (${status}::text IS NULL OR r.moderation_status = ${status})
               ORDER BY open_reports DESC, r.created_at DESC LIMIT 200`;
  });
  r.post('/api/admin/reviews/:id/moderate', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = uuid.parse(ctx.params.id);
    const { status, note } = await ctx.json(z.object({ status: z.enum(['published', 'hidden', 'removed']), note: optionalText(500) }));
    const res = await sql`UPDATE reviews SET moderation_status = ${status} WHERE id = ${id}`;
    if (!res.count) throw notFound();
    await audit({ actor: admin.id, action: 'admin.review_moderate', targetType: 'review', targetId: id, metadata: { status, note }, ip: ctx.ip });
    return { ok: true };
  });
  r.get('/api/admin/reports', async (ctx) => {
    requireAdmin(ctx);
    return sql`SELECT rp.id, rp.target_type, rp.target_id, rp.reason, rp.status, rp.resolution_note, rp.created_at, u.full_name AS reporter,
                      CASE rp.target_type WHEN 'business' THEN (SELECT name FROM businesses WHERE id = rp.target_id)
                                          WHEN 'review' THEN (SELECT left(coalesce(comment, '(yorum metni yok)'), 140) FROM reviews WHERE id = rp.target_id) END AS target_label
               FROM reports rp LEFT JOIN users u ON u.id = rp.reporter_user_id
               ORDER BY CASE WHEN rp.status = 'open' THEN 0 ELSE 1 END, rp.created_at DESC LIMIT 200`;
  });
  r.post('/api/admin/reports/:id/resolve', async (ctx) => {
    const admin = requireAdmin(ctx);
    const { status, note } = await ctx.json(z.object({ status: z.enum(['resolved', 'dismissed']), note: optionalText(500) }));
    const id = uuid.parse(ctx.params.id);
    const res = await sql`UPDATE reports SET status = ${status}, resolution_note = ${note}, resolved_at = now() WHERE id = ${id}`;
    if (!res.count) throw notFound();
    await audit({ actor: admin.id, action: 'admin.report_resolve', targetType: 'report', targetId: id, metadata: { status }, ip: ctx.ip });
    return { ok: true };
  });

  // --- Kategoriler ---------------------------------------------------------
  r.get('/api/admin/categories', async (ctx) => {
    requireAdmin(ctx);
    return sql`SELECT c.*, (SELECT count(*)::int FROM business_categories bc WHERE bc.category_id = c.id) AS business_count,
                      COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'duration', t.default_duration_minutes) ORDER BY t.sort_order)
                                FROM service_templates t WHERE t.category_id = c.id), '[]') AS templates
               FROM categories c ORDER BY c.sort_order`;
  });
  const categorySchema = z.object({ name: trimmed(2, 60), business_type: z.enum(BUSINESS_TYPES), sort_order: z.number().int().min(0).max(1000).default(0), is_active: z.boolean().default(true) });
  r.post('/api/admin/categories', async (ctx) => {
    const admin = requireAdmin(ctx);
    const body = await ctx.json(categorySchema);
    const [c] = await sql<{ id: string }[]>`INSERT INTO categories (slug, name, business_type, sort_order, is_active)
      VALUES (${slugify(body.name)}, ${body.name}, ${body.business_type}, ${body.sort_order}, ${body.is_active}) RETURNING id`;
    await audit({ actor: admin.id, action: 'admin.category_create', targetType: 'category', targetId: c.id, ip: ctx.ip });
    ctx.status = 201;
    return { id: c.id };
  });
  r.put('/api/admin/categories/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const body = await ctx.json(categorySchema);
    const id = uuid.parse(ctx.params.id);
    const res = await sql`UPDATE categories SET name = ${body.name}, business_type = ${body.business_type}, sort_order = ${body.sort_order}, is_active = ${body.is_active} WHERE id = ${id}`;
    if (!res.count) throw notFound();
    await audit({ actor: admin.id, action: 'admin.category_update', targetType: 'category', targetId: id, ip: ctx.ip });
    return { ok: true };
  });
  r.post('/api/admin/categories/:id/templates', async (ctx) => {
    const admin = requireAdmin(ctx);
    const body = await ctx.json(z.object({ name: trimmed(2, 100), default_duration_minutes: z.number().int().min(5).max(600) }));
    const id = uuid.parse(ctx.params.id);
    await sql`INSERT INTO service_templates (category_id, name, default_duration_minutes, sort_order)
              VALUES (${id}, ${body.name}, ${body.default_duration_minutes}, (SELECT COALESCE(max(sort_order), 0) + 1 FROM service_templates WHERE category_id = ${id}))`;
    await audit({ actor: admin.id, action: 'admin.template_create', targetType: 'category', targetId: id, ip: ctx.ip });
    ctx.status = 201;
    return { ok: true };
  });
  r.delete('/api/admin/templates/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = uuid.parse(ctx.params.id);
    await sql`DELETE FROM service_templates WHERE id = ${id}`;
    await audit({ actor: admin.id, action: 'admin.template_delete', targetType: 'template', targetId: id, ip: ctx.ip });
    return { ok: true };
  });

  // --- Paketler ------------------------------------------------------------
  r.get('/api/admin/plans', async (ctx) => {
    requireAdmin(ctx);
    return sql`SELECT p.id, p.code, p.name, p.description, p.price_amount::text, p.currency, p.billing_period, p.feature_limits, p.features, p.sort_order, p.is_active,
                      (SELECT count(*)::int FROM subscriptions s WHERE s.plan_id = p.id AND s.status IN ('active', 'trialing')) AS active_subscriptions
               FROM plans p ORDER BY p.sort_order`;
  });
  r.put('/api/admin/plans/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = uuid.parse(ctx.params.id);
    const body = await ctx.json(
      z.object({
        name: trimmed(2, 60),
        description: optionalText(300),
        price_amount: z.number().min(0).max(1_000_000),
        billing_period: z.enum(['monthly', 'yearly']),
        features: z.array(trimmed(2, 120)).max(20),
        feature_limits: z.object({
          max_employees: z.number().int().min(1).max(1000),
          max_services: z.number().int().min(1).max(5000),
          reports: z.enum(['basic', 'detailed', 'advanced']),
          reminders: z.boolean(),
          multi_branch: z.boolean().optional(),
          featured: z.boolean().optional(),
        }),
        is_active: z.boolean(),
      }),
    );
    const res = await sql`UPDATE plans SET name = ${body.name}, description = ${body.description}, price_amount = ${body.price_amount},
      billing_period = ${body.billing_period}, features = ${sql.json(body.features)}, feature_limits = ${sql.json(body.feature_limits)}, is_active = ${body.is_active}
      WHERE id = ${id}`;
    if (!res.count) throw notFound();
    await audit({ actor: admin.id, action: 'admin.plan_update', targetType: 'plan', targetId: id, metadata: { price_amount: body.price_amount }, ip: ctx.ip });
    return { ok: true };
  });

  // --- Kayıtlar, KVKK, mesaj kuyruğu --------------------------------------
  r.get('/api/admin/audit', async (ctx) => {
    requireAdmin(ctx);
    const action = ctx.query.get('action')?.trim() || null;
    return sql`SELECT l.id, l.action, l.target_type, l.target_id, l.metadata, l.ip, l.created_at, u.full_name AS actor, u.email AS actor_email, b.name AS business_name
               FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id LEFT JOIN businesses b ON b.id = l.business_id
               WHERE (${action}::text IS NULL OR l.action LIKE ${(action ?? '') + '%'})
               ORDER BY l.created_at DESC LIMIT 300`;
  });

  r.get('/api/admin/data-requests', async (ctx) => {
    requireAdmin(ctx);
    return sql`SELECT d.id, d.request_type, d.details, d.status, d.resolution_note, d.created_at, d.resolved_at, d.user_id,
                      u.full_name, u.email, u.account_status, u.deletion_requested_at
               FROM data_requests d LEFT JOIN users u ON u.id = d.user_id
               ORDER BY CASE WHEN d.status IN ('open', 'in_progress') THEN 0 ELSE 1 END, d.created_at DESC LIMIT 200`;
  });
  r.post('/api/admin/data-requests/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const id = uuid.parse(ctx.params.id);
    const body = await ctx.json(z.object({ status: z.enum(['in_progress', 'completed', 'rejected']), resolution_note: optionalText(1000), anonymize: z.boolean().optional() }));
    const [d] = await sql<{ user_id: string | null; request_type: string }[]>`SELECT user_id, request_type FROM data_requests WHERE id = ${id}`;
    if (!d) throw notFound();
    if (body.anonymize) {
      if (d.request_type !== 'deletion' || !d.user_id) throw badRequest('Anonimleştirme yalnızca silme taleplerinde yapılabilir.');
      await anonymizeUser(d.user_id, admin.id);
    }
    await sql`UPDATE data_requests SET status = ${body.status}, resolution_note = ${body.resolution_note},
              resolved_at = CASE WHEN ${body.status} IN ('completed', 'rejected') THEN now() ELSE NULL END WHERE id = ${id}`;
    if (d.user_id && !body.anonymize && body.status !== 'in_progress') {
      await notify(sql, { userId: d.user_id, type: 'data_request', title: 'Veri başvurunuz sonuçlandı', body: body.resolution_note ?? 'Başvurunuz sonuçlandırıldı.', link: '/hesabim/gizlilik', dedupeKey: `datareq:${id}:${body.status}` });
    }
    await audit({ actor: admin.id, action: 'admin.data_request', targetType: 'data_request', targetId: id, metadata: { status: body.status, anonymize: Boolean(body.anonymize) }, ip: ctx.ip });
    return { ok: true };
  });

  r.get('/api/admin/messages', async (ctx) => {
    requireAdmin(ctx);
    const rows = await sql`SELECT id, channel, left(recipient, 3) || '***' AS recipient, subject, status, attempts, last_error, created_at, sent_at
                           FROM outbound_messages ORDER BY created_at DESC LIMIT 100`;
    const summary = await sql`SELECT channel, status, count(*)::int AS n FROM outbound_messages GROUP BY 1, 2 ORDER BY 1, 2`;
    return { integrations: integrationStatus(), summary, rows };
  });
}
