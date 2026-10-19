import { sql } from '../db.ts';
import { config } from '../config.ts';
import { badRequest, notFound, type Router } from '../http.ts';
import { buildPlan, computeAvailableDays, computeDaySlots, loadAvailabilityData } from '../availability.ts';
import { localDate, z } from '../validation.ts';
import { addDaysLocal, localDateOf, minutesOfDayOf, timeToMinutes, zonedParts } from '../../shared/time.ts';
import { BUSINESS_TYPES, DEFAULT_TIMEZONE } from '../../shared/constants.ts';
import { integrationStatus } from '../notify.ts';
import { rateLimit } from '../security.ts';

interface ListRow {
  id: string;
  name: string;
  slug: string;
  business_type: string;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  logo_url: string | null;
  cover_url: string | null;
  is_demo: boolean;
  allow_employee_choice: boolean;
  online_booking_enabled: boolean;
  rating: string | null;
  review_count: number;
  min_price: string | null;
  distance_km: number | null;
  sample_services: { name: string; price_type: string; price_amount: string | null; price_max_amount: string | null; duration_minutes: number }[] | null;
  reference_service_id: string | null;
}

/** İşletmenin belirtilen hizmet(ler) için ileriye dönük ilk boş saati */
export async function nextAvailable(businessId: string, serviceIds: string[], fromDate: string, days: number, opts: { date?: string; afterMinutes?: number; windowMinutes?: number } = {}) {
  const data = await loadAvailabilityData(sql, businessId, fromDate, addDaysLocal(fromDate, days));
  if (!data.business.online_booking_enabled) return null;
  let plan;
  try {
    plan = buildPlan(data, serviceIds);
  } catch {
    return null;
  }
  for (let i = 0; i <= days; i++) {
    const d = addDaysLocal(fromDate, i);
    if (opts.date && d !== opts.date) continue;
    let slots = computeDaySlots(data, plan, d);
    if (opts.afterMinutes !== undefined) {
      const lo = opts.afterMinutes;
      const hi = lo + (opts.windowMinutes ?? 120);
      slots = slots.filter((s) => {
        const m = timeToMinutes(s.time);
        return m >= lo && m < hi;
      });
    }
    if (slots.length) return { date: d, time: slots[0].time, startAt: slots[0].startAt };
  }
  return null;
}

function isOpenNow(hours: { weekday: number; opening_time: string; closing_time: string }[], tz: string) {
  const now = new Date();
  const p = zonedParts(now, tz);
  const m = minutesOfDayOf(now, tz);
  return hours.some((h) => h.weekday === p.weekday && timeToMinutes(h.opening_time) <= m && m < timeToMinutes(h.closing_time));
}

const listQuery = z.object({
  type: z.enum(BUSINESS_TYPES).optional(),
  city: z.string().trim().max(60).optional(),
  district: z.string().trim().max(60).optional(),
  q: z.string().trim().max(80).optional(),
  service: z.string().trim().max(80).optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  min_rating: z.coerce.number().min(1).max(5).optional(),
  date: localDate.optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  employee_choice: z.enum(['1']).optional(),
  open_now: z.enum(['1']).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  max_km: z.coerce.number().min(1).max(500).optional(),
  sort: z.enum(['nearest', 'soonest', 'rating', 'price_asc', 'most_reviewed', 'recommended']).optional(),
  page: z.coerce.number().int().min(1).max(100).optional(),
});

const PAGE_SIZE = 12;

