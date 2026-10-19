// İşletme yönetim paneli API'si. Her uç nokta işletme üyeliğini ve rolü sunucu tarafında doğrular.
import { sql, type Tx } from '../db.ts';
import { config, emailConfigured } from '../config.ts';
import { HttpError, badRequest, conflict, forbidden, notFound, type Ctx, type Router } from '../http.ts';
import { requireMember, requireUser, type Membership } from '../auth.ts';
import {
  createAppointment,
  proposeNewTime,
  rescheduleByBusiness,
  transitionAppointment,
  type TransitionAction,
} from '../booking.ts';
import { buildPlan, computeDaySlots, loadAvailabilityData } from '../availability.ts';
import { audit } from '../audit.ts';
import { notify } from '../notify.ts';
import { randomToken, rateLimit, sha256 } from '../security.ts';
import {
  emailSchema,
  hhmm,
  localDate,
  money,
  optionalPhone,
  optionalText,
  optionalUrl,
  phoneSchema,
  trimmed,
  uuid,
  z,
} from '../validation.ts';
import { BUSINESS_TYPES, MEMBER_ROLES, PRICE_TYPES, STATION_TYPES, TR_CITIES } from '../../shared/constants.ts';
import { slugify } from '../../shared/format.ts';
import { addDaysLocal, localDateOf, timeToMinutes, zonedToUtc } from '../../shared/time.ts';

const MANAGERS = ['owner', 'manager'] as const;
const OWNER = ['owner'] as const;
type Role = (typeof MEMBER_ROLES)[number];

async function member(ctx: Ctx, roles: readonly Role[] = ['owner', 'manager', 'staff']) {
  const bid = uuid.parse(ctx.params.bid);
  return requireMember(ctx, bid, [...roles]);
}

async function uniqueSlug(name: string, city: string | null, excludeId?: string) {
  const base = slugify(`${name}${city ? ` ${city}` : ''}`) || 'isletme';
  let slug = base;
  for (let i = 2; i < 200; i++) {
    const [exists] = await sql`SELECT 1 FROM businesses WHERE slug = ${slug} AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)`;
    if (!exists) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

async function planLimits(businessId: string) {
  const [p] = await sql<{ code: string; name: string; feature_limits: Record<string, unknown> }[]>`
    SELECT p.code, p.name, p.feature_limits FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.business_id = ${businessId} AND s.status IN ('active', 'trialing', 'past_due')`;
  return p ?? { code: 'free', name: 'Ücretsiz', feature_limits: { max_employees: 2, max_services: 15 } };
}

const intervalSchema = z.object({ start: hhmm, end: hhmm }).refine((v) => timeToMinutes(v.end) > timeToMinutes(v.start), { message: 'Bitiş saati başlangıçtan sonra olmalı.' });
const daySchema = z.object({ weekday: z.number().int().min(0).max(6), intervals: z.array(intervalSchema).max(4) });
function assertNoOverlap(intervals: { start: string; end: string }[], label: string) {
  const sorted = [...intervals].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (timeToMinutes(sorted[i].start) < timeToMinutes(sorted[i - 1].end)) throw badRequest(`${label}: aralıklar çakışıyor.`);
  }
}

const businessInfoSchema = z.object({
  name: trimmed(2, 120),
  business_type: z.enum(BUSINESS_TYPES),
  category_ids: z.array(uuid).max(3).optional(),
  description: optionalText(1000),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email().max(200).optional().nullable().or(z.literal('')).transform((v) => v || null),
  website: optionalUrl,
  instagram: z.string().trim().max(60).optional().nullable().transform((v) => (v ? v.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '') : null)),
});

const addressSchema = z.object({
  city: z.string().refine((c) => TR_CITIES.includes(c), 'Listeden bir il seçin.'),
  district: trimmed(2, 60),
  neighborhood: optionalText(80),
  address: trimmed(5, 300),
  latitude: z.number().min(35).max(43).nullable().optional(),
  longitude: z.number().min(25).max(45.5).nullable().optional(),
});

const settingsSchema = z.object({
  auto_confirm: z.boolean(),
  booking_window_days: z.number().int().min(1).max(365),
  min_notice_minutes: z.number().int().min(0).max(10080),
  cancel_min_hours: z.number().int().min(0).max(168),
  slot_interval_minutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]),
  allow_employee_choice: z.boolean(),
  accept_new_customers: z.boolean(),
  online_booking_enabled: z.boolean(),
  pending_expiry_minutes: z.number().int().min(10).max(2880),
  cancellation_policy: optionalText(1000),
  publication_status: z.enum(['published', 'hidden']).optional(),
});

const serviceSchema = z
  .object({
    name: trimmed(2, 100),
    description: optionalText(500),
    category_id: uuid.nullable().optional(),
    duration_minutes: z.number().int().min(5).max(600),
    preparation_minutes: z.number().int().min(0).max(120).default(0),
    cleanup_minutes: z.number().int().min(0).max(120).default(0),
    price_type: z.enum(PRICE_TYPES),
    price_amount: money.nullable().optional(),
    price_max_amount: money.nullable().optional(),
    is_active: z.boolean().default(true),
    employee_ids: z.array(uuid).max(100).default([]),
    station_ids: z.array(uuid).max(100).default([]),
    photo_url: z.string().regex(/^\/uploads\/[a-z0-9-]+\.(jpg|png|webp)$/).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.price_type !== 'consultation' && (v.price_amount === null || v.price_amount === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['price_amount'], message: 'Fiyat girin.' });
    }
    if (v.price_type === 'range' && (v.price_max_amount === null || v.price_max_amount === undefined || v.price_max_amount < (v.price_amount ?? 0))) {
      ctx.addIssue({ code: 'custom', path: ['price_max_amount'], message: 'Üst fiyat, alt fiyattan küçük olamaz.' });
    }
  });

const employeeSchema = z.object({
  display_name: trimmed(2, 80),
  title: optionalText(80),
  description: optionalText(500),
  photo_url: z.string().regex(/^\/uploads\/[a-z0-9-]+\.(jpg|png|webp)$/).nullable().optional(),
  is_active: z.boolean().default(true),
  accepts_bookings: z.boolean().default(true),
  service_ids: z.array(uuid).max(200).default([]),
  hours: z.array(daySchema).max(7).default([]),
  breaks: z.array(daySchema).max(7).default([]),
});

const stationSchema = z.object({
  name: trimmed(1, 60),
  station_type: z.enum(STATION_TYPES),
  description: optionalText(300),
  capacity: z.number().int().min(1).max(20).default(1),
  is_active: z.boolean().default(true),
  service_ids: z.array(uuid).max(200).default([]),
});

