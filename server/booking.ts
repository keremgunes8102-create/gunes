// Randevu oluşturma, durum geçişleri ve saat değişikliği.
// Tüm yazma işlemleri transaction + işletme bazlı danışma kilidi (advisory lock) altında yapılır;
// ayrıca appointments tablosundaki EXCLUDE kısıtı aynı çalışan için çakışmayı veritabanı düzeyinde engeller.

import { sql, type Tx } from './db.ts';
import { buildPlan, loadAvailabilityData, validateStart, type BookingPlan } from './availability.ts';
import { HttpError, badRequest, conflict, forbidden, notFound } from './http.ts';
import { publicReference } from './security.ts';
import { notify, notifyBusinessManagers } from './notify.ts';
import { audit } from './audit.ts';
import { localDateOf } from '../shared/time.ts';
import { formatDateTime } from '../shared/format.ts';
import type { AppointmentStatus } from '../shared/constants.ts';

export async function lockBusiness(tx: Tx, businessId: string) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${businessId}, 7))`;
}

/** Süresi dolmuş onay bekleyen talepleri serbest bırakır */
export async function expireStalePending(tx: Tx | typeof sql, businessId?: string) {
  const rows = await tx<{ id: string; customer_user_id: string | null; business_id: string; public_reference: string }[]>`
    UPDATE appointments SET status = 'expired'
    WHERE status = 'pending' AND (pending_expires_at < now() OR start_at < now())
      AND (${businessId ?? null}::uuid IS NULL OR business_id = ${businessId ?? null}::uuid)
    RETURNING id, customer_user_id, business_id, public_reference`;
  for (const r of rows) {
    await tx`INSERT INTO appointment_events (appointment_id, event_type, from_status, to_status, note)
             VALUES (${r.id}, 'status_change', 'pending', 'expired', 'İşletme süresi içinde yanıt vermedi')`;
    if (r.customer_user_id) {
      await notify(tx, {
        userId: r.customer_user_id,
        type: 'appointment_expired',
        title: 'Randevu talebinin süresi doldu',
        body: `${r.public_reference} numaralı talebiniz işletme tarafından zamanında yanıtlanmadığı için sona erdi. Başka bir saat seçebilirsiniz.`,
        link: '/hesabim/randevular',
        dedupeKey: `expired:${r.id}`,
        channels: { email: true },
      });
    }
  }
  return rows.length;
}

function isExclusionViolation(e: unknown) {
  const err = e as { code?: string; constraint_name?: string };
  return err?.code === '23P01';
}
function isUniqueViolation(e: unknown, constraint?: string) {
  const err = e as { code?: string; constraint_name?: string };
  return err?.code === '23505' && (!constraint || err.constraint_name === constraint);
}

export interface CreateAppointmentInput {
  businessId: string;
  serviceIds: string[];
  employeeId: string | null;
  startAt: Date;
  idempotencyKey: string | null;
  customerNote: string | null;
  actorUserId: string;
  ip?: string;
  /** online: müşteri kendisi; manual: işletme panelinden */
  source: 'online' | 'manual';
  customerUserId: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  /** manuel randevu doğrudan onaylı başlar */
  forceConfirmed?: boolean;
}

interface BusinessRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  verification_status: string;
  publication_status: string;
  online_booking_enabled: boolean;
  auto_confirm: boolean;
  accept_new_customers: boolean;
  allow_employee_choice: boolean;
  cancel_min_hours: number;
  cancellation_policy: string | null;
  pending_expiry_minutes: number;
}

export async function createAppointment(input: CreateAppointmentInput) {
  try {
    return await sql.begin(async (tx) => {
      await lockBusiness(tx, input.businessId);

      // Ağ hatası nedeniyle tekrar gönderilen istek: aynı randevuyu döndür
      if (input.idempotencyKey) {
        const [existing] = await tx<{ id: string; public_reference: string; customer_user_id: string | null; created_by_user_id: string | null; status: string }[]>`
          SELECT id, public_reference, customer_user_id, created_by_user_id, status FROM appointments
          WHERE business_id = ${input.businessId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing) {
          if (existing.created_by_user_id !== input.actorUserId) throw conflict('Bu istek anahtarı daha önce kullanılmış.');
          return { id: existing.id, public_reference: existing.public_reference, status: existing.status, replayed: true };
        }
      }

      const [b] = await tx<BusinessRow[]>`
        SELECT id, name, slug, timezone, verification_status, publication_status, online_booking_enabled, auto_confirm,
               accept_new_customers, allow_employee_choice, cancel_min_hours, cancellation_policy, pending_expiry_minutes
        FROM businesses WHERE id = ${input.businessId}`;
      if (!b) throw notFound('İşletme bulunamadı.');

      if (input.source === 'online') {
        if (b.verification_status !== 'approved' || b.publication_status !== 'published') throw badRequest('Bu işletme şu anda online randevu kabul etmiyor.');
        if (!b.online_booking_enabled) throw badRequest('Bu işletme şu anda online randevu kabul etmiyor.');
        if (input.employeeId && !b.allow_employee_choice) throw badRequest('Bu işletmede çalışan seçimi yapılamıyor.');
        if (!b.accept_new_customers) {
          const [prev] = await tx`SELECT 1 FROM appointments WHERE business_id = ${b.id} AND customer_user_id = ${input.customerUserId}
                                    AND status IN ('confirmed', 'completed') LIMIT 1`;
          if (!prev) throw badRequest('Bu işletme şu anda yeni müşteri kabul etmiyor.');
        }
        // Aynı müşterinin aynı işletmede aynı anda birden fazla aktif talebini sınırla
        const [{ n }] = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM appointments WHERE customer_user_id = ${input.customerUserId}
          AND business_id = ${b.id} AND status IN ('pending', 'confirmed') AND start_at > now()`;
        if (n >= 5) throw badRequest('Bu işletmede çok sayıda aktif randevunuz var. Yeni randevu için önce mevcutlardan birini tamamlayın veya iptal edin.');
      }

      await expireStalePending(tx, b.id);

      const localDate = localDateOf(input.startAt, b.timezone);
      const data = await loadAvailabilityData(tx, b.id, localDate, localDate);
      const plan = buildPlan(data, input.serviceIds);
      if (plan.eligibleEmployeeIds.length === 0) throw badRequest('Seçilen hizmetlerin tamamını yapabilen bir çalışan bulunmuyor.');
      if (plan.stationCandidates && plan.stationCandidates.length === 0) {
        throw badRequest('Seçilen hizmetler aynı istasyonda yapılamıyor. Lütfen ayrı randevular oluşturun.');
      }
      if (input.employeeId && !plan.eligibleEmployeeIds.includes(input.employeeId)) {
        throw badRequest('Seçilen çalışan bu hizmet(ler)i vermiyor.');
      }
      const v = validateStart(data, plan, input.startAt, input.employeeId, { ignoreBookingRules: input.source === 'manual' });
      if (!v) throw conflict('Seçtiğiniz saat artık müsait değil. Lütfen başka bir saat seçin.', 'slot_unavailable');

      const status: AppointmentStatus = input.forceConfirmed || b.auto_confirm ? 'confirmed' : 'pending';
      const totals = sumPrices(plan);
      const pendingExpires = status === 'pending' ? new Date(Math.min(Date.now() + b.pending_expiry_minutes * 60000, input.startAt.getTime())) : null;

      let ref = publicReference();
      for (let i = 0; i < 3; i++) {
        const [dup] = await tx`SELECT 1 FROM appointments WHERE public_reference = ${ref}`;
        if (!dup) break;
        ref = publicReference();
      }

      const [appt] = await tx<{ id: string }[]>`
        INSERT INTO appointments (
          public_reference, business_id, customer_user_id, customer_name, customer_phone, employee_id, station_id,
          start_at, end_at, preparation_minutes, cleanup_minutes, occupied, status, source,
          price_snapshot, price_max_snapshot, price_type_snapshot, duration_snapshot, cancel_min_hours_snapshot,
          cancellation_policy_snapshot, customer_note, pending_expires_at, idempotency_key, created_by_user_id)
        VALUES (
          ${ref}, ${b.id}, ${input.customerUserId}, ${input.customerName ?? null}, ${input.customerPhone ?? null}, ${v.employeeId}, ${v.stationId},
          ${input.startAt}, ${v.endAt}, ${plan.prepMinutes}, ${plan.cleanupMinutes},
          tstzrange(${new Date(v.occupied[0])}, ${new Date(v.occupied[1])}, '[)'), ${status}, ${input.source},
          ${totals.min}, ${totals.max}, ${totals.type}, ${plan.innerMinutes}, ${b.cancel_min_hours},
          ${b.cancellation_policy}, ${input.customerNote}, ${pendingExpires}, ${input.idempotencyKey}, ${input.actorUserId})
        RETURNING id`;

      let pos = 0;
      for (const s of plan.services) {
        await tx`
          INSERT INTO appointment_services (appointment_id, service_id, position, name_snapshot, duration_snapshot, price_type_snapshot, price_snapshot, price_max_snapshot)
          VALUES (${appt.id}, ${s.id}, ${pos++}, ${s.name}, ${s.duration_minutes}, ${s.price_type}, ${s.price_amount}, ${s.price_max_amount})`;
      }
      await tx`INSERT INTO appointment_events (appointment_id, actor_user_id, event_type, to_status)
               VALUES (${appt.id}, ${input.actorUserId}, 'created', ${status})`;

      const when = formatDateTime(input.startAt, b.timezone);
      const serviceNames = plan.services.map((s) => s.name).join(', ');
      if (input.customerUserId) {
        await notify(tx, {
          userId: input.customerUserId,
          type: status === 'confirmed' ? 'appointment_confirmed' : 'appointment_requested',
          title: status === 'confirmed' ? 'Randevunuz onaylandı' : 'Randevu talebiniz alındı',
          body:
            status === 'confirmed'
              ? `${b.name} — ${serviceNames}, ${when}. Randevu no: ${ref}`
              : `${b.name} — ${serviceNames}, ${when}. İşletme onayladığında bilgilendirileceksiniz. Randevu no: ${ref}`,
          link: `/hesabim/randevular/${ref}`,
          dedupeKey: `created:${appt.id}`,
          channels: { email: true, sms: status === 'confirmed' },
        });
      }
      if (input.source === 'online') {
        await notifyBusinessManagers(tx, b.id, {
          type: status === 'pending' ? 'business_appointment_request' : 'business_new_appointment',
          title: status === 'pending' ? 'Yeni randevu talebi (onay bekliyor)' : 'Yeni randevu',
          body: `${serviceNames} — ${when}. Randevu no: ${ref}`,
          link: `/panel/randevular?ref=${ref}`,
          dedupeKey: `created:${appt.id}`,
          channels: { email: true },
        });
        // Personel hesabına bağlı çalışana da bildir
        const [staff] = await tx<{ user_id: string }[]>`SELECT user_id FROM employees WHERE id = ${v.employeeId} AND user_id IS NOT NULL`;
        if (staff) {
          await notify(tx, { userId: staff.user_id, type: 'staff_new_appointment', title: 'Takviminize yeni randevu eklendi', body: `${serviceNames} — ${when}`, link: '/panel/takvim', dedupeKey: `created:${appt.id}` });
        }
      }
      await audit({ actor: input.actorUserId, businessId: b.id, action: 'appointment.create', targetType: 'appointment', targetId: appt.id, metadata: { source: input.source, status }, ip: input.ip }, tx);
      return { id: appt.id, public_reference: ref, status, replayed: false };
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw conflict('Seçtiğiniz saat az önce başka biri tarafından alındı. Lütfen başka bir saat seçin.', 'slot_unavailable');
    if (isUniqueViolation(e, 'appointments_idempotency')) throw conflict('Bu istek zaten işleniyor. Lütfen randevularınızı kontrol edin.');
    throw e;
  }
}

export function sumPrices(plan: BookingPlan): { min: string | null; max: string | null; type: string } {
  if (plan.services.some((s) => s.price_type === 'consultation')) {
    const known = plan.services.filter((s) => s.price_type !== 'consultation');
    const min = known.reduce((a, s) => a + Number(s.price_amount ?? 0), 0);
    return { min: known.length ? min.toFixed(2) : null, max: null, type: 'consultation' };
  }
  const min = plan.services.reduce((a, s) => a + Number(s.price_amount ?? 0), 0);
  const hasRange = plan.services.some((s) => s.price_type === 'range');
  const hasStarting = plan.services.some((s) => s.price_type === 'starting_from');
  if (hasRange && !hasStarting) {
    const max = plan.services.reduce((a, s) => a + Number(s.price_type === 'range' ? s.price_max_amount : s.price_amount), 0);
    return { min: min.toFixed(2), max: max.toFixed(2), type: 'range' };
  }
  return { min: min.toFixed(2), max: null, type: hasStarting || hasRange ? 'starting_from' : 'fixed' };
}

// ---------------------------------------------------------------------------
// Durum geçişleri
// ---------------------------------------------------------------------------
type Actor = { kind: 'customer'; userId: string } | { kind: 'business'; userId: string; role: string; employeeId: string | null } | { kind: 'system' };

const TRANSITIONS: Record<string, { from: AppointmentStatus[]; to: AppointmentStatus; who: Actor['kind'][] }> = {
  confirm: { from: ['pending'], to: 'confirmed', who: ['business'] },
  reject: { from: ['pending'], to: 'rejected', who: ['business'] },
  cancel_customer: { from: ['pending', 'confirmed'], to: 'cancelled_by_customer', who: ['customer'] },
  cancel_business: { from: ['pending', 'confirmed'], to: 'cancelled_by_business', who: ['business'] },
  complete: { from: ['confirmed'], to: 'completed', who: ['business'] },
  no_show: { from: ['confirmed'], to: 'no_show', who: ['business'] },
};
export type TransitionAction = keyof typeof TRANSITIONS;

interface ApptRow {
  id: string;
  public_reference: string;
  business_id: string;
  customer_user_id: string | null;
  employee_id: string;
  start_at: Date;
  status: AppointmentStatus;
  cancel_min_hours_snapshot: number;
  business_name: string;
  timezone: string;
}

export async function transitionAppointment(appointmentId: string, action: TransitionAction, actor: Actor, opts: { reason?: string | null; ip?: string } = {}) {
  const t = TRANSITIONS[action];
  if (!t) throw badRequest('Geçersiz işlem.');
  return sql.begin(async (tx) => {
    const [a] = await tx<ApptRow[]>`
      SELECT a.id, a.public_reference, a.business_id, a.customer_user_id, a.employee_id, a.start_at, a.status, a.cancel_min_hours_snapshot,
             b.name AS business_name, b.timezone
      FROM appointments a JOIN businesses b ON b.id = a.business_id WHERE a.id = ${appointmentId} FOR UPDATE OF a`;
    if (!a) throw notFound('Randevu bulunamadı.');
    if (!t.who.includes(actor.kind)) throw forbidden();
    if (actor.kind === 'customer' && a.customer_user_id !== actor.userId) throw notFound('Randevu bulunamadı.');
    if (actor.kind === 'business' && actor.role === 'staff') {
      // Çalışan yalnızca kendi randevularını tamamlandı/gelmedi olarak işaretleyebilir
      if (!['complete', 'no_show'].includes(action) || a.employee_id !== actor.employeeId) throw forbidden('Bu işlem için yönetici yetkisi gerekir.');
    }
    if (!t.from.includes(a.status)) {
      throw conflict(`Bu randevu "${a.status}" durumunda olduğu için bu işlem yapılamaz.`, 'invalid_status');
    }
    if (action === 'cancel_customer') {
      const deadline = a.start_at.getTime() - a.cancel_min_hours_snapshot * 3_600_000;
      if (Date.now() > deadline) {
        throw new HttpError(422, 'cancel_window_passed', `İptal süresi geçti. Bu randevu en geç başlangıçtan ${a.cancel_min_hours_snapshot} saat önce iptal edilebilirdi. Lütfen işletmeyle iletişime geçin.`);
      }
    }
    if ((action === 'complete' || action === 'no_show') && a.start_at.getTime() > Date.now()) {
      throw badRequest('Henüz başlamamış bir randevu bu şekilde işaretlenemez.');
    }
    await tx`UPDATE appointments SET status = ${t.to}, cancellation_reason = COALESCE(${opts.reason ?? null}, cancellation_reason),
             pending_expires_at = NULL WHERE id = ${a.id}`;
    await tx`UPDATE appointment_proposals SET status = 'superseded' WHERE appointment_id = ${a.id} AND status = 'open' AND ${['cancelled_by_customer', 'cancelled_by_business', 'rejected'].includes(t.to)}`;
    const actorId = actor.kind === 'system' ? null : actor.userId;
    await tx`INSERT INTO appointment_events (appointment_id, actor_user_id, event_type, from_status, to_status, note)
             VALUES (${a.id}, ${actorId}, 'status_change', ${a.status}, ${t.to}, ${opts.reason ?? null})`;

    const when = formatDateTime(a.start_at, a.timezone);
    const msg: Partial<Record<AppointmentStatus, [string, string]>> = {
      confirmed: ['Randevunuz onaylandı', `${a.business_name} — ${when}. Randevu no: ${a.public_reference}`],
      rejected: ['Randevu talebiniz reddedildi', `${a.business_name} — ${when} talebiniz kabul edilmedi.${opts.reason ? ` Gerekçe: ${opts.reason}` : ''}`],
      cancelled_by_business: ['Randevunuz işletme tarafından iptal edildi', `${a.business_name} — ${when}.${opts.reason ? ` Gerekçe: ${opts.reason}` : ''}`],
    };
    const m = msg[t.to];
    if (m && a.customer_user_id) {
      await notify(tx, { userId: a.customer_user_id, type: `appointment_${t.to}`, title: m[0], body: m[1], link: `/hesabim/randevular/${a.public_reference}`, dedupeKey: `${t.to}:${a.id}`, channels: { email: true, sms: true } });
    }
    if (t.to === 'cancelled_by_customer') {
      await notifyBusinessManagers(tx, a.business_id, {
        type: 'business_appointment_cancelled',
        title: 'Müşteri randevusunu iptal etti',
        body: `${when} randevusu iptal edildi (${a.public_reference}).${opts.reason ? ` Not: ${opts.reason}` : ''}`,
        link: `/panel/randevular?ref=${a.public_reference}`,
        dedupeKey: `cancelled:${a.id}`,
        channels: { email: true },
      });
    }
    await audit({ actor: actorId, businessId: a.business_id, action: `appointment.${action}`, targetType: 'appointment', targetId: a.id, ip: opts.ip }, tx);
    return { id: a.id, status: t.to };
  });
}

// ---------------------------------------------------------------------------
// Saat değişikliği (işletme doğrudan taşır) ve yeni saat önerisi (müşteri kabul eder)
// ---------------------------------------------------------------------------
async function moveWithinTx(tx: Tx, appointmentId: string, newStart: Date, newEmployeeId: string | null, ignoreRules: boolean) {
  const [a] = await tx<{ id: string; business_id: string; status: string; timezone: string; employee_id: string }[]>`
    SELECT a.id, a.business_id, a.status, b.timezone, a.employee_id FROM appointments a JOIN businesses b ON b.id = a.business_id
    WHERE a.id = ${appointmentId} FOR UPDATE OF a`;
  if (!a) throw notFound('Randevu bulunamadı.');
  if (!['pending', 'confirmed'].includes(a.status)) throw conflict('Yalnızca aktif randevuların saati değiştirilebilir.', 'invalid_status');
  const serviceIds = (await tx<{ service_id: string | null }[]>`SELECT service_id FROM appointment_services WHERE appointment_id = ${a.id} ORDER BY position`).map((r) => r.service_id);
  if (serviceIds.some((s) => !s)) throw badRequest('Bu randevudaki bir hizmet artık mevcut değil; lütfen yeni randevu oluşturun.');
  const localDate = localDateOf(newStart, a.timezone);
  const data = await loadAvailabilityData(tx, a.business_id, localDate, localDate, a.id);
  const plan = buildPlan(data, serviceIds as string[]);
  const v = validateStart(data, plan, newStart, newEmployeeId ?? a.employee_id, { ignoreBookingRules: ignoreRules });
  if (!v) throw conflict('Seçilen yeni saat müsait değil.', 'slot_unavailable');
  // Not: fiyat anlık görüntüsü değişmez; yalnızca zaman/çalışan/istasyon güncellenir.
  await tx`UPDATE appointments SET start_at = ${newStart}, end_at = ${v.endAt}, employee_id = ${v.employeeId}, station_id = ${v.stationId},
           occupied = tstzrange(${new Date(v.occupied[0])}, ${new Date(v.occupied[1])}, '[)') WHERE id = ${a.id}`;
  return { businessId: a.business_id, timezone: a.timezone };
}

export async function rescheduleByBusiness(appointmentId: string, businessId: string, newStart: Date, employeeId: string | null, actorUserId: string, ip?: string) {
  try {
    return await sql.begin(async (tx) => {
      await lockBusiness(tx, businessId);
      const [own] = await tx<{ customer_user_id: string | null; public_reference: string; start_at: Date; business_name: string }[]>`
        SELECT a.customer_user_id, a.public_reference, a.start_at, b.name AS business_name FROM appointments a JOIN businesses b ON b.id = a.business_id
        WHERE a.id = ${appointmentId} AND a.business_id = ${businessId}`;
      if (!own) throw notFound('Randevu bulunamadı.');
      const { timezone } = await moveWithinTx(tx, appointmentId, newStart, employeeId, true);
      await tx`INSERT INTO appointment_events (appointment_id, actor_user_id, event_type, note)
               VALUES (${appointmentId}, ${actorUserId}, 'rescheduled', ${`${own.start_at.toISOString()} -> ${newStart.toISOString()}`})`;
      if (own.customer_user_id) {
        await notify(tx, {
          userId: own.customer_user_id,
          type: 'appointment_rescheduled',
          title: 'Randevu saatiniz değiştirildi',
          body: `${own.business_name} randevunuz ${formatDateTime(newStart, timezone)} olarak güncellendi. Uygun değilse iptal edebilir veya işletmeyle iletişime geçebilirsiniz.`,
          link: `/hesabim/randevular/${own.public_reference}`,
          dedupeKey: `rescheduled:${appointmentId}:${newStart.getTime()}`,
          channels: { email: true, sms: true },
        });
      }
      await audit({ actor: actorUserId, businessId, action: 'appointment.reschedule', targetType: 'appointment', targetId: appointmentId, ip }, tx);
      return { ok: true };
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw conflict('Seçilen yeni saat müsait değil.', 'slot_unavailable');
    throw e;
  }
}

export async function proposeNewTime(appointmentId: string, businessId: string, start: Date, employeeId: string, note: string | null, actorUserId: string) {
  return sql.begin(async (tx) => {
    const [a] = await tx<{ id: string; customer_user_id: string | null; status: string; public_reference: string; business_name: string; timezone: string }[]>`
      SELECT a.id, a.customer_user_id, a.status, a.public_reference, b.name AS business_name, b.timezone
      FROM appointments a JOIN businesses b ON b.id = a.business_id WHERE a.id = ${appointmentId} AND a.business_id = ${businessId} FOR UPDATE OF a`;
    if (!a) throw notFound('Randevu bulunamadı.');
    if (!a.customer_user_id) throw badRequest('Bu randevu bir platform kullanıcısına ait değil; saati doğrudan değiştirebilirsiniz.');
    if (!['pending', 'confirmed'].includes(a.status)) throw conflict('Yalnızca aktif randevular için yeni saat önerilebilir.', 'invalid_status');
    // Önerilen saatin şu an müsait olduğunu doğrula (kabul anında tekrar kontrol edilir)
    const localDate = localDateOf(start, a.timezone);
    const data = await loadAvailabilityData(tx, businessId, localDate, localDate, a.id);
    const serviceIds = (await tx<{ service_id: string }[]>`SELECT service_id FROM appointment_services WHERE appointment_id = ${a.id} ORDER BY position`).map((r) => r.service_id);
    const plan = buildPlan(data, serviceIds);
    if (!validateStart(data, plan, start, employeeId, { ignoreBookingRules: true })) throw conflict('Önerilen saat müsait değil.', 'slot_unavailable');
    await tx`UPDATE appointment_proposals SET status = 'superseded' WHERE appointment_id = ${a.id} AND status = 'open'`;
    const [p] = await tx<{ id: string }[]>`
      INSERT INTO appointment_proposals (appointment_id, proposed_start_at, proposed_employee_id, note, created_by_user_id)
      VALUES (${a.id}, ${start}, ${employeeId}, ${note}, ${actorUserId}) RETURNING id`;
    await notify(tx, {
      userId: a.customer_user_id,
      type: 'appointment_proposal',
      title: 'İşletme yeni bir saat önerdi',
      body: `${a.business_name}: ${formatDateTime(start, a.timezone)} önerildi.${note ? ` Not: ${note}` : ''} Kabul etmek için randevu detayını açın.`,
      link: `/hesabim/randevular/${a.public_reference}`,
      dedupeKey: `proposal:${p.id}`,
      channels: { email: true, sms: true },
    });
    await audit({ actor: actorUserId, businessId, action: 'appointment.propose', targetType: 'appointment', targetId: a.id }, tx);
    return { id: p.id };
  });
}

export async function respondToProposal(proposalId: string, customerUserId: string, accept: boolean) {
  try {
    return await sql.begin(async (tx) => {
      const [p] = await tx<{ id: string; appointment_id: string; proposed_start_at: Date; proposed_employee_id: string; status: string; business_id: string; customer_user_id: string; public_reference: string }[]>`
        SELECT p.id, p.appointment_id, p.proposed_start_at, p.proposed_employee_id, p.status, a.business_id, a.customer_user_id, a.public_reference
        FROM appointment_proposals p JOIN appointments a ON a.id = p.appointment_id WHERE p.id = ${proposalId}`;
      if (!p || p.customer_user_id !== customerUserId) throw notFound('Öneri bulunamadı.');
      if (p.status !== 'open') throw conflict('Bu öneri artık geçerli değil.');
      await lockBusiness(tx, p.business_id);
      if (!accept) {
        await tx`UPDATE appointment_proposals SET status = 'declined', responded_at = now() WHERE id = ${p.id}`;
        await notifyBusinessManagers(tx, p.business_id, { type: 'business_proposal_declined', title: 'Saat önerisi reddedildi', body: `${p.public_reference} numaralı randevu için önerdiğiniz saat kabul edilmedi.`, link: `/panel/randevular?ref=${p.public_reference}`, dedupeKey: `proposal-resp:${p.id}` });
        return { ok: true, status: 'declined' };
      }
      if (p.proposed_start_at.getTime() < Date.now()) throw conflict('Önerilen saat geçmiş.');
      await moveWithinTx(tx, p.appointment_id, p.proposed_start_at, p.proposed_employee_id, true);
      await tx`UPDATE appointment_proposals SET status = 'accepted', responded_at = now() WHERE id = ${p.id}`;
      await tx`UPDATE appointments SET status = 'confirmed', pending_expires_at = NULL WHERE id = ${p.appointment_id} AND status = 'pending'`;
      await tx`INSERT INTO appointment_events (appointment_id, actor_user_id, event_type, note) VALUES (${p.appointment_id}, ${customerUserId}, 'proposal_accepted', null)`;
      await notifyBusinessManagers(tx, p.business_id, { type: 'business_proposal_accepted', title: 'Saat önerisi kabul edildi', body: `${p.public_reference} numaralı randevu yeni saate taşındı.`, link: `/panel/randevular?ref=${p.public_reference}`, dedupeKey: `proposal-resp:${p.id}` });
      return { ok: true, status: 'accepted' };
    });
  } catch (e) {
    if (isExclusionViolation(e) || (e instanceof HttpError && e.code === 'slot_unavailable')) {
      await sql`UPDATE appointment_proposals SET status = 'failed', responded_at = now() WHERE id = ${proposalId} AND status = 'open'`;
      throw conflict('Önerilen saat artık müsait değil. İşletmeden yeni bir saat isteyebilirsiniz.', 'slot_unavailable');
    }
    throw e;
  }
}

/** Müşteri, iptal süresi dolmadan randevusunu aynı hizmetlerle başka bir saate taşıyabilir (işletme kuralları uygulanır). */
export async function rescheduleByCustomer(appointmentId: string, customerUserId: string, newStart: Date, employeeId: string | null, ip?: string) {
  try {
    return await sql.begin(async (tx) => {
      const [a] = await tx<{ id: string; business_id: string; customer_user_id: string; start_at: Date; cancel_min_hours_snapshot: number; public_reference: string; status: string }[]>`
        SELECT id, business_id, customer_user_id, start_at, cancel_min_hours_snapshot, public_reference, status FROM appointments WHERE id = ${appointmentId}`;
      if (!a || a.customer_user_id !== customerUserId) throw notFound('Randevu bulunamadı.');
      if (Date.now() > a.start_at.getTime() - a.cancel_min_hours_snapshot * 3_600_000) {
        throw new HttpError(422, 'cancel_window_passed', 'Değişiklik süresi geçti. Lütfen işletmeyle iletişime geçin.');
      }
      await lockBusiness(tx, a.business_id);
      const [b] = await tx<{ allow_employee_choice: boolean }[]>`SELECT allow_employee_choice FROM businesses WHERE id = ${a.business_id}`;
      if (employeeId && !b.allow_employee_choice) throw badRequest('Bu işletmede çalışan seçimi yapılamıyor.');
      const { timezone } = await moveWithinTx(tx, a.id, newStart, employeeId, false);
      await tx`UPDATE appointment_proposals SET status = 'superseded' WHERE appointment_id = ${a.id} AND status = 'open'`;
      await tx`INSERT INTO appointment_events (appointment_id, actor_user_id, event_type, note)
               VALUES (${a.id}, ${customerUserId}, 'rescheduled_by_customer', ${`${a.start_at.toISOString()} -> ${newStart.toISOString()}`})`;
      await notifyBusinessManagers(tx, a.business_id, {
        type: 'business_appointment_rescheduled',
        title: 'Müşteri randevu saatini değiştirdi',
        body: `${a.public_reference}: yeni saat ${formatDateTime(newStart, timezone)}`,
        link: `/panel/randevular?ref=${a.public_reference}`,
        dedupeKey: `cust-resched:${a.id}:${newStart.getTime()}`,
        channels: { email: true },
      });
      await audit({ actor: customerUserId, businessId: a.business_id, action: 'appointment.reschedule_customer', targetType: 'appointment', targetId: a.id, ip }, tx);
      return { ok: true };
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw conflict('Seçilen yeni saat müsait değil.', 'slot_unavailable');
    throw e;
  }
}