export async function searchBusinesses(raw: Record<string, string>) {
  const q = listQuery.parse(raw);
  const hasGeo = q.lat !== undefined && q.lng !== undefined;
  const servicePattern = q.service ? `%${q.service}%` : null;
  const textPattern = q.q ? `%${q.q}%` : null;

  const rows = await sql<ListRow[]>`
    WITH svc AS (
      SELECT s.business_id, s.id, s.name, s.price_type, s.price_amount, s.price_max_amount, s.duration_minutes, s.sort_order
      FROM services s
      WHERE s.is_active AND EXISTS (SELECT 1 FROM employee_services es JOIN employees e ON e.id = es.employee_id
                                    WHERE es.service_id = s.id AND e.is_active AND e.accepts_bookings)
        AND (${servicePattern}::text IS NULL OR s.name ILIKE ${servicePattern})
    ), rv AS (
      SELECT business_id, round(avg(rating)::numeric, 1)::text AS rating, count(*)::int AS review_count
      FROM reviews WHERE moderation_status = 'published' GROUP BY business_id
    )
    SELECT b.id, b.name, b.slug, b.business_type, b.city, b.district, b.neighborhood, b.latitude, b.longitude, b.timezone,
           b.logo_url, b.cover_url, b.is_demo, b.allow_employee_choice, b.online_booking_enabled,
           rv.rating, COALESCE(rv.review_count, 0) AS review_count,
           (SELECT min(price_amount)::text FROM svc WHERE svc.business_id = b.id AND svc.price_type <> 'consultation') AS min_price,
           CASE WHEN ${hasGeo} AND b.latitude IS NOT NULL THEN
             6371 * 2 * asin(sqrt(power(sin(radians(b.latitude - ${q.lat ?? 0}) / 2), 2) +
               cos(radians(${q.lat ?? 0})) * cos(radians(b.latitude)) * power(sin(radians(b.longitude - ${q.lng ?? 0}) / 2), 2)))
           END AS distance_km,
           (SELECT json_agg(x) FROM (SELECT name, price_type, price_amount::text, price_max_amount::text, duration_minutes FROM svc
             WHERE svc.business_id = b.id ORDER BY sort_order, name LIMIT 3) x) AS sample_services,
           (SELECT id FROM svc WHERE svc.business_id = b.id ORDER BY duration_minutes, sort_order LIMIT 1) AS reference_service_id
    FROM businesses b LEFT JOIN rv ON rv.business_id = b.id
    WHERE b.verification_status = 'approved' AND b.publication_status = 'published'
      AND (${q.type ?? null}::text IS NULL OR b.business_type = ${q.type ?? null})
      AND (${q.city ?? null}::text IS NULL OR lower(b.city) = lower(${q.city ?? null}))
      AND (${q.district ?? null}::text IS NULL OR lower(b.district) = lower(${q.district ?? null}))
      AND (${textPattern}::text IS NULL OR b.name ILIKE ${textPattern} OR b.district ILIKE ${textPattern} OR b.neighborhood ILIKE ${textPattern})
      AND EXISTS (SELECT 1 FROM svc WHERE svc.business_id = b.id
                  AND (${q.min_price ?? null}::numeric IS NULL OR svc.price_amount >= ${q.min_price ?? null})
                  AND (${q.max_price ?? null}::numeric IS NULL OR (svc.price_type <> 'consultation' AND svc.price_amount <= ${q.max_price ?? null})))
      AND (${q.min_rating ?? null}::numeric IS NULL OR rv.rating::numeric >= ${q.min_rating ?? null})
      AND (${q.employee_choice ?? null}::text IS NULL OR b.allow_employee_choice)
    LIMIT 300`;

  let list: ListRow[] = [...rows];
  if (hasGeo && q.max_km) list = list.filter((r) => r.distance_km !== null && r.distance_km <= q.max_km!);

  if (q.open_now) {
    const ids = list.map((r) => r.id);
    const hours = ids.length
      ? await sql<{ business_id: string; weekday: number; opening_time: string; closing_time: string }[]>`
          SELECT business_id, weekday, opening_time::text, closing_time::text FROM business_hours WHERE business_id = ANY(${ids}::uuid[])`
      : [];
    list = list.filter((r) => isOpenNow(hours.filter((h) => h.business_id === r.id), r.timezone));
  }

  const today = localDateOf(new Date(), DEFAULT_TIMEZONE);
  const needsAvailabilityForAll = Boolean(q.date || q.time || q.sort === 'soonest');
  type WithNext = ListRow & { next_available: Awaited<ReturnType<typeof nextAvailable>> | undefined };
  let withNext: WithNext[] = list.map((r) => ({ ...r, next_available: undefined }));

  const computeNext = async (r: WithNext) => {
    if (!r.reference_service_id || !r.online_booking_enabled) return null;
    const from = q.date ?? today;
    return nextAvailable(r.id, [r.reference_service_id], from, q.date ? 0 : 14, {
      date: q.date,
      afterMinutes: q.time ? timeToMinutes(q.time) : undefined,
      windowMinutes: 120,
    });
  };

  if (needsAvailabilityForAll) {
    for (const r of withNext) r.next_available = await computeNext(r);
    if (q.date || q.time) withNext = withNext.filter((r) => r.next_available);
  }

  const sort = q.sort ?? (hasGeo ? 'nearest' : 'recommended');
  const num = (v: string | null) => (v === null ? null : Number(v));
  withNext.sort((a, b) => {
    switch (sort) {
      case 'nearest':
        return (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9);
      case 'soonest': {
        const av = a.next_available ? Date.parse(a.next_available.startAt) : Infinity;
        const bv = b.next_available ? Date.parse(b.next_available.startAt) : Infinity;
        return av - bv;
      }
      case 'rating':
        return (num(b.rating) ?? 0) - (num(a.rating) ?? 0) || b.review_count - a.review_count;
      case 'price_asc':
        return (num(a.min_price) ?? 1e9) - (num(b.min_price) ?? 1e9);
      case 'most_reviewed':
        return b.review_count - a.review_count;
      default:
        // Önerilen: gerçek işletmeler demodan önce, sonra puan ve yorum sayısı
        return Number(a.is_demo) - Number(b.is_demo) || (num(b.rating) ?? 0) * Math.log2(2 + b.review_count) - (num(a.rating) ?? 0) * Math.log2(2 + a.review_count) || a.name.localeCompare(b.name, 'tr');
    }
  });

  const page = q.page ?? 1;
  const total = withNext.length;
  const pageItems = withNext.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  for (const r of pageItems) if (r.next_available === undefined) r.next_available = await computeNext(r);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    sort,
    items: pageItems.map(({ reference_service_id: _ref, timezone: _tz, ...r }) => ({
      ...r,
      distance_km: r.distance_km !== null ? Math.round(r.distance_km * 10) / 10 : null,
    })),
  };
}