/** İlişkilendirilecek kimliklerin aynı işletmeye ait olduğunu doğrular (başka işletmenin kaydına bağlantıyı engeller) */
async function assertOwned(tx: Tx | typeof sql, table: 'services' | 'employees' | 'stations', ids: string[], businessId: string) {
  if (!ids.length) return;
  const t = table === 'services' ? tx`services` : table === 'employees' ? tx`employees` : tx`stations`;
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM ${t} WHERE business_id = ${businessId} AND id = ANY(${ids}::uuid[])`;
  if (n !== new Set(ids).size) throw badRequest('Seçilen kayıtlardan bazıları bu işletmeye ait değil.');
}

async function saveEmployeeSchedule(tx: Tx, employeeId: string, hours: z.infer<typeof daySchema>[], breaks: z.infer<typeof daySchema>[]) {
  await tx`DELETE FROM employee_hours WHERE employee_id = ${employeeId}`;
  await tx`DELETE FROM employee_breaks WHERE employee_id = ${employeeId}`;
  for (const d of hours) {
    assertNoOverlap(d.intervals, 'Vardiya');
    for (const i of d.intervals) await tx`INSERT INTO employee_hours (employee_id, weekday, start_time, end_time) VALUES (${employeeId}, ${d.weekday}, ${i.start}, ${i.end})`;
  }
  for (const d of breaks) {
    assertNoOverlap(d.intervals, 'Mola');
    for (const i of d.intervals) await tx`INSERT INTO employee_breaks (employee_id, weekday, start_time, end_time) VALUES (${employeeId}, ${d.weekday}, ${i.start}, ${i.end})`;
  }
}

async function businessDetail(businessId: string, m: Membership) {
  const [b] = await sql`SELECT * FROM businesses WHERE id = ${businessId}`;
  const categories = await sql`SELECT category_id FROM business_categories WHERE business_id = ${businessId}`;
  const hours = await sql`SELECT weekday, to_char(opening_time, 'HH24:MI') AS start, to_char(closing_time, 'HH24:MI') AS end FROM business_hours WHERE business_id = ${businessId} ORDER BY weekday, opening_time`;
  const [counts] = await sql<{ employees: number; services: number; stations: number; bookable_employees: number }[]>`
    SELECT (SELECT count(*)::int FROM employees WHERE business_id = ${businessId} AND is_active) AS employees,
           (SELECT count(*)::int FROM services WHERE business_id = ${businessId} AND is_active) AS services,
           (SELECT count(*)::int FROM stations WHERE business_id = ${businessId} AND is_active) AS stations,
           (SELECT count(*)::int FROM employees e WHERE e.business_id = ${businessId} AND e.is_active AND e.accepts_bookings
              AND EXISTS (SELECT 1 FROM employee_hours h WHERE h.employee_id = e.id)
              AND EXISTS (SELECT 1 FROM employee_services es JOIN services s ON s.id = es.service_id WHERE es.employee_id = e.id AND s.is_active)) AS bookable_employees`;
  const plan = await planLimits(businessId);
  return { business: b, category_ids: categories.map((c) => c.category_id), hours, counts, membership: m, plan, checklist: checklist(b, hours.length, counts) };
}

function checklist(b: Record<string, unknown>, hourRows: number, counts: { services: number; bookable_employees: number }) {
  const items = [
    { key: 'info', label: 'İşletme bilgileri', done: Boolean(b.name && b.phone && b.business_type) },
    { key: 'address', label: 'Adres', done: Boolean(b.city && b.district && b.address) },
    { key: 'hours', label: 'Çalışma saatleri', done: hourRows > 0 },
    { key: 'services', label: 'En az bir aktif hizmet', done: counts.services > 0 },
    { key: 'employees', label: 'Vardiyası ve hizmeti tanımlı en az bir çalışan', done: counts.bookable_employees > 0 },
  ];
  return { items, complete: items.every((i) => i.done) };
}

function dayRange(date: string, tz: string, days = 1) {
  return { from: zonedToUtc(date, 0, tz), to: zonedToUtc(addDaysLocal(date, days), 0, tz) };
}

export function registerPanelRoutes(r: Router) {
  // --- İşletme oluşturma (kurulum sihirbazı 2. adım) -------------------------
  r.post('/api/panel/businesses', async (ctx) => {
    const user = requireUser(ctx);
    rateLimit(`biz-create:${user.id}`, 5, 86_400_000);
    const body = await ctx.json(businessInfoSchema);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM businesses WHERE owner_user_id = ${user.id}`;
    if (n >= 5) throw badRequest('Bir hesapla en fazla 5 işletme oluşturulabilir.');
    const slug = await uniqueSlug(body.name, null);
    const created = await sql.begin(async (tx) => {
      const [b] = await tx<{ id: string }[]>`
        INSERT INTO businesses (owner_user_id, name, slug, business_type, description, phone, email, website, instagram, setup_step)
        VALUES (${user.id}, ${body.name}, ${slug}, ${body.business_type}, ${body.description}, ${body.phone}, ${body.email}, ${body.website}, ${body.instagram}, 3)
        RETURNING id`;
      await tx`INSERT INTO business_members (business_id, user_id, role) VALUES (${b.id}, ${user.id}, 'owner')`;
      const catIds = body.category_ids?.length
        ? body.category_ids
        : (await tx<{ id: string }[]>`SELECT id FROM categories WHERE business_type = ${body.business_type} AND is_active LIMIT 1`).map((c) => c.id);
      for (const c of catIds) await tx`INSERT INTO business_categories (business_id, category_id) VALUES (${b.id}, ${c}) ON CONFLICT DO NOTHING`;
      const [free] = await tx<{ id: string }[]>`SELECT id FROM plans WHERE code = 'free'`;
      if (free) await tx`INSERT INTO subscriptions (business_id, plan_id, status) VALUES (${b.id}, ${free.id}, 'active')`;
      await audit({ actor: user.id, businessId: b.id, action: 'business.create', targetType: 'business', targetId: b.id, ip: ctx.ip }, tx);
      return b;
    });
    ctx.status = 201;
    return { id: created.id, slug };
  });

  r.get('/api/panel/:bid', async (ctx) => {
    const m = await member(ctx);
    return businessDetail(m.business_id, m);
  });

  r.patch('/api/panel/:bid/info', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const body = await ctx.json(businessInfoSchema);
    await sql.begin(async (tx) => {
      await tx`UPDATE businesses SET name = ${body.name}, business_type = ${body.business_type}, description = ${body.description},
               phone = ${body.phone}, email = ${body.email}, website = ${body.website}, instagram = ${body.instagram}
               WHERE id = ${m.business_id}`;
      if (body.category_ids) {
        await tx`DELETE FROM business_categories WHERE business_id = ${m.business_id}`;
        for (const c of body.category_ids) await tx`INSERT INTO business_categories (business_id, category_id) VALUES (${m.business_id}, ${c}) ON CONFLICT DO NOTHING`;
      }
      await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'business.update_info', ip: ctx.ip }, tx);
    });
    return { ok: true };
  });

  r.patch('/api/panel/:bid/address', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const body = await ctx.json(addressSchema);
    const [cur] = await sql<{ latitude: number | null; longitude: number | null; slug: string; name: string; verification_status: string }[]>`
      SELECT latitude, longitude, slug, name, verification_status FROM businesses WHERE id = ${m.business_id}`;
    const moved = cur.latitude !== (body.latitude ?? null) || cur.longitude !== (body.longitude ?? null);
    // Yayına girmemiş işletmenin adresini ilk kez girdiğinde URL'yi şehirle birlikte güzelleştir
    const slug = cur.verification_status === 'draft' ? await uniqueSlug(cur.name, body.district, m.business_id) : cur.slug;
    await sql`UPDATE businesses SET city = ${body.city}, district = ${body.district}, neighborhood = ${body.neighborhood}, address = ${body.address},
              latitude = ${body.latitude ?? null}, longitude = ${body.longitude ?? null}, slug = ${slug},
              location_verified = CASE WHEN ${moved} THEN false ELSE location_verified END
              WHERE id = ${m.business_id}`;
    await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'business.update_address', ip: ctx.ip });
    return { ok: true, slug };
  });

  r.patch('/api/panel/:bid/setup-step', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const { step } = await ctx.json(z.object({ step: z.number().int().min(2).max(10) }));
    await sql`UPDATE businesses SET setup_step = GREATEST(setup_step, ${step}) WHERE id = ${m.business_id}`;
    return { ok: true };
  });

  r.put('/api/panel/:bid/hours', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const { days } = await ctx.json(z.object({ days: z.array(daySchema).max(7) }));
    await sql.begin(async (tx) => {
      await tx`DELETE FROM business_hours WHERE business_id = ${m.business_id}`;
      for (const d of days) {
        assertNoOverlap(d.intervals, 'Çalışma saatleri');
        for (const i of d.intervals) {
          await tx`INSERT INTO business_hours (business_id, weekday, opening_time, closing_time) VALUES (${m.business_id}, ${d.weekday}, ${i.start}, ${i.end})`;
        }
      }
      await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'business.update_hours', ip: ctx.ip }, tx);
    });
    return { ok: true };
  });

  r.put('/api/panel/:bid/settings', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const s = await ctx.json(settingsSchema);
    await sql`UPDATE businesses SET auto_confirm = ${s.auto_confirm}, booking_window_days = ${s.booking_window_days},
              min_notice_minutes = ${s.min_notice_minutes}, cancel_min_hours = ${s.cancel_min_hours}, slot_interval_minutes = ${s.slot_interval_minutes},
              allow_employee_choice = ${s.allow_employee_choice}, accept_new_customers = ${s.accept_new_customers},
              online_booking_enabled = ${s.online_booking_enabled}, pending_expiry_minutes = ${s.pending_expiry_minutes},
              cancellation_policy = ${s.cancellation_policy}, publication_status = COALESCE(${s.publication_status ?? null}, publication_status)
              WHERE id = ${m.business_id}`;
    await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'business.update_settings', metadata: s, ip: ctx.ip });
    return { ok: true };
  });

  r.post('/api/panel/:bid/submit', async (ctx) => {
    const m = await member(ctx, OWNER);
    const d = await businessDetail(m.business_id, m);
    if (!d.checklist.complete) {
      throw new HttpError(422, 'incomplete', 'Başvuru için eksik adımlar var: ' + d.checklist.items.filter((i) => !i.done).map((i) => i.label).join(', '));
    }
    const status = (d.business as { verification_status: string }).verification_status;
    if (!['draft', 'rejected'].includes(status)) throw conflict('Başvurunuz zaten gönderilmiş.');
    await sql`UPDATE businesses SET verification_status = 'pending_review', submitted_at = now(), setup_step = 10 WHERE id = ${m.business_id}`;
    const admins = await sql<{ id: string }[]>`SELECT id FROM users WHERE platform_role = 'admin' AND account_status = 'active'`;
    for (const a of admins) {
      await notify(sql, { userId: a.id, type: 'admin_business_submitted', title: 'Yeni işletme başvurusu', body: `${(d.business as { name: string }).name} incelemenizi bekliyor.`, link: '/yonetim/basvurular', dedupeKey: `submitted:${m.business_id}:${Date.now()}` });
    }
    await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'business.submit', ip: ctx.ip });
    return { ok: true };
  });

  // --- Kapalı günler / istisnalar ------------------------------------------
  r.get('/api/panel/:bid/closures', async (ctx) => {
    const m = await member(ctx);
    return sql`SELECT id, start_at, end_at, reason FROM business_closures WHERE business_id = ${m.business_id} AND end_at > now() - interval '30 days' ORDER BY start_at`;
  });
  r.post('/api/panel/:bid/closures', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const body = await ctx.json(z.object({ start_date: localDate, end_date: localDate, start_time: hhmm.optional(), end_time: hhmm.optional(), reason: optionalText(200) }));
    const [b] = await sql<{ timezone: string }[]>`SELECT timezone FROM businesses WHERE id = ${m.business_id}`;
    const start = zonedToUtc(body.start_date, body.start_time ? timeToMinutes(body.start_time) : 0, b.timezone);
    const end = body.end_time ? zonedToUtc(body.end_date, timeToMinutes(body.end_time), b.timezone) : zonedToUtc(addDaysLocal(body.end_date, 1), 0, b.timezone);
    if (end <= start) throw badRequest('Bitiş, başlangıçtan sonra olmalı.');
    const [c] = await sql<{ id: string }[]>`INSERT INTO business_closures (business_id, start_at, end_at, reason) VALUES (${m.business_id}, ${start}, ${end}, ${body.reason}) RETURNING id`;
    const affected = await sql`SELECT public_reference, start_at FROM appointments WHERE business_id = ${m.business_id} AND status IN ('pending', 'confirmed') AND occupied && tstzrange(${start}, ${end})`;
    await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'business.add_closure', targetId: c.id, ip: ctx.ip });
    ctx.status = 201;
    return { id: c.id, affectedAppointments: affected };
  });
  r.delete('/api/panel/:bid/closures/:id', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const res = await sql`DELETE FROM business_closures WHERE id = ${uuid.parse(ctx.params.id)} AND business_id = ${m.business_id}`;
    if (!res.count) throw notFound();
    return { ok: true };
  });

  // --- İstasyonlar ---------------------------------------------------------
  r.get('/api/panel/:bid/stations', async (ctx) => {
    const m = await member(ctx);
    return sql`SELECT s.*, ARRAY(SELECT service_id FROM station_services ss WHERE ss.station_id = s.id) AS service_ids
               FROM stations s WHERE s.business_id = ${m.business_id} ORDER BY s.sort_order, s.created_at`;
  });
  r.post('/api/panel/:bid/stations', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const body = await ctx.json(stationSchema);
    const id = await sql.begin(async (tx) => {
      await assertOwned(tx, 'services', body.service_ids, m.business_id);
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM stations WHERE business_id = ${m.business_id}`;
      const [s] = await tx<{ id: string }[]>`
        INSERT INTO stations (business_id, name, station_type, description, capacity, is_active, sort_order)
        VALUES (${m.business_id}, ${body.name}, ${body.station_type}, ${body.description}, ${body.capacity}, ${body.is_active}, ${n}) RETURNING id`;
      for (const sid of body.service_ids) await tx`INSERT INTO station_services (station_id, service_id) VALUES (${s.id}, ${sid})`;
      await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'station.create', targetType: 'station', targetId: s.id, ip: ctx.ip }, tx);
      return s.id;
    });
    ctx.status = 201;
    return { id };
  });
  r.put('/api/panel/:bid/stations/:id', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const id = uuid.parse(ctx.params.id);
    const body = await ctx.json(stationSchema);
    await sql.begin(async (tx) => {
      await assertOwned(tx, 'stations', [id], m.business_id);
      await assertOwned(tx, 'services', body.service_ids, m.business_id);
      await tx`UPDATE stations SET name = ${body.name}, station_type = ${body.station_type}, description = ${body.description},
               capacity = ${body.capacity}, is_active = ${body.is_active} WHERE id = ${id}`;
      await tx`DELETE FROM station_services WHERE station_id = ${id}`;
      for (const sid of body.service_ids) await tx`INSERT INTO station_services (station_id, service_id) VALUES (${id}, ${sid})`;
      await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'station.update', targetType: 'station', targetId: id, ip: ctx.ip }, tx);
    });
    return { ok: true };
  });
  r.delete('/api/panel/:bid/stations/:id', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const id = uuid.parse(ctx.params.id);
    const [used] = await sql`SELECT 1 FROM appointments WHERE station_id = ${id} LIMIT 1`;
    if (used) {
      // Geçmiş randevular korunur; istasyon silinmez, pasifleştirilir.
      await sql`UPDATE stations SET is_active = false WHERE id = ${id} AND business_id = ${m.business_id}`;
      return { ok: true, deactivated: true };
    }
    const res = await sql`DELETE FROM stations WHERE id = ${id} AND business_id = ${m.business_id}`;
    if (!res.count) throw notFound();
    return { ok: true };
  });

  // --- Hizmetler -----------------------------------------------------------
  r.get('/api/panel/:bid/service-templates', async (ctx) => {
    const m = await member(ctx);
    return sql`SELECT t.id, t.name, t.default_duration_minutes, c.id AS category_id, c.name AS category FROM service_templates t
               JOIN categories c ON c.id = t.category_id
               WHERE c.business_type = (SELECT business_type FROM businesses WHERE id = ${m.business_id}) OR c.id IN (SELECT category_id FROM business_categories WHERE business_id = ${m.business_id})
               ORDER BY c.sort_order, t.sort_order`;
  });
  r.get('/api/panel/:bid/services', async (ctx) => {
    const m = await member(ctx);
    return sql`SELECT s.id, s.name, s.description, s.category_id, s.duration_minutes, s.preparation_minutes, s.cleanup_minutes, s.price_type,
                      s.price_amount::text, s.price_max_amount::text, s.photo_url, s.is_active, s.sort_order,
                      ARRAY(SELECT employee_id FROM employee_services es WHERE es.service_id = s.id) AS employee_ids,
                      ARRAY(SELECT station_id FROM station_services ss WHERE ss.service_id = s.id) AS station_ids
               FROM services s WHERE s.business_id = ${m.business_id} ORDER BY s.is_active DESC, s.sort_order, s.name`;
  });
  r.post('/api/panel/:bid/services', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const body = await ctx.json(serviceSchema);
    const limits = await planLimits(m.business_id);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM services WHERE business_id = ${m.business_id} AND is_active`;
    const max = Number(limits.feature_limits.max_services ?? 15);
    if (n >= max) throw new HttpError(402, 'plan_limit', `${limits.name} paketinde en fazla ${max} aktif hizmet tanımlanabilir.`);
    const id = await sql.begin(async (tx) => {
      await assertOwned(tx, 'employees', body.employee_ids, m.business_id);
      await assertOwned(tx, 'stations', body.station_ids, m.business_id);
      const [s] = await tx<{ id: string }[]>`
        INSERT INTO services (business_id, category_id, name, description, duration_minutes, preparation_minutes, cleanup_minutes,
                              price_type, price_amount, price_max_amount, is_active, photo_url, sort_order)
        VALUES (${m.business_id}, ${body.category_id ?? null}, ${body.name}, ${body.description}, ${body.duration_minutes},
                ${body.preparation_minutes}, ${body.cleanup_minutes}, ${body.price_type},
                ${body.price_type === 'consultation' ? (body.price_amount ?? null) : body.price_amount!}, ${body.price_type === 'range' ? body.price_max_amount! : null},
                ${body.is_active}, ${body.photo_url ?? null}, ${n}) RETURNING id`;
      for (const e of body.employee_ids) await tx`INSERT INTO employee_services (employee_id, service_id) VALUES (${e}, ${s.id})`;
      for (const st of body.station_ids) await tx`INSERT INTO station_services (station_id, service_id) VALUES (${st}, ${s.id})`;
      await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'service.create', targetType: 'service', targetId: s.id, ip: ctx.ip }, tx);
      return s.id;
    });
    ctx.status = 201;
    return { id };
  });
  r.put('/api/panel/:bid/services/:id', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const id = uuid.parse(ctx.params.id);
    const body = await ctx.json(serviceSchema);
    await sql.begin(async (tx) => {
      await assertOwned(tx, 'services', [id], m.business_id);
      await assertOwned(tx, 'employees', body.employee_ids, m.business_id);
      await assertOwned(tx, 'stations', body.station_ids, m.business_id);
      // Fiyat/süre değişikliği mevcut randevuları etkilemez: randevular kendi anlık görüntüsünü saklar.
      await tx`UPDATE services SET category_id = ${body.category_id ?? null}, name = ${body.name}, description = ${body.description},
               duration_minutes = ${body.duration_minutes}, preparation_minutes = ${body.preparation_minutes}, cleanup_minutes = ${body.cleanup_minutes},
               price_type = ${body.price_type}, price_amount = ${body.price_amount ?? null},
               price_max_amount = ${body.price_type === 'range' ? body.price_max_amount! : null}, is_active = ${body.is_active},
               photo_url = ${body.photo_url ?? null} WHERE id = ${id}`;
      await tx`DELETE FROM employee_services WHERE service_id = ${id}`;
      await tx`DELETE FROM station_services WHERE service_id = ${id}`;
      for (const e of body.employee_ids) await tx`INSERT INTO employee_services (employee_id, service_id) VALUES (${e}, ${id})`;
      for (const st of body.station_ids) await tx`INSERT INTO station_services (station_id, service_id) VALUES (${st}, ${id})`;
      await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'service.update', targetType: 'service', targetId: id, metadata: { price_amount: body.price_amount, duration: body.duration_minutes }, ip: ctx.ip }, tx);
    });
    return { ok: true };
  });
  r.delete('/api/panel/:bid/services/:id', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const id = uuid.parse(ctx.params.id);
    const [used] = await sql`SELECT 1 FROM appointment_services WHERE service_id = ${id} LIMIT 1`;
    if (used) {
      await sql`UPDATE services SET is_active = false WHERE id = ${id} AND business_id = ${m.business_id}`;
      return { ok: true, deactivated: true };
    }
    const res = await sql`DELETE FROM services WHERE id = ${id} AND business_id = ${m.business_id}`;
    if (!res.count) throw notFound();
    return { ok: true };
  });

  // --- Çalışanlar ----------------------------------------------------------
  r.get('/api/panel/:bid/employees', async (ctx) => {
    const m = await member(ctx);
    return sql`
      SELECT e.id, e.display_name, e.title, e.description, e.photo_url, e.is_active, e.accepts_bookings, e.user_id, e.sort_order,
             ARRAY(SELECT service_id FROM employee_services es WHERE es.employee_id = e.id) AS service_ids,
             COALESCE((SELECT json_agg(json_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI')) ORDER BY weekday, start_time)
                       FROM employee_hours h WHERE h.employee_id = e.id), '[]') AS hours,
             COALESCE((SELECT json_agg(json_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI')) ORDER BY weekday, start_time)
                       FROM employee_breaks x WHERE x.employee_id = e.id), '[]') AS breaks,
             (SELECT count(*)::int FROM appointments a WHERE a.employee_id = e.id AND a.status IN ('pending', 'confirmed') AND a.start_at > now()) AS upcoming_count
      FROM employees e WHERE e.business_id = ${m.business_id} ORDER BY e.is_active DESC, e.sort_order, e.display_name`;
  });
  r.post('/api/panel/:bid/employees', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const body = await ctx.json(employeeSchema);
    const limits = await planLimits(m.business_id);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE business_id = ${m.business_id} AND is_active`;
    const max = Number(limits.feature_limits.max_employees ?? 2);
    if (n >= max) throw new HttpError(402, 'plan_limit', `${limits.name} paketinde en fazla ${max} aktif çalışan tanımlanabilir.`);
    const id = await sql.begin(async (tx) => {
      await assertOwned(tx, 'services', body.service_ids, m.business_id);
      const [e] = await tx<{ id: string }[]>`
        INSERT INTO employees (business_id, display_name, title, description, photo_url, is_active, accepts_bookings, sort_order)
        VALUES (${m.business_id}, ${body.display_name}, ${body.title}, ${body.description}, ${body.photo_url ?? null}, ${body.is_active}, ${body.accepts_bookings}, ${n})
        RETURNING id`;
      for (const s of body.service_ids) await tx`INSERT INTO employee_services (employee_id, service_id) VALUES (${e.id}, ${s})`;
      await saveEmployeeSchedule(tx, e.id, body.hours, body.breaks);
      await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'employee.create', targetType: 'employee', targetId: e.id, ip: ctx.ip }, tx);
      return e.id;
    });
    ctx.status = 201;
    return { id };
  });
  r.put('/api/panel/:bid/employees/:id', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const id = uuid.parse(ctx.params.id);
    const body = await ctx.json(employeeSchema);
    await sql.begin(async (tx) => {
      await assertOwned(tx, 'employees', [id], m.business_id);
      await assertOwned(tx, 'services', body.service_ids, m.business_id);
      await tx`UPDATE employees SET display_name = ${body.display_name}, title = ${body.title}, description = ${body.description},
               photo_url = ${body.photo_url ?? null}, is_active = ${body.is_active}, accepts_bookings = ${body.accepts_bookings} WHERE id = ${id}`;
      await tx`DELETE FROM employee_services WHERE employee_id = ${id}`;
      for (const s of body.service_ids) await tx`INSERT INTO employee_services (employee_id, service_id) VALUES (${id}, ${s})`;
      await saveEmployeeSchedule(tx, id, body.hours, body.breaks);
      await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'employee.update', targetType: 'employee', targetId: id, metadata: { is_active: body.is_active }, ip: ctx.ip }, tx);
    });
    // Pasifleştirme / değişiklik sonrası yeniden planlanması gereken gelecekteki randevular
    const affected = await sql`SELECT a.id, a.public_reference, a.start_at, a.status FROM appointments a
      WHERE a.employee_id = ${id} AND a.status IN ('pending', 'confirmed') AND a.start_at > now() ORDER BY a.start_at`;
    return { ok: true, futureAppointments: body.is_active && body.accepts_bookings ? [] : affected };
  });
  r.get('/api/panel/:bid/employees/:id/time-off', async (ctx) => {
    const m = await member(ctx);
    const id = uuid.parse(ctx.params.id);
    await assertOwned(sql, 'employees', [id], m.business_id);
    return sql`SELECT id, start_at, end_at, reason FROM employee_time_off WHERE employee_id = ${id} AND end_at > now() - interval '30 days' ORDER BY start_at`;
  });
  r.post('/api/panel/:bid/employees/:id/time-off', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const id = uuid.parse(ctx.params.id);
    await assertOwned(sql, 'employees', [id], m.business_id);
    const body = await ctx.json(z.object({ start_date: localDate, end_date: localDate, start_time: hhmm.optional(), end_time: hhmm.optional(), reason: optionalText(200) }));
    const [b] = await sql<{ timezone: string }[]>`SELECT timezone FROM businesses WHERE id = ${m.business_id}`;
    const start = zonedToUtc(body.start_date, body.start_time ? timeToMinutes(body.start_time) : 0, b.timezone);
    const end = body.end_time ? zonedToUtc(body.end_date, timeToMinutes(body.end_time), b.timezone) : zonedToUtc(addDaysLocal(body.end_date, 1), 0, b.timezone);
    if (end <= start) throw badRequest('Bitiş, başlangıçtan sonra olmalı.');
    const [t] = await sql<{ id: string }[]>`INSERT INTO employee_time_off (employee_id, start_at, end_at, reason) VALUES (${id}, ${start}, ${end}, ${body.reason}) RETURNING id`;
    const affected = await sql`SELECT public_reference, start_at FROM appointments WHERE employee_id = ${id} AND status IN ('pending', 'confirmed') AND occupied && tstzrange(${start}, ${end})`;
    await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'employee.time_off', targetType: 'employee', targetId: id, ip: ctx.ip });
    ctx.status = 201;
    return { id: t.id, affectedAppointments: affected };
  });
  r.delete('/api/panel/:bid/employees/:eid/time-off/:id', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const eid = uuid.parse(ctx.params.eid);
    await assertOwned(sql, 'employees', [eid], m.business_id);
    const res = await sql`DELETE FROM employee_time_off WHERE id = ${uuid.parse(ctx.params.id)} AND employee_id = ${eid}`;
    if (!res.count) throw notFound();
    return { ok: true };
  });

  // --- Ekip üyeleri ve davetler -------------------------------------------
  r.get('/api/panel/:bid/members', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    return sql`SELECT bm.id, bm.role, bm.invitation_status, bm.invite_email, bm.invite_expires_at, bm.employee_id, bm.created_at,
                      u.full_name, u.email, e.display_name AS employee_name
               FROM business_members bm LEFT JOIN users u ON u.id = bm.user_id LEFT JOIN employees e ON e.id = bm.employee_id
               WHERE bm.business_id = ${m.business_id} AND bm.invitation_status <> 'revoked' ORDER BY bm.created_at`;
  });
  r.post('/api/panel/:bid/members/invite', async (ctx) => {
    const m = await member(ctx, OWNER);
    rateLimit(`invite:${m.business_id}`, 20, 86_400_000);
    const body = await ctx.json(z.object({ email: emailSchema, role: z.enum(['manager', 'staff']), employee_id: uuid.nullable().optional() }));
    if (body.employee_id) await assertOwned(sql, 'employees', [body.employee_id], m.business_id);
    if (body.role === 'staff' && !body.employee_id) throw badRequest('Çalışan rolü için bir çalışan kaydı seçin.', { employee_id: 'Çalışan seçin.' });
    const [existing] = await sql`SELECT 1 FROM business_members bm JOIN users u ON u.id = bm.user_id
      WHERE bm.business_id = ${m.business_id} AND lower(u.email) = ${body.email} AND bm.invitation_status = 'accepted'`;
    if (existing) throw conflict('Bu kişi zaten ekipte.');
    const token = randomToken(32);
    const [inv] = await sql<{ id: string }[]>`
      INSERT INTO business_members (business_id, role, invitation_status, invite_email, invite_token_hash, invite_expires_at, employee_id)
      VALUES (${m.business_id}, ${body.role}, 'pending', ${body.email}, ${sha256(token)}, now() + interval '7 days', ${body.employee_id ?? null}) RETURNING id`;
    const link = `/davet/${token}`;
    const [b] = await sql<{ name: string }[]>`SELECT name FROM businesses WHERE id = ${m.business_id}`;
    if (emailConfigured()) {
      await sql`INSERT INTO outbound_messages (channel, recipient, subject, body) VALUES ('email', ${body.email}, ${`${b.name} sizi KOLTUK'a davet etti`},
        ${`${b.name} işletmesi sizi ekibine davet etti. Daveti kabul etmek için (7 gün geçerli):\n${config.appUrl}${link}`})`;
    }
    await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'member.invite', targetType: 'member', targetId: inv.id, metadata: { role: body.role }, ip: ctx.ip });
    ctx.status = 201;
    // Bağlantı yalnızca işletme sahibine gösterilir; e-posta servisi yoksa davetliye kendisi iletir.
    return { id: inv.id, inviteLink: link, emailSent: emailConfigured() };
  });
  r.delete('/api/panel/:bid/members/:id', async (ctx) => {
    const m = await member(ctx, OWNER);
    const id = uuid.parse(ctx.params.id);
    const [target] = await sql<{ role: string }[]>`SELECT role FROM business_members WHERE id = ${id} AND business_id = ${m.business_id}`;
    if (!target) throw notFound();
    if (target.role === 'owner') throw badRequest('İşletme sahibi ekipten çıkarılamaz.');
    await sql`UPDATE business_members SET invitation_status = 'revoked', invite_token_hash = NULL WHERE id = ${id}`;
    await audit({ actor: ctx.user!.id, businessId: m.business_id, action: 'member.revoke', targetType: 'member', targetId: id, ip: ctx.ip });
    return { ok: true };
  });

  r.get('/api/invitations/:token', async (ctx) => {
    const [inv] = await sql<{ business_name: string; role: string; invite_email: string; expired: boolean }[]>`
      SELECT b.name AS business_name, bm.role, bm.invite_email, bm.invite_expires_at < now() AS expired
      FROM business_members bm JOIN businesses b ON b.id = bm.business_id
      WHERE bm.invite_token_hash = ${sha256(ctx.params.token)} AND bm.invitation_status = 'pending'`;
    if (!inv) throw notFound('Davet bulunamadı veya kullanılmış.');
    const [local, domain] = inv.invite_email.split('@');
    return { business_name: inv.business_name, role: inv.role, expired: inv.expired, email_hint: `${local.slice(0, 2)}***@${domain}` };
  });
  r.post('/api/invitations/:token/accept', async (ctx) => {
    const user = requireUser(ctx);
    rateLimit(`inv-accept:${user.id}`, 10, 3_600_000);
    return sql.begin(async (tx) => {
      const [inv] = await tx<{ id: string; business_id: string; invite_email: string; employee_id: string | null; role: string; expired: boolean }[]>`
        SELECT id, business_id, invite_email, employee_id, role, invite_expires_at < now() AS expired FROM business_members
        WHERE invite_token_hash = ${sha256(ctx.params.token)} AND invitation_status = 'pending' FOR UPDATE`;
      if (!inv) throw notFound('Davet bulunamadı veya kullanılmış.');
      if (inv.expired) throw badRequest('Davetin süresi dolmuş. İşletmeden yeni davet isteyin.');
      // Davet yalnızca davet edilen e-posta adresine sahip ve bu adresi doğrulamış hesap tarafından kabul edilebilir.
      if (user.email.toLowerCase() !== inv.invite_email.toLowerCase()) throw forbidden('Bu davet farklı bir e-posta adresine gönderilmiş.');
      if (!user.email_verified_at) throw new HttpError(403, 'email_unverified', 'Daveti kabul etmek için önce e-posta adresinizi doğrulayın.');
      const [already] = await tx`SELECT 1 FROM business_members WHERE business_id = ${inv.business_id} AND user_id = ${user.id} AND invitation_status = 'accepted'`;
      if (already) throw conflict('Zaten bu işletmenin ekibindesiniz.');
      await tx`UPDATE business_members SET user_id = ${user.id}, invitation_status = 'accepted', invite_token_hash = NULL WHERE id = ${inv.id}`;
      if (inv.employee_id) await tx`UPDATE employees SET user_id = ${user.id} WHERE id = ${inv.employee_id}`;
      await audit({ actor: user.id, businessId: inv.business_id, action: 'member.accept', targetType: 'member', targetId: inv.id, ip: ctx.ip }, tx);
      return { ok: true, business_id: inv.business_id };
    });
  });

  // --- Randevular ----------------------------------------------------------
  const apptSelect = sql`
    a.id, a.public_reference, a.start_at, a.end_at, a.status, a.source, a.price_snapshot::text, a.price_max_snapshot::text, a.price_type_snapshot,
    a.duration_snapshot, a.preparation_minutes, a.cleanup_minutes, a.customer_note, a.business_note, a.cancellation_reason, a.created_at, a.pending_expires_at,
    a.employee_id, e.display_name AS employee_name, a.station_id, st.name AS station_name, a.customer_user_id,
    COALESCE(u.full_name, a.customer_name) AS customer_name,
    (SELECT json_agg(json_build_object('service_id', s.service_id, 'name', s.name_snapshot, 'duration', s.duration_snapshot,
       'price_type', s.price_type_snapshot, 'price', s.price_snapshot::text, 'price_max', s.price_max_snapshot::text) ORDER BY s.position)
     FROM appointment_services s WHERE s.appointment_id = a.id) AS services,
    (SELECT json_build_object('id', p.id, 'start_at', p.proposed_start_at, 'status', p.status) FROM appointment_proposals p
     WHERE p.appointment_id = a.id AND p.status = 'open') AS open_proposal`;
  const fromAppts = sql`appointments a JOIN employees e ON e.id = a.employee_id LEFT JOIN stations st ON st.id = a.station_id LEFT JOIN users u ON u.id = a.customer_user_id`;

  /** Çalışan rolü yalnızca kendi randevularını görür; telefon numaraları yalnızca yöneticilere gösterilir */
  const scopeFilter = (m: Membership) => (m.role === 'staff' ? sql`AND a.employee_id = ${m.employee_id ?? '00000000-0000-0000-0000-000000000000'}` : sql``);
  const phoneCol = (m: Membership) => (m.role === 'staff' ? sql`NULL::text AS customer_phone` : sql`COALESCE(u.phone, a.customer_phone) AS customer_phone`);

  r.get('/api/panel/:bid/appointments', async (ctx) => {
    const m = await member(ctx);
    const status = ctx.query.get('status');
    const ref = ctx.query.get('ref')?.trim().toUpperCase() || null;
    const q = ctx.query.get('q')?.trim() || null;
    const from = ctx.query.get('from');
    const to = ctx.query.get('to');
    const [b] = await sql<{ timezone: string }[]>`SELECT timezone FROM businesses WHERE id = ${m.business_id}`;
    const fromTs = from && localDate.safeParse(from).success ? zonedToUtc(from, 0, b.timezone) : null;
    const toTs = to && localDate.safeParse(to).success ? zonedToUtc(addDaysLocal(to, 1), 0, b.timezone) : null;
    const statuses = status === 'active' ? ['pending', 'confirmed'] : status === 'cancelled' ? ['cancelled_by_customer', 'cancelled_by_business', 'rejected', 'expired'] : status ? [status] : null;
    return sql`
      SELECT ${apptSelect}, ${phoneCol(m)} FROM ${fromAppts}
      WHERE a.business_id = ${m.business_id} ${scopeFilter(m)}
        AND (${statuses}::text[] IS NULL OR a.status = ANY(${statuses}::text[]))
        AND (${ref}::text IS NULL OR a.public_reference = ${ref})
        AND (${q}::text IS NULL OR COALESCE(u.full_name, a.customer_name) ILIKE ${'%' + (q ?? '') + '%'})
        AND (${fromTs}::timestamptz IS NULL OR a.start_at >= ${fromTs})
        AND (${toTs}::timestamptz IS NULL OR a.start_at < ${toTs})
      ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.start_at ${status === 'active' || status === 'pending' ? sql`ASC` : sql`DESC`}
      LIMIT 200`;
  });

  r.get('/api/panel/:bid/appointments/:id', async (ctx) => {
    const m = await member(ctx);
    const [a] = await sql<Record<string, unknown>[]>`SELECT ${apptSelect}, ${phoneCol(m)} FROM ${fromAppts}
      WHERE a.id = ${uuid.parse(ctx.params.id)} AND a.business_id = ${m.business_id} ${scopeFilter(m)}`;
    if (!a) throw notFound('Randevu bulunamadı.');
    const events = await sql`SELECT ev.event_type, ev.from_status, ev.to_status, ev.note, ev.created_at, u.full_name AS actor
      FROM appointment_events ev LEFT JOIN users u ON u.id = ev.actor_user_id WHERE ev.appointment_id = ${a.id as string} ORDER BY ev.created_at`;
    return { ...a, events };
  });

  r.post('/api/panel/:bid/appointments', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const body = await ctx.json(
      z.object({
        service_ids: z.array(uuid).min(1).max(5),
        employee_id: uuid.nullable().optional(),
        start_at: z.string().datetime({ offset: true }),
        customer_name: trimmed(2, 120),
        customer_phone: optionalPhone,
        customer_note: optionalText(500),
        idempotency_key: z.string().min(8).max(80),
      }),
    );
    // İşletme kendi müşterisini (platform hesabı olmadan) manuel ekler; kişi bilgisi yalnızca bu işletmenin kaydıdır.
    const result = await createAppointment({
      businessId: m.business_id,
      serviceIds: body.service_ids,
      employeeId: body.employee_id ?? null,
      startAt: new Date(body.start_at),
      idempotencyKey: body.idempotency_key,
      customerNote: body.customer_note,
      actorUserId: ctx.user!.id,
      customerUserId: null,
      customerName: body.customer_name,
      customerPhone: body.customer_phone,
      source: 'manual',
      forceConfirmed: true,
      ip: ctx.ip,
    });
    ctx.status = 201;
    return result;
  });

  r.post('/api/panel/:bid/appointments/:id/status', async (ctx) => {
    const m = await member(ctx);
    const body = await ctx.json(z.object({ action: z.enum(['confirm', 'reject', 'cancel_business', 'complete', 'no_show']), reason: optionalText(300) }));
    const id = uuid.parse(ctx.params.id);
    const [a] = await sql`SELECT 1 FROM appointments WHERE id = ${id} AND business_id = ${m.business_id}`;
    if (!a) throw notFound('Randevu bulunamadı.');
    return transitionAppointment(id, body.action as TransitionAction, { kind: 'business', userId: ctx.user!.id, role: m.role, employeeId: m.employee_id }, { reason: body.reason, ip: ctx.ip });
  });

  r.patch('/api/panel/:bid/appointments/:id/note', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const { business_note } = await ctx.json(z.object({ business_note: optionalText(1000) }));
    const res = await sql`UPDATE appointments SET business_note = ${business_note} WHERE id = ${uuid.parse(ctx.params.id)} AND business_id = ${m.business_id}`;
    if (!res.count) throw notFound();
    return { ok: true };
  });

  r.post('/api/panel/:bid/appointments/:id/reschedule', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const body = await ctx.json(z.object({ start_at: z.string().datetime({ offset: true }), employee_id: uuid.nullable().optional() }));
    if (body.employee_id) await assertOwned(sql, 'employees', [body.employee_id], m.business_id);
    return rescheduleByBusiness(uuid.parse(ctx.params.id), m.business_id, new Date(body.start_at), body.employee_id ?? null, ctx.user!.id, ctx.ip);
  });

  r.post('/api/panel/:bid/appointments/:id/propose', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const body = await ctx.json(z.object({ start_at: z.string().datetime({ offset: true }), employee_id: uuid, note: optionalText(300) }));
    await assertOwned(sql, 'employees', [body.employee_id], m.business_id);
    ctx.status = 201;
    return proposeNewTime(uuid.parse(ctx.params.id), m.business_id, new Date(body.start_at), body.employee_id, body.note, ctx.user!.id);
  });

  /** Panelden manuel randevu / saat değişikliği için boş saatler (ön bildirim ve pencere kuralları uygulanmaz) */
  r.get('/api/panel/:bid/slots', async (ctx) => {
    const m = await member(ctx);
    const services = (ctx.query.get('services') ?? '').split(',').filter(Boolean).map((s) => uuid.parse(s));
    const date = localDate.parse(ctx.query.get('date'));
    const employee = ctx.query.get('employee') ? uuid.parse(ctx.query.get('employee')) : null;
    const exclude = ctx.query.get('exclude') ? uuid.parse(ctx.query.get('exclude')) : null;
    if (exclude) {
      const [own] = await sql`SELECT 1 FROM appointments WHERE id = ${exclude} AND business_id = ${m.business_id}`;
      if (!own) throw notFound();
    }
    const data = await loadAvailabilityData(sql, m.business_id, date, date, exclude);
    const plan = buildPlan(data, services);
    const now = new Date();
    const slots = computeDaySlots(data, plan, date, { employeeId: employee, ignoreBookingRules: true }).filter((s) => new Date(s.startAt) > now);
    return { date, durationMinutes: plan.innerMinutes, eligibleEmployeeIds: plan.eligibleEmployeeIds, slots };
  });

  // --- Takvim ve genel bakış ----------------------------------------------
  r.get('/api/panel/:bid/calendar', async (ctx) => {
    const m = await member(ctx);
    const [b] = await sql<{ timezone: string }[]>`SELECT timezone FROM businesses WHERE id = ${m.business_id}`;
    const date = localDate.parse(ctx.query.get('date') ?? localDateOf(new Date(), b.timezone));
    const days = ctx.query.get('view') === 'week' ? 7 : 1;
    const { from, to } = dayRange(date, b.timezone, days);
    const employees = await sql`
      SELECT e.id, e.display_name, e.is_active, e.accepts_bookings,
             COALESCE((SELECT json_agg(json_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI')))
                       FROM employee_hours h WHERE h.employee_id = e.id), '[]') AS hours,
             COALESCE((SELECT json_agg(json_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI')))
                       FROM employee_breaks x WHERE x.employee_id = e.id), '[]') AS breaks
      FROM employees e WHERE e.business_id = ${m.business_id} AND e.is_active
        ${m.role === 'staff' ? sql`AND e.id = ${m.employee_id ?? '00000000-0000-0000-0000-000000000000'}` : sql``}
      ORDER BY e.sort_order, e.display_name`;
    const appointments = await sql`SELECT ${apptSelect}, ${phoneCol(m)} FROM ${fromAppts}
      WHERE a.business_id = ${m.business_id} ${scopeFilter(m)} AND a.start_at < ${to} AND a.end_at > ${from}
        AND a.status NOT IN ('expired') ORDER BY a.start_at`;
    const timeOff = await sql`SELECT t.employee_id, t.start_at, t.end_at, t.reason FROM employee_time_off t JOIN employees e ON e.id = t.employee_id
      WHERE e.business_id = ${m.business_id} AND t.start_at < ${to} AND t.end_at > ${from}`;
    const closures = await sql`SELECT start_at, end_at, reason FROM business_closures WHERE business_id = ${m.business_id} AND start_at < ${to} AND end_at > ${from}`;
    const hours = await sql`SELECT weekday, to_char(opening_time, 'HH24:MI') AS start, to_char(closing_time, 'HH24:MI') AS end FROM business_hours WHERE business_id = ${m.business_id}`;
    return { date, days, timezone: b.timezone, employees, appointments, timeOff, closures, hours };
  });

  r.get('/api/panel/:bid/overview', async (ctx) => {
    const m = await member(ctx);
    const [b] = await sql<{ timezone: string }[]>`SELECT timezone FROM businesses WHERE id = ${m.business_id}`;
    const today = localDateOf(new Date(), b.timezone);
    const { from, to } = dayRange(today, b.timezone);
    const scope = scopeFilter(m);
    const [stats] = await sql<Record<string, number | string>[]>`
      SELECT count(*) FILTER (WHERE a.status IN ('pending', 'confirmed', 'completed', 'no_show'))::int AS today_total,
             count(*) FILTER (WHERE a.status = 'completed')::int AS today_completed,
             count(*) FILTER (WHERE a.status IN ('cancelled_by_customer', 'cancelled_by_business'))::int AS today_cancelled,
             count(*) FILTER (WHERE a.status = 'no_show')::int AS today_no_show,
             COALESCE(sum(a.price_snapshot) FILTER (WHERE a.status IN ('confirmed', 'completed')), 0)::text AS today_estimated,
             COALESCE(sum(a.price_snapshot) FILTER (WHERE a.status = 'completed'), 0)::text AS today_completed_amount
      FROM appointments a WHERE a.business_id = ${m.business_id} ${scope} AND a.start_at >= ${from} AND a.start_at < ${to}`;
    const [{ pending }] = await sql<{ pending: number }[]>`SELECT count(*)::int AS pending FROM appointments a WHERE a.business_id = ${m.business_id} ${scope} AND a.status = 'pending'`;
    const upcoming = await sql`SELECT ${apptSelect}, ${phoneCol(m)} FROM ${fromAppts}
      WHERE a.business_id = ${m.business_id} ${scope} AND a.status IN ('pending', 'confirmed') AND a.start_at >= now() ORDER BY a.start_at LIMIT 8`;
    const topServices = await sql`SELECT s.name_snapshot AS name, count(*)::int AS n FROM appointment_services s JOIN appointments a ON a.id = s.appointment_id
      WHERE a.business_id = ${m.business_id} ${scope} AND a.start_at > now() - interval '30 days' AND a.status IN ('confirmed', 'completed')
      GROUP BY s.name_snapshot ORDER BY n DESC LIMIT 5`;
    const byEmployee = await sql`SELECT e.display_name AS name, count(a.id)::int AS n FROM employees e
      LEFT JOIN appointments a ON a.employee_id = e.id AND a.start_at >= ${from} AND a.start_at < ${to} AND a.status IN ('pending', 'confirmed', 'completed')
      WHERE e.business_id = ${m.business_id} AND e.is_active ${m.role === 'staff' ? sql`AND e.id = ${m.employee_id ?? '00000000-0000-0000-0000-000000000000'}` : sql``}
      GROUP BY e.id, e.display_name, e.sort_order ORDER BY e.sort_order`;
    const showMoney = m.role !== 'staff';
    return {
      today,
      stats: showMoney ? stats : { ...stats, today_estimated: null, today_completed_amount: null },
      pending,
      upcoming,
      topServices,
      byEmployee,
    };
  });

  // --- Müşteriler ----------------------------------------------------------
  r.get('/api/panel/:bid/customers', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const q = ctx.query.get('q')?.trim() || null;
    // Yalnızca bu işletmede randevusu olan kişiler; başka işletmelerdeki geçmiş gösterilmez.
    return sql`
      SELECT COALESCE(a.customer_user_id::text, 'manual:' || COALESCE(a.customer_phone, a.customer_name)) AS key,
             a.customer_user_id, max(COALESCE(u.full_name, a.customer_name)) AS name,
             max(COALESCE(u.phone, a.customer_phone)) AS phone,
             count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
             count(*) FILTER (WHERE a.status = 'no_show')::int AS no_show,
             count(*) FILTER (WHERE a.status IN ('cancelled_by_customer'))::int AS cancelled,
             count(*)::int AS total, max(a.start_at) FILTER (WHERE a.start_at < now()) AS last_visit,
             min(a.start_at) FILTER (WHERE a.start_at >= now() AND a.status IN ('pending', 'confirmed')) AS next_visit,
             bool_or(a.source = 'manual') AS manual
      FROM appointments a LEFT JOIN users u ON u.id = a.customer_user_id
      WHERE a.business_id = ${m.business_id}
        AND (${q}::text IS NULL OR COALESCE(u.full_name, a.customer_name) ILIKE ${'%' + (q ?? '') + '%'} OR COALESCE(u.phone, a.customer_phone) LIKE ${'%' + (q ?? '').replace(/\D/g, '') + '%'})
      GROUP BY 1, 2 ORDER BY max(a.start_at) DESC LIMIT 300`;
  });

  r.get('/api/panel/:bid/customers/history', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const key = ctx.query.get('key') ?? '';
    const userId = uuid.safeParse(key).success ? key : null;
    const manual = key.startsWith('manual:') ? key.slice(7) : null;
    if (!userId && !manual) throw badRequest('Geçersiz müşteri.');
    return sql`SELECT ${apptSelect}, ${phoneCol(m)} FROM ${fromAppts}
      WHERE a.business_id = ${m.business_id}
        AND (${userId}::uuid IS NOT NULL AND a.customer_user_id = ${userId}::uuid
             OR ${manual}::text IS NOT NULL AND a.customer_user_id IS NULL AND COALESCE(a.customer_phone, a.customer_name) = ${manual})
      ORDER BY a.start_at DESC LIMIT 100`;
  });

  // --- Yorumlar ------------------------------------------------------------
  r.get('/api/panel/:bid/reviews', async (ctx) => {
    const m = await member(ctx);
    return sql`SELECT r.id, r.rating, r.comment, r.moderation_status, r.business_reply, r.business_reply_at, r.created_at, r.edited_at,
                      split_part(COALESCE(u.full_name, 'Silinmiş kullanıcı'), ' ', 1) AS author, a.public_reference,
                      (SELECT string_agg(s.name_snapshot, ', ') FROM appointment_services s WHERE s.appointment_id = r.appointment_id) AS services
               FROM reviews r JOIN appointments a ON a.id = r.appointment_id LEFT JOIN users u ON u.id = r.customer_user_id
               WHERE r.business_id = ${m.business_id} AND r.moderation_status <> 'removed' ORDER BY r.created_at DESC`;
  });
  r.post('/api/panel/:bid/reviews/:id/reply', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const { reply } = await ctx.json(z.object({ reply: trimmed(2, 1000) }));
    const [rv] = await sql<{ customer_user_id: string | null }[]>`
      UPDATE reviews SET business_reply = ${reply}, business_reply_at = now() WHERE id = ${uuid.parse(ctx.params.id)} AND business_id = ${m.business_id}
      RETURNING customer_user_id`;
    if (!rv) throw notFound();
    if (rv.customer_user_id) {
      await notify(sql, { userId: rv.customer_user_id, type: 'review_reply', title: 'Yorumunuza yanıt geldi', body: 'İşletme değerlendirmenize yanıt verdi.', link: '/hesabim/yorumlar', dedupeKey: `reply:${ctx.params.id}:${Date.now()}` });
    }
    return { ok: true };
  });

  // --- Raporlar ------------------------------------------------------------
  r.get('/api/panel/:bid/reports', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const [b] = await sql<{ timezone: string }[]>`SELECT timezone FROM businesses WHERE id = ${m.business_id}`;
    const today = localDateOf(new Date(), b.timezone);
    const fromD = localDate.safeParse(ctx.query.get('from')).success ? ctx.query.get('from')! : addDaysLocal(today, -29);
    const toD = localDate.safeParse(ctx.query.get('to')).success ? ctx.query.get('to')! : today;
    const from = zonedToUtc(fromD, 0, b.timezone);
    const to = zonedToUtc(addDaysLocal(toD, 1), 0, b.timezone);
    const daily = await sql`
      SELECT to_char(a.start_at AT TIME ZONE ${b.timezone}, 'YYYY-MM-DD') AS day,
             count(*) FILTER (WHERE a.status IN ('confirmed', 'completed', 'pending'))::int AS booked,
             count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
             count(*) FILTER (WHERE a.status IN ('cancelled_by_customer', 'cancelled_by_business'))::int AS cancelled,
             count(*) FILTER (WHERE a.status = 'no_show')::int AS no_show,
             COALESCE(sum(a.price_snapshot) FILTER (WHERE a.status = 'completed'), 0)::text AS completed_amount
      FROM appointments a WHERE a.business_id = ${m.business_id} AND a.start_at >= ${from} AND a.start_at < ${to}
      GROUP BY 1 ORDER BY 1`;
    const [totals] = await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'completed')::int AS completed,
             count(*) FILTER (WHERE status IN ('cancelled_by_customer', 'cancelled_by_business'))::int AS cancelled,
             count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
             count(*) FILTER (WHERE source = 'online')::int AS online,
             COALESCE(sum(price_snapshot) FILTER (WHERE status = 'completed'), 0)::text AS completed_amount,
             COALESCE(sum(price_snapshot) FILTER (WHERE status IN ('confirmed', 'pending') AND start_at >= now()), 0)::text AS upcoming_amount,
             count(DISTINCT customer_user_id)::int AS unique_customers
      FROM appointments WHERE business_id = ${m.business_id} AND start_at >= ${from} AND start_at < ${to}`;
    const byService = await sql`SELECT s.name_snapshot AS name, count(*)::int AS n, COALESCE(sum(s.price_snapshot) FILTER (WHERE a.status = 'completed'), 0)::text AS amount
      FROM appointment_services s JOIN appointments a ON a.id = s.appointment_id
      WHERE a.business_id = ${m.business_id} AND a.start_at >= ${from} AND a.start_at < ${to} AND a.status IN ('confirmed', 'completed', 'pending')
      GROUP BY 1 ORDER BY n DESC LIMIT 15`;
    const byEmployee = await sql`SELECT e.display_name AS name, count(a.id)::int AS n,
        count(a.id) FILTER (WHERE a.status = 'completed')::int AS completed, count(a.id) FILTER (WHERE a.status = 'no_show')::int AS no_show,
        COALESCE(sum(a.price_snapshot) FILTER (WHERE a.status = 'completed'), 0)::text AS amount
      FROM employees e LEFT JOIN appointments a ON a.employee_id = e.id AND a.start_at >= ${from} AND a.start_at < ${to}
      WHERE e.business_id = ${m.business_id} GROUP BY e.id, e.display_name ORDER BY n DESC`;
    return { from: fromD, to: toD, daily, totals, byService, byEmployee, note: 'Tutarlar tahmini hizmet tutarıdır; ödeme entegrasyonu bağlı olmadığı için tahsilat bilgisi içermez.' };
  });

  // --- Abonelik ------------------------------------------------------------
  r.get('/api/panel/:bid/subscription', async (ctx) => {
    const m = await member(ctx, MANAGERS);
    const [current] = await sql`SELECT s.status, s.started_at, s.expires_at, p.code, p.name, p.feature_limits FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.business_id = ${m.business_id} AND s.status IN ('active', 'trialing', 'past_due')`;
    const plans = await sql`SELECT id, code, name, description, price_amount::text, currency, billing_period, features, feature_limits FROM plans WHERE is_active ORDER BY sort_order`;
    return { current: current ?? null, plans, paymentsConfigured: false };
  });

  // --- İşlem kaydı ---------------------------------------------------------
  r.get('/api/panel/:bid/audit', async (ctx) => {
    const m = await member(ctx, OWNER);
    return sql`SELECT l.action, l.target_type, l.created_at, u.full_name AS actor FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id
               WHERE l.business_id = ${m.business_id} ORDER BY l.created_at DESC LIMIT 200`;
  });
}
