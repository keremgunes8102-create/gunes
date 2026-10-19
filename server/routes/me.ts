import { sql } from '../db.ts';
import { HttpError, badRequest, conflict, notFound, type Router } from '../http.ts';
import { requireUser } from '../auth.ts';
import { createAppointment, rescheduleByCustomer, respondToProposal, transitionAppointment } from '../booking.ts';
import { optionalPhone, optionalText, trimmed, uuid, z } from '../validation.ts';
import { rateLimit, verifyPassword } from '../security.ts';
import { audit } from '../audit.ts';
import { notifyBusinessManagers } from '../notify.ts';
import { exportUserData } from '../users.ts';
import { LEGAL_DOC_VERSION } from '../../shared/constants.ts';

const apptListSelect = sql`
  a.id, a.public_reference, a.start_at, a.end_at, a.status, a.price_snapshot::text, a.price_max_snapshot::text, a.price_type_snapshot,
  a.duration_snapshot, a.cancel_min_hours_snapshot, a.customer_note, a.cancellation_reason, a.created_at,
  b.id AS business_id, b.name AS business_name, b.slug AS business_slug, b.timezone, b.phone AS business_phone, b.address AS business_address,
  b.district AS business_district, b.city AS business_city, b.is_demo AS business_is_demo,
  e.display_name AS employee_name, e.id AS employee_id,
  (SELECT json_agg(json_build_object('service_id', s.service_id, 'name', s.name_snapshot, 'duration', s.duration_snapshot,
          'price_type', s.price_type_snapshot, 'price', s.price_snapshot::text, 'price_max', s.price_max_snapshot::text) ORDER BY s.position)
   FROM appointment_services s WHERE s.appointment_id = a.id) AS services,
  (SELECT r.id FROM reviews r WHERE r.appointment_id = a.id) AS review_id`;