async function businessBySlug(slug: string) {
  const [b] = await sql<Record<string, unknown>[]>`
    SELECT b.id, b.name, b.slug, b.business_type, b.description, b.phone, b.email, b.website, b.instagram,
           b.country, b.city, b.district, b.neighborhood, b.address, b.latitude, b.longitude, b.location_verified, b.timezone,
           b.logo_url, b.cover_url, b.verification_status, b.is_demo, b.cancellation_policy, b.auto_confirm,
           b.booking_window_days, b.min_notice_minutes, b.cancel_min_hours, b.allow_employee_choice, b.accept_new_customers,
           b.online_booking_enabled,
           (SELECT round(avg(rating)::numeric, 1)::text FROM reviews r WHERE r.business_id = b.id AND r.moderation_status = 'published') AS rating,
           (SELECT count(*)::int FROM reviews r WHERE r.business_id = b.id AND r.moderation_status = 'published') AS review_count
    FROM businesses b WHERE b.slug = ${slug} AND b.verification_status = 'approved' AND b.publication_status = 'published'`;
  if (!b) throw notFound('İşletme bulunamadı veya şu anda yayında değil.');
  return b as { id: string; timezone: string } & Record<string, unknown>;
}

export function registerPublicRoutes(r: Router) {
  r.get('/api/meta', async () => {
    const categories = await sql`SELECT id, slug, name, business_type FROM categories WHERE is_active ORDER BY sort_order`;
    const cities = await sql`
      SELECT city, array_agg(DISTINCT district ORDER BY district) FILTER (WHERE district IS NOT NULL) AS districts, count(*)::int AS n
      FROM businesses WHERE verification_status = 'approved' AND publication_status = 'published' AND city IS NOT NULL
      GROUP BY city ORDER BY n DESC, city`;
    const services = await sql`
      SELECT t.name, c.business_type FROM service_templates t JOIN categories c ON c.id = t.category_id ORDER BY c.sort_order, t.sort_order`;
    return { categories, cities, serviceSuggestions: services, integrations: integrationStatus(), demoMode: config.demoMode };
  });

  r.get('/api/home', async (ctx) => {
    rateLimit(`home:${ctx.ip}`, 120, 60_000);
    const city = ctx.query.get('city') || undefined;
    const lat = ctx.query.get('lat');
    const lng = ctx.query.get('lng');
    const base: Record<string, string> = {};
    if (city) base.city = city;
    if (lat && lng) {
      base.lat = lat;
      base.lng = lng;
    }
    const nearby = await searchBusinesses({ ...base, sort: lat && lng ? 'nearest' : 'recommended' });
    const soonest = await searchBusinesses({ ...base, sort: 'soonest' });
    const featured = await searchBusinesses({ ...base, sort: 'rating' });
    const popular = await sql<{ name: string; n: number }[]>`
      SELECT s.name_snapshot AS name, count(*)::int AS n FROM appointment_services s
      JOIN appointments a ON a.id = s.appointment_id JOIN businesses b ON b.id = a.business_id
      WHERE a.created_at > now() - interval '90 days' AND b.verification_status = 'approved'
      GROUP BY s.name_snapshot ORDER BY n DESC LIMIT 8`;
    const [stats] = await sql<{ businesses: number }[]>`
      SELECT count(*)::int AS businesses FROM businesses WHERE verification_status = 'approved' AND publication_status = 'published' AND NOT is_demo`;
    return {
      nearby: nearby.items.slice(0, 6),
      soonest: soonest.items.filter((i) => i.next_available).slice(0, 6),
      featured: featured.items.filter((i) => i.review_count > 0).slice(0, 6),
      popularServices: popular.map((p) => p.name),
      realBusinessCount: stats.businesses,
    };
  });

  r.get('/api/businesses', async (ctx) => {
    rateLimit(`search:${ctx.ip}`, 120, 60_000);
    return searchBusinesses(Object.fromEntries(ctx.query.entries()));
  });

  r.get('/api/businesses/:slug', async (ctx) => {
    const b = await businessBySlug(ctx.params.slug);
    const [services, employees, hours, photos, closures, categories] = await Promise.all([
      sql`SELECT s.id, s.name, s.description, s.duration_minutes, s.price_type, s.price_amount::text, s.price_max_amount::text, s.photo_url,
                 c.name AS category, s.category_id,
                 ARRAY(SELECT es.employee_id FROM employee_services es JOIN employees e ON e.id = es.employee_id
                       WHERE es.service_id = s.id AND e.is_active AND e.accepts_bookings) AS employee_ids
          FROM services s LEFT JOIN categories c ON c.id = s.category_id
          WHERE s.business_id = ${b.id} AND s.is_active ORDER BY c.sort_order NULLS LAST, s.sort_order, s.name`,
      sql`SELECT id, display_name, title, description, photo_url FROM employees
          WHERE business_id = ${b.id} AND is_active AND accepts_bookings ORDER BY sort_order, display_name`,
      sql`SELECT weekday, to_char(opening_time, 'HH24:MI') AS opening_time, to_char(closing_time, 'HH24:MI') AS closing_time
          FROM business_hours WHERE business_id = ${b.id} ORDER BY weekday, opening_time`,
      sql`SELECT id, url, caption FROM business_photos WHERE business_id = ${b.id} ORDER BY sort_order, created_at`,
      sql`SELECT start_at, end_at, reason FROM business_closures WHERE business_id = ${b.id} AND end_at > now() ORDER BY start_at LIMIT 5`,
      sql`SELECT c.name FROM business_categories bc JOIN categories c ON c.id = bc.category_id WHERE bc.business_id = ${b.id}`,
    ]);
    const reviews = await sql`
      SELECT r.id, r.rating, r.comment, r.created_at, r.edited_at, r.business_reply, r.business_reply_at,
             CASE WHEN u.account_status = 'deleted' OR u.id IS NULL THEN 'Silinmiş kullanıcı'
                  ELSE split_part(u.full_name, ' ', 1) || ' ' || left(split_part(u.full_name, ' ', 2), 1) || '.' END AS author,
             (SELECT string_agg(s.name_snapshot, ', ' ORDER BY s.position) FROM appointment_services s WHERE s.appointment_id = r.appointment_id) AS services
      FROM reviews r LEFT JOIN users u ON u.id = r.customer_user_id
      WHERE r.business_id = ${b.id} AND r.moderation_status = 'published' ORDER BY r.created_at DESC LIMIT 10`;
    let isFavorite = false;
    if (ctx.user) {
      const [f] = await sql`SELECT 1 FROM favorites WHERE user_id = ${ctx.user.id} AND business_id = ${b.id}`;
      isFavorite = Boolean(f);
    }
    return { business: { ...b, categories: categories.map((c) => c.name), open_now: isOpenNow(hours as never, b.timezone) }, services, employees, hours, photos, closures, reviews, isFavorite };
  });

  r.get('/api/businesses/:slug/reviews', async (ctx) => {
    const b = await businessBySlug(ctx.params.slug);
    const page = Math.max(1, Number(ctx.query.get('page') ?? 1) || 1);
    return sql`
      SELECT r.id, r.rating, r.comment, r.created_at, r.edited_at, r.business_reply, r.business_reply_at,
             CASE WHEN u.account_status = 'deleted' OR u.id IS NULL THEN 'Silinmiş kullanıcı'
                  ELSE split_part(u.full_name, ' ', 1) || ' ' || left(split_part(u.full_name, ' ', 2), 1) || '.' END AS author
      FROM reviews r LEFT JOIN users u ON u.id = r.customer_user_id
      WHERE r.business_id = ${b.id} AND r.moderation_status = 'published' ORDER BY r.created_at DESC LIMIT 20 OFFSET ${(page - 1) * 20}`;
  });

  const availQuery = z.object({
    services: z.string().min(1, 'En az bir hizmet seçin.').transform((s) => s.split(',').filter(Boolean)),
    employee: z.string().uuid().optional().or(z.literal('')).transform((v) => v || null),
    exclude: z.string().uuid().optional(),
  });

  r.get('/api/businesses/:slug/availability', async (ctx) => {
    rateLimit(`avail:${ctx.ip}`, 240, 60_000);
    const b = await businessBySlug(ctx.params.slug);
    const q = availQuery.parse(Object.fromEntries(ctx.query.entries()));
    const today = localDateOf(new Date(), b.timezone);
    const from = ctx.query.get('from') && localDate.safeParse(ctx.query.get('from')).success ? ctx.query.get('from')! : today;
    const days = Math.min(Math.max(Number(ctx.query.get('days') ?? 14) || 14, 1), 42);
    const exclude = q.exclude && ctx.user ? await ownAppointmentId(q.exclude, ctx.user.id) : null;
    const data = await loadAvailabilityData(sql, b.id, from, addDaysLocal(from, days), exclude);
    const plan = buildPlan(data, q.services);
    if (q.employee && !plan.eligibleEmployeeIds.includes(q.employee)) throw badRequest('Seçilen çalışan bu hizmet(ler)i vermiyor.');
    return {
      timezone: b.timezone,
      today,
      durationMinutes: plan.innerMinutes,
      eligibleEmployeeIds: plan.eligibleEmployeeIds,
      stationProblem: plan.stationCandidates !== null && plan.stationCandidates.length === 0,
      days: computeAvailableDays(data, plan, from, days, { employeeId: q.employee }),
    };
  });

  r.get('/api/businesses/:slug/slots', async (ctx) => {
    rateLimit(`slots:${ctx.ip}`, 240, 60_000);
    const b = await businessBySlug(ctx.params.slug);
    const q = availQuery.extend({ date: localDate }).parse(Object.fromEntries(ctx.query.entries()));
    const exclude = q.exclude && ctx.user ? await ownAppointmentId(q.exclude, ctx.user.id) : null;
    const data = await loadAvailabilityData(sql, b.id, q.date, q.date, exclude);
    const plan = buildPlan(data, q.services);
    const slots = computeDaySlots(data, plan, q.date, { employeeId: q.employee });
    return { timezone: b.timezone, date: q.date, durationMinutes: plan.innerMinutes, slots: slots.map(({ employeeIds, ...s }) => ({ ...s, employeeCount: employeeIds.length })) };
  });
}

/** Müşteri kendi randevusunu taşırken o randevunun meşgul sayılmaması için (yalnızca kendi randevusu) */
async function ownAppointmentId(id: string, userId: string) {
  const [a] = await sql<{ id: string }[]>`SELECT id FROM appointments WHERE id = ${id} AND customer_user_id = ${userId}`;
  return a?.id ?? null;
}