export function registerMeRoutes(r: Router) {
  // --- Randevular ----------------------------------------------------------
  r.get('/api/me/appointments', async (ctx) => {
    const user = requireUser(ctx);
    const scope = ctx.query.get('scope') ?? 'upcoming';
    const rows =
      scope === 'cancelled'
        ? await sql`SELECT ${apptListSelect} FROM appointments a JOIN businesses b ON b.id = a.business_id JOIN employees e ON e.id = a.employee_id
                    WHERE a.customer_user_id = ${user.id} AND a.status IN ('cancelled_by_customer', 'cancelled_by_business', 'rejected', 'expired')
                    ORDER BY a.start_at DESC LIMIT 100`
        : scope === 'past'
          ? await sql`SELECT ${apptListSelect} FROM appointments a JOIN businesses b ON b.id = a.business_id JOIN employees e ON e.id = a.employee_id
                      WHERE a.customer_user_id = ${user.id} AND (a.status IN ('completed', 'no_show') OR (a.status = 'confirmed' AND a.start_at < now()))
                      ORDER BY a.start_at DESC LIMIT 100`
          : await sql`SELECT ${apptListSelect} FROM appointments a JOIN businesses b ON b.id = a.business_id JOIN employees e ON e.id = a.employee_id
                      WHERE a.customer_user_id = ${user.id} AND a.status IN ('pending', 'confirmed') AND a.start_at >= now()
                      ORDER BY a.start_at LIMIT 100`;
    return rows;
  });

  r.get('/api/me/appointments/:ref', async (ctx) => {
    const user = requireUser(ctx);
    const [a] = await sql<Record<string, unknown>[]>`
      SELECT ${apptListSelect}, a.cancellation_policy_snapshot, b.allow_employee_choice
      FROM appointments a JOIN businesses b ON b.id = a.business_id JOIN employees e ON e.id = a.employee_id
      WHERE a.public_reference = ${ctx.params.ref} AND a.customer_user_id = ${user.id}`;
    if (!a) throw notFound('Randevu bulunamadı.');
    const proposals = await sql`
      SELECT p.id, p.proposed_start_at, p.status, p.note, e.display_name AS employee_name FROM appointment_proposals p
      JOIN employees e ON e.id = p.proposed_employee_id WHERE p.appointment_id = ${a.id as string} ORDER BY p.created_at DESC`;
    const events = await sql`SELECT event_type, from_status, to_status, created_at FROM appointment_events WHERE appointment_id = ${a.id as string} ORDER BY created_at`;
    const start = (a.start_at as Date).getTime();
    const deadline = start - (a.cancel_min_hours_snapshot as number) * 3_600_000;
    const active = ['pending', 'confirmed'].includes(a.status as string);
    return {
      ...a,
      proposals,
      events,
      can_cancel: active && Date.now() <= deadline,
      cancel_deadline: new Date(deadline).toISOString(),
      can_reschedule: active && Date.now() <= deadline,
      can_review: a.status === 'completed' && !a.review_id,
    };
  });

  r.post('/api/me/appointments', async (ctx) => {
    const user = requireUser(ctx);
    rateLimit(`book:${user.id}`, 20, 3_600_000);
    const body = await ctx.json(
      z.object({
        business_id: uuid,
        service_ids: z.array(uuid).min(1).max(5),
        employee_id: uuid.nullable().optional(),
        start_at: z.string().datetime({ offset: true, message: 'Geçerli bir saat seçin.' }),
        customer_note: optionalText(500),
        idempotency_key: z.string().min(8).max(80),
      }),
    );
    // Not: fiyat, süre, durum gibi değerler istemciden alınmaz; sunucu veritabanından hesaplar.
    const result = await createAppointment({
      businessId: body.business_id,
      serviceIds: body.service_ids,
      employeeId: body.employee_id ?? null,
      startAt: new Date(body.start_at),
      idempotencyKey: body.idempotency_key,
      customerNote: body.customer_note,
      actorUserId: user.id,
      customerUserId: user.id,
      source: 'online',
      ip: ctx.ip,
    });
    ctx.status = result.replayed ? 200 : 201;
    return result;
  });

  const ownAppt = async (ref: string, userId: string) => {
    const [a] = await sql<{ id: string }[]>`SELECT id FROM appointments WHERE public_reference = ${ref} AND customer_user_id = ${userId}`;
    if (!a) throw notFound('Randevu bulunamadı.');
    return a.id;
  };

  r.post('/api/me/appointments/:ref/cancel', async (ctx) => {
    const user = requireUser(ctx);
    const { reason } = await ctx.json(z.object({ reason: optionalText(300) }));
    const id = await ownAppt(ctx.params.ref, user.id);
    return transitionAppointment(id, 'cancel_customer', { kind: 'customer', userId: user.id }, { reason, ip: ctx.ip });
  });

  r.post('/api/me/appointments/:ref/reschedule', async (ctx) => {
    const user = requireUser(ctx);
    rateLimit(`resched:${user.id}`, 10, 3_600_000);
    const body = await ctx.json(z.object({ start_at: z.string().datetime({ offset: true }), employee_id: uuid.nullable().optional() }));
    const id = await ownAppt(ctx.params.ref, user.id);
    return rescheduleByCustomer(id, user.id, new Date(body.start_at), body.employee_id ?? null, ctx.ip);
  });

  r.post('/api/me/proposals/:id/respond', async (ctx) => {
    const user = requireUser(ctx);
    const { accept } = await ctx.json(z.object({ accept: z.boolean() }));
    return respondToProposal(uuid.parse(ctx.params.id), user.id, accept);
  });

  // --- Yorumlar ------------------------------------------------------------
  r.post('/api/me/appointments/:ref/review', async (ctx) => {
    const user = requireUser(ctx);
    rateLimit(`review:${user.id}`, 10, 3_600_000);
    const body = await ctx.json(z.object({ rating: z.number().int().min(1).max(5), comment: optionalText(1500) }));
    const [a] = await sql<{ id: string; business_id: string; status: string; customer_user_id: string; public_reference: string }[]>`
      SELECT id, business_id, status, customer_user_id, public_reference FROM appointments
      WHERE public_reference = ${ctx.params.ref} AND customer_user_id = ${user.id}`;
    if (!a) throw notFound('Randevu bulunamadı.');
    if (a.status !== 'completed') throw badRequest('Yalnızca tamamlanmış randevular için yorum bırakabilirsiniz.');
    try {
      const [rv] = await sql<{ id: string }[]>`
        INSERT INTO reviews (appointment_id, customer_user_id, business_id, rating, comment)
        VALUES (${a.id}, ${user.id}, ${a.business_id}, ${body.rating}, ${body.comment}) RETURNING id`;
      await notifyBusinessManagers(sql, a.business_id, { type: 'business_new_review', title: 'Yeni değerlendirme', body: `${body.rating}/5 puan aldınız.`, link: '/panel/yorumlar', dedupeKey: `review:${rv.id}` });
      ctx.status = 201;
      return { id: rv.id };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('Bu randevu için zaten bir yorum bıraktınız. Mevcut yorumunuzu düzenleyebilirsiniz.', 'review_exists');
      throw e;
    }
  });

  r.get('/api/me/reviews', async (ctx) => {
    const user = requireUser(ctx);
    return sql`SELECT r.id, r.rating, r.comment, r.created_at, r.edited_at, r.moderation_status, r.business_reply, r.business_reply_at,
                      b.name AS business_name, b.slug AS business_slug, a.public_reference, a.start_at
               FROM reviews r JOIN businesses b ON b.id = r.business_id JOIN appointments a ON a.id = r.appointment_id
               WHERE r.customer_user_id = ${user.id} ORDER BY r.created_at DESC`;
  });

  r.patch('/api/me/reviews/:id', async (ctx) => {
    const user = requireUser(ctx);
    const body = await ctx.json(z.object({ rating: z.number().int().min(1).max(5), comment: optionalText(1500) }));
    const res = await sql`UPDATE reviews SET rating = ${body.rating}, comment = ${body.comment}, edited_at = now()
                          WHERE id = ${uuid.parse(ctx.params.id)} AND customer_user_id = ${user.id} AND moderation_status <> 'removed'`;
    if (!res.count) throw notFound('Yorum bulunamadı.');
    return { ok: true };
  });

  r.post('/api/reports', async (ctx) => {
    const user = requireUser(ctx);
    rateLimit(`report:${user.id}`, 10, 3_600_000);
    const body = await ctx.json(z.object({ target_type: z.enum(['review', 'business']), target_id: uuid, reason: trimmed(5, 1000) }));
    const table = body.target_type === 'review' ? sql`reviews` : sql`businesses`;
    const [exists] = await sql`SELECT 1 FROM ${table} WHERE id = ${body.target_id}`;
    if (!exists) throw notFound();
    await sql`INSERT INTO reports (reporter_user_id, target_type, target_id, reason) VALUES (${user.id}, ${body.target_type}, ${body.target_id}, ${body.reason})`;
    ctx.status = 201;
    return { ok: true, message: 'Bildiriminiz alındı. Ekibimiz inceleyecek.' };
  });

  // --- Favoriler -----------------------------------------------------------
  r.get('/api/me/favorites', async (ctx) => {
    const user = requireUser(ctx);
    return sql`SELECT b.id, b.name, b.slug, b.business_type, b.city, b.district, b.logo_url, b.cover_url, b.is_demo, f.created_at,
                      (SELECT round(avg(rating)::numeric, 1)::text FROM reviews r WHERE r.business_id = b.id AND r.moderation_status = 'published') AS rating,
                      (SELECT count(*)::int FROM reviews r WHERE r.business_id = b.id AND r.moderation_status = 'published') AS review_count
               FROM favorites f JOIN businesses b ON b.id = f.business_id
               WHERE f.user_id = ${user.id} AND b.verification_status = 'approved' ORDER BY f.created_at DESC`;
  });
  r.put('/api/me/favorites/:businessId', async (ctx) => {
    const user = requireUser(ctx);
    const id = uuid.parse(ctx.params.businessId);
    const [b] = await sql`SELECT 1 FROM businesses WHERE id = ${id} AND verification_status = 'approved'`;
    if (!b) throw notFound('İşletme bulunamadı.');
    await sql`INSERT INTO favorites (user_id, business_id) VALUES (${user.id}, ${id}) ON CONFLICT DO NOTHING`;
    return { ok: true, favorite: true };
  });
  r.delete('/api/me/favorites/:businessId', async (ctx) => {
    const user = requireUser(ctx);
    await sql`DELETE FROM favorites WHERE user_id = ${user.id} AND business_id = ${uuid.parse(ctx.params.businessId)}`;
    return { ok: true, favorite: false };
  });

  // --- Bildirimler ---------------------------------------------------------
  r.get('/api/me/notifications', async (ctx) => {
    const user = requireUser(ctx);
    return sql`SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 100`;
  });
  r.post('/api/me/notifications/read', async (ctx) => {
    const user = requireUser(ctx);
    const body = await ctx.json(z.object({ ids: z.array(uuid).max(200).optional() }));
    if (body.ids?.length) await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${user.id} AND id = ANY(${body.ids}::uuid[]) AND read_at IS NULL`;
    else await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${user.id} AND read_at IS NULL`;
    return { ok: true };
  });

  // --- Profil ve tercihler -------------------------------------------------
  r.patch('/api/me/profile', async (ctx) => {
    const user = requireUser(ctx);
    const body = await ctx.json(z.object({ full_name: trimmed(2, 120), phone: optionalPhone }));
    if (body.phone && body.phone !== user.phone) {
      const [p] = await sql`SELECT 1 FROM users WHERE phone = ${body.phone} AND id <> ${user.id} AND account_status <> 'deleted'`;
      if (p) throw new HttpError(409, 'phone_taken', 'Bu telefon numarası başka bir hesapta kayıtlı.', { phone: 'Bu numara zaten kayıtlı.' });
    }
    await sql`UPDATE users SET full_name = ${body.full_name}, phone = ${body.phone},
              phone_verified_at = CASE WHEN phone IS DISTINCT FROM ${body.phone} THEN NULL ELSE phone_verified_at END WHERE id = ${user.id}`;
    await audit({ actor: user.id, action: 'user.profile_update', targetType: 'user', targetId: user.id, ip: ctx.ip });
    return { ok: true };
  });

  r.get('/api/me/preferences', async (ctx) => {
    const user = requireUser(ctx);
    const [p] = await sql`SELECT email_service, sms_service, reminders, reminder_hours FROM notification_preferences WHERE user_id = ${user.id}`;
    const consents = await sql<{ consent_type: string; granted: boolean; created_at: Date }[]>`
      SELECT DISTINCT ON (consent_type) consent_type, granted, created_at FROM consents WHERE user_id = ${user.id} ORDER BY consent_type, created_at DESC`;
    const c = Object.fromEntries(consents.map((x) => [x.consent_type, x.granted]));
    return { ...(p ?? { email_service: true, sms_service: true, reminders: true, reminder_hours: 24 }), marketing_email: Boolean(c.marketing_email), marketing_sms: Boolean(c.marketing_sms) };
  });

  r.put('/api/me/preferences', async (ctx) => {
    const user = requireUser(ctx);
    const body = await ctx.json(
      z.object({
        email_service: z.boolean(),
        sms_service: z.boolean(),
        reminders: z.boolean(),
        reminder_hours: z.union([z.literal(2), z.literal(6), z.literal(12), z.literal(24), z.literal(48)]),
        marketing_email: z.boolean(),
        marketing_sms: z.boolean(),
      }),
    );
    await sql.begin(async (tx) => {
      await tx`INSERT INTO notification_preferences (user_id, email_service, sms_service, reminders, reminder_hours, updated_at)
               VALUES (${user.id}, ${body.email_service}, ${body.sms_service}, ${body.reminders}, ${body.reminder_hours}, now())
               ON CONFLICT (user_id) DO UPDATE SET email_service = EXCLUDED.email_service, sms_service = EXCLUDED.sms_service,
               reminders = EXCLUDED.reminders, reminder_hours = EXCLUDED.reminder_hours, updated_at = now()`;
      const current = await tx<{ consent_type: string; granted: boolean }[]>`
        SELECT DISTINCT ON (consent_type) consent_type, granted FROM consents WHERE user_id = ${user.id} ORDER BY consent_type, created_at DESC`;
      const cur = Object.fromEntries(current.map((x) => [x.consent_type, x.granted]));
      for (const [type, val] of [['marketing_email', body.marketing_email], ['marketing_sms', body.marketing_sms]] as const) {
        if (Boolean(cur[type]) !== val) {
          await tx`INSERT INTO consents (user_id, consent_type, granted, document_version, ip) VALUES (${user.id}, ${type}, ${val}, ${LEGAL_DOC_VERSION}, ${ctx.ip})`;
        }
      }
    });
    return { ok: true };
  });

  // --- KVKK: veri dökümü, başvuru ve hesap silme ---------------------------
  r.get('/api/me/export', async (ctx) => {
    const user = requireUser(ctx);
    rateLimit(`export:${user.id}`, 5, 3_600_000);
    await audit({ actor: user.id, action: 'user.data_export', targetType: 'user', targetId: user.id, ip: ctx.ip });
    ctx.responseHeaders['Content-Disposition'] = 'attachment; filename="koltuk-verilerim.json"';
    return exportUserData(user.id);
  });

  r.get('/api/me/data-requests', async (ctx) => {
    const user = requireUser(ctx);
    return sql`SELECT id, request_type, details, status, resolution_note, created_at, resolved_at FROM data_requests WHERE user_id = ${user.id} ORDER BY created_at DESC`;
  });

  r.post('/api/me/data-requests', async (ctx) => {
    const user = requireUser(ctx);
    rateLimit(`datareq:${user.id}`, 5, 86_400_000);
    const body = await ctx.json(z.object({ request_type: z.enum(['access', 'correction', 'objection', 'other']), details: trimmed(5, 2000) }));
    await sql`INSERT INTO data_requests (user_id, request_type, details) VALUES (${user.id}, ${body.request_type}, ${body.details})`;
    ctx.status = 201;
    return { ok: true };
  });

  r.post('/api/me/delete-account', async (ctx) => {
    const user = requireUser(ctx);
    const body = await ctx.json(z.object({ password: z.string().min(1) }));
    rateLimit(`delete:${user.id}`, 5, 3_600_000);
    const [u] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${user.id}`;
    if (!(await verifyPassword(body.password, u.password_hash))) throw new HttpError(422, 'invalid_password', 'Şifre hatalı.', { password: 'Şifre hatalı.' });
    const [owner] = await sql`SELECT 1 FROM businesses WHERE owner_user_id = ${user.id} AND verification_status NOT IN ('rejected')`;
    if (owner) throw badRequest('Sahibi olduğunuz bir işletme var. Hesabınızı silmeden önce işletmenin devri veya kapatılması için destekle iletişime geçin.');
    await sql`UPDATE users SET account_status = 'deletion_requested', deletion_requested_at = now() WHERE id = ${user.id}`;
    await sql`INSERT INTO data_requests (user_id, request_type, details) VALUES (${user.id}, 'deletion', 'Kullanıcı hesap silme talebi')`;
    await audit({ actor: user.id, action: 'user.deletion_requested', targetType: 'user', targetId: user.id, ip: ctx.ip });
    return { ok: true, graceDays: Number(process.env.ACCOUNT_DELETION_GRACE_DAYS ?? 14) };
  });

  r.post('/api/me/delete-account/cancel', async (ctx) => {
    const user = requireUser(ctx);
    await sql`UPDATE users SET account_status = 'active', deletion_requested_at = NULL WHERE id = ${user.id} AND account_status = 'deletion_requested'`;
    await sql`UPDATE data_requests SET status = 'rejected', resolution_note = 'Kullanıcı talebini geri çekti', resolved_at = now()
              WHERE user_id = ${user.id} AND request_type = 'deletion' AND status = 'open'`;
    return { ok: true };
  });
}
