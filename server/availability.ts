// Randevu motoru — müsaitlik hesabı.
// Saf hesaplama (computeDaySlots) veritabanından bağımsızdır ve birim testlerle doğrulanır.
// Sunucu, randevu oluştururken aynı hesabı transaction ve işletme kilidi içinde tekrar çalıştırır.

import type { Db } from './db.ts';
import { badRequest, notFound } from './http.ts';
import { addDaysLocal, localDateOf, minutesOfDayOf, minutesToTime, timeToMinutes, weekdayOfLocalDate, zonedToUtc } from '../shared/time.ts';

export type Interval = [number, number]; // [başlangıç ms, bitiş ms) — yarı açık aralık

export interface BusinessCfg {
  id: string;
  timezone: string;
  slot_interval_minutes: number;
  min_notice_minutes: number;
  booking_window_days: number;
  online_booking_enabled: boolean;
}

export interface ServiceInfo {
  id: string;
  name: string;
  duration_minutes: number;
  preparation_minutes: number;
  cleanup_minutes: number;
  price_type: string;
  price_amount: string | null;
  price_max_amount: string | null;
  employeeIds: Set<string>;
  stationIds: Set<string>; // boşsa istasyon gerekmez
}

export interface EmployeeInfo {
  id: string;
  display_name: string;
  hours: Map<number, [number, number][]>; // weekday -> dakika aralıkları
  breaks: Map<number, [number, number][]>;
  timeOff: Interval[];
  busy: Interval[];
}

export interface StationInfo {
  id: string;
  capacity: number;
  busy: Interval[];
}

export interface AvailabilityData {
  business: BusinessCfg;
  businessHours: Map<number, [number, number][]>;
  closures: Interval[];
  employees: Map<string, EmployeeInfo>; // yalnızca aktif ve randevu alabilen çalışanlar
  stations: Map<string, StationInfo>; // yalnızca aktif istasyonlar
  services: Map<string, ServiceInfo>; // yalnızca aktif hizmetler
}

export interface BookingPlan {
  services: ServiceInfo[];
  /** Hizmetin müşteriye görünen toplam süresi (hizmetler arası geçişler dahil) */
  innerMinutes: number;
  prepMinutes: number;
  cleanupMinutes: number;
  eligibleEmployeeIds: string[];
  /** null: istasyon gerekmez; aksi halde bu istasyonlardan biri gerekir */
  stationCandidates: string[] | null;
}

export interface Slot {
  time: string; // yerel 'HH:MM'
  startAt: string; // ISO (UTC)
  endAt: string;
  employeeIds: string[];
}

// ---------------------------------------------------------------------------
// Aralık yardımcıları
// ---------------------------------------------------------------------------
export function overlaps(a: Interval, b: Interval) {
  return a[0] < b[1] && b[0] < a[1];
}

/** a aralık listesinden b aralıklarını çıkarır */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  let result = a.slice();
  for (const [bs, be] of b) {
    const next: Interval[] = [];
    for (const [s, e] of result) {
      if (be <= s || bs >= e) {
        next.push([s, e]);
        continue;
      }
      if (bs > s) next.push([s, bs]);
      if (be < e) next.push([be, e]);
    }
    result = next;
  }
  return result;
}

export function intersect(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [as, ae] of a) {
    for (const [bs, be] of b) {
      const s = Math.max(as, bs);
      const e = Math.min(ae, be);
      if (e > s) out.push([s, e]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

// ---------------------------------------------------------------------------
// Plan: seçilen hizmetlerden süre, çalışan ve istasyon gereksinimi
// ---------------------------------------------------------------------------
export function buildPlan(data: AvailabilityData, serviceIds: string[]): BookingPlan {
  if (serviceIds.length === 0) throw badRequest('En az bir hizmet seçin.');
  if (new Set(serviceIds).size !== serviceIds.length) throw badRequest('Aynı hizmet birden fazla kez seçilemez.');
  const services = serviceIds.map((id) => {
    const s = data.services.get(id);
    if (!s) throw badRequest('Seçilen hizmet bulunamadı veya şu anda sunulmuyor.');
    return s;
  });
  let inner = 0;
  services.forEach((s, i) => {
    inner += s.duration_minutes;
    if (i > 0) inner += services[i - 1].cleanup_minutes + s.preparation_minutes;
  });
  const eligible = [...data.employees.keys()].filter((eid) => services.every((s) => s.employeeIds.has(eid)));

  let stationCandidates: string[] | null = null;
  const needing = services.filter((s) => s.stationIds.size > 0);
  if (needing.length) {
    stationCandidates = [...needing[0].stationIds].filter((sid) => data.stations.has(sid) && needing.every((s) => s.stationIds.has(sid)));
  }
  return {
    services,
    innerMinutes: inner,
    prepMinutes: services[0].preparation_minutes,
    cleanupMinutes: services[services.length - 1].cleanup_minutes,
    eligibleEmployeeIds: eligible,
    stationCandidates,
  };
}

function stationFree(st: StationInfo, occ: Interval): boolean {
  // Muhafazakâr kontrol: aralıkla çakışan randevu sayısı kapasiteden az olmalı.
  let n = 0;
  for (const b of st.busy) if (overlaps(b, occ)) n++;
  return n < st.capacity;
}

export function pickStation(data: AvailabilityData, plan: BookingPlan, occ: Interval): string | null | false {
  if (!plan.stationCandidates) return null;
  let best: { id: string; load: number } | null = null;
  for (const sid of plan.stationCandidates) {
    const st = data.stations.get(sid);
    if (!st || !stationFree(st, occ)) continue;
    const load = st.busy.filter((b) => overlaps(b, occ)).length;
    if (!best || load < best.load) best = { id: sid, load };
  }
  return best ? best.id : false;
}

/** Bir çalışanın belirli bir yerel gündeki serbest zaman aralıkları (mutlak ms) */
export function employeeFreeIntervals(data: AvailabilityData, emp: EmployeeInfo, localDate: string): Interval[] {
  const tz = data.business.timezone;
  const wd = weekdayOfLocalDate(localDate);
  const shifts = intersect(emp.hours.get(wd) ?? [], data.businessHours.get(wd) ?? []);
  if (!shifts.length) return [];
  const toAbs = ([s, e]: [number, number]): Interval => [zonedToUtc(localDate, s, tz).getTime(), zonedToUtc(localDate, e, tz).getTime()];
  let free = shifts.map(toAbs);
  free = subtract(free, (emp.breaks.get(wd) ?? []).map(toAbs));
  free = subtract(free, emp.timeOff);
  free = subtract(free, data.closures);
  free = subtract(free, emp.busy);
  return free;
}

export interface SlotOptions {
  employeeId?: string | null; // null/undefined = fark etmez
  now?: Date;
  /** İşletme panelinden manuel randevuda ön bildirim ve pencere kuralları uygulanmaz */
  ignoreBookingRules?: boolean;
}

/** Seçilen yerel gün için uygun başlangıç saatlerini hesaplar */
export function computeDaySlots(data: AvailabilityData, plan: BookingPlan, localDate: string, opts: SlotOptions = {}): Slot[] {
  const tz = data.business.timezone;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const step = data.business.slot_interval_minutes;
  const today = localDateOf(now, tz);

  if (!opts.ignoreBookingRules) {
    if (localDate < today) return [];
    if (localDate > addDaysLocal(today, data.business.booking_window_days)) return [];
  }
  if (plan.stationCandidates && plan.stationCandidates.length === 0) return [];

  const employeeIds = opts.employeeId ? plan.eligibleEmployeeIds.filter((e) => e === opts.employeeId) : plan.eligibleEmployeeIds;
  const earliest = opts.ignoreBookingRules ? -Infinity : nowMs + data.business.min_notice_minutes * 60000;
  const before = plan.prepMinutes * 60000;
  const after = (plan.innerMinutes + plan.cleanupMinutes) * 60000;

  const slotMap = new Map<number, Set<string>>();
  for (const eid of employeeIds) {
    const emp = data.employees.get(eid);
    if (!emp) continue;
    for (const [fs, fe] of employeeFreeIntervals(data, emp, localDate)) {
      // Izgara: gün içi dakikası adım katına denk gelen başlangıçlar
      const firstStartMs = fs + before;
      const localMin = minutesOfDayOf(new Date(firstStartMs), tz);
      const pad = (step - (localMin % step)) % step;
      for (let s = firstStartMs + pad * 60000; s + after <= fe; s += step * 60000) {
        if (s < earliest) continue;
        const occ: Interval = [s - before, s + after];
        if (pickStation(data, plan, occ) === false) continue;
        if (localDateOf(new Date(s), tz) !== localDate) continue;
        let set = slotMap.get(s);
        if (!set) slotMap.set(s, (set = new Set()));
        set.add(eid);
      }
    }
  }
  return [...slotMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, set]) => ({
      time: minutesToTime(minutesOfDayOf(new Date(s), tz)),
      startAt: new Date(s).toISOString(),
      endAt: new Date(s + plan.innerMinutes * 60000).toISOString(),
      employeeIds: [...set],
    }));
}

/** Belirli bir başlangıç için çalışan + istasyon uygunluğunu doğrular (randevu oluşturma/taşıma için) */
export function validateStart(
  data: AvailabilityData,
  plan: BookingPlan,
  startAt: Date,
  employeeId: string | null,
  opts: SlotOptions = {},
): { employeeId: string; stationId: string | null; occupied: Interval; endAt: Date } | null {
  const tz = data.business.timezone;
  const localDate = localDateOf(startAt, tz);
  const slots = computeDaySlots(data, plan, localDate, { ...opts, employeeId });
  const slot = slots.find((s) => new Date(s.startAt).getTime() === startAt.getTime());
  if (!slot) return null;
  const occ: Interval = [startAt.getTime() - plan.prepMinutes * 60000, startAt.getTime() + (plan.innerMinutes + plan.cleanupMinutes) * 60000];
  // "Fark etmez" seçiminde gün içinde en az randevusu olan çalışanı seç (yük dengeleme)
  const candidates = employeeId ? [employeeId] : slot.employeeIds;
  const dayStart = zonedToUtc(localDate, 0, tz).getTime();
  const dayEnd = zonedToUtc(addDaysLocal(localDate, 1), 0, tz).getTime();
  const chosen = candidates
    .map((id) => ({ id, load: (data.employees.get(id)?.busy ?? []).filter((b) => b[0] < dayEnd && b[1] > dayStart).length }))
    .sort((a, b) => a.load - b.load || a.id.localeCompare(b.id))[0];
  if (!chosen) return null;
  const station = pickStation(data, plan, occ);
  if (station === false) return null;
  return { employeeId: chosen.id, stationId: station, occupied: occ, endAt: new Date(startAt.getTime() + plan.innerMinutes * 60000) };
}

// ---------------------------------------------------------------------------
// Veritabanından yükleme
// ---------------------------------------------------------------------------
function groupMinutes(rows: { key: string | number; s: string; e: string }[]) {
  const m = new Map<string | number, [number, number][]>();
  for (const r of rows) {
    const arr = m.get(r.key) ?? [];
    arr.push([timeToMinutes(r.s), timeToMinutes(r.e)]);
    m.set(r.key, arr);
  }
  return m;
}

/**
 * Bir işletmenin [fromDate, toDate] yerel gün aralığı için müsaitlik verisini yükler.
 * excludeAppointmentId: randevu taşırken kendi kaydını meşgul saymamak için.
 */
export async function loadAvailabilityData(
  db: Db,
  businessId: string,
  fromDate: string,
  toDate: string,
  excludeAppointmentId: string | null = null,
): Promise<AvailabilityData> {
  const [b] = await db<(BusinessCfg & { verification_status: string })[]>`
    SELECT id, timezone, slot_interval_minutes, min_notice_minutes, booking_window_days, online_booking_enabled, verification_status
    FROM businesses WHERE id = ${businessId}`;
  if (!b) throw notFound('İşletme bulunamadı.');
  const tz = b.timezone;
  // Hazırlık süreleri gün sınırını aşabileceği için aralığı bir gün genişlet
  const rangeStart = zonedToUtc(addDaysLocal(fromDate, -1), 0, tz);
  const rangeEnd = zonedToUtc(addDaysLocal(toDate, 2), 0, tz);

  const [bh, closures, emps, ehours, ebreaks, eoff, stations, services, esvc, ssvc, appts] = await Promise.all([
    db<{ weekday: number; opening_time: string; closing_time: string }[]>`
      SELECT weekday, opening_time::text, closing_time::text FROM business_hours WHERE business_id = ${businessId}`,
    db<{ start_at: Date; end_at: Date }[]>`
      SELECT start_at, end_at FROM business_closures WHERE business_id = ${businessId} AND end_at > ${rangeStart} AND start_at < ${rangeEnd}`,
    db<{ id: string; display_name: string }[]>`
      SELECT id, display_name FROM employees WHERE business_id = ${businessId} AND is_active AND accepts_bookings ORDER BY sort_order, display_name`,
    db<{ employee_id: string; weekday: number; start_time: string; end_time: string }[]>`
      SELECT h.employee_id, h.weekday, h.start_time::text, h.end_time::text FROM employee_hours h
      JOIN employees e ON e.id = h.employee_id WHERE e.business_id = ${businessId}`,
    db<{ employee_id: string; weekday: number; start_time: string; end_time: string }[]>`
      SELECT x.employee_id, x.weekday, x.start_time::text, x.end_time::text FROM employee_breaks x
      JOIN employees e ON e.id = x.employee_id WHERE e.business_id = ${businessId}`,
    db<{ employee_id: string; start_at: Date; end_at: Date }[]>`
      SELECT t.employee_id, t.start_at, t.end_at FROM employee_time_off t JOIN employees e ON e.id = t.employee_id
      WHERE e.business_id = ${businessId} AND t.end_at > ${rangeStart} AND t.start_at < ${rangeEnd}`,
    db<{ id: string; capacity: number }[]>`SELECT id, capacity FROM stations WHERE business_id = ${businessId} AND is_active`,
    db<Omit<ServiceInfo, 'employeeIds' | 'stationIds'>[]>`
      SELECT id, name, duration_minutes, preparation_minutes, cleanup_minutes, price_type, price_amount::text, price_max_amount::text
      FROM services WHERE business_id = ${businessId} AND is_active`,
    db<{ employee_id: string; service_id: string }[]>`
      SELECT es.employee_id, es.service_id FROM employee_services es JOIN services s ON s.id = es.service_id WHERE s.business_id = ${businessId}`,
    db<{ station_id: string; service_id: string }[]>`
      SELECT ss.station_id, ss.service_id FROM station_services ss JOIN stations st ON st.id = ss.station_id
      WHERE st.business_id = ${businessId} AND st.is_active`,
    db<{ id: string; employee_id: string; station_id: string | null; occ_start: Date; occ_end: Date }[]>`
      SELECT id, employee_id, station_id, lower(occupied) AS occ_start, upper(occupied) AS occ_end FROM appointments
      WHERE business_id = ${businessId} AND status IN ('pending', 'confirmed')
        AND occupied && tstzrange(${rangeStart}, ${rangeEnd})
        AND (${excludeAppointmentId}::uuid IS NULL OR id <> ${excludeAppointmentId}::uuid)`,
  ]);

  const businessHours = groupMinutes(bh.map((r) => ({ key: r.weekday, s: r.opening_time, e: r.closing_time }))) as Map<number, [number, number][]>;
  const employees = new Map<string, EmployeeInfo>();
  for (const e of emps) {
    employees.set(e.id, {
      id: e.id,
      display_name: e.display_name,
      hours: groupMinutes(ehours.filter((h) => h.employee_id === e.id).map((h) => ({ key: h.weekday, s: h.start_time, e: h.end_time }))) as Map<number, [number, number][]>,
      breaks: groupMinutes(ebreaks.filter((h) => h.employee_id === e.id).map((h) => ({ key: h.weekday, s: h.start_time, e: h.end_time }))) as Map<number, [number, number][]>,
      timeOff: eoff.filter((t) => t.employee_id === e.id).map((t) => [t.start_at.getTime(), t.end_at.getTime()] as Interval),
      busy: [],
    });
  }
  const stationMap = new Map<string, StationInfo>();
  for (const s of stations) stationMap.set(s.id, { id: s.id, capacity: s.capacity, busy: [] });
  for (const a of appts) {
    const iv: Interval = [a.occ_start.getTime(), a.occ_end.getTime()];
    employees.get(a.employee_id)?.busy.push(iv);
    if (a.station_id) stationMap.get(a.station_id)?.busy.push(iv);
  }
  const serviceMap = new Map<string, ServiceInfo>();
  for (const s of services) {
    serviceMap.set(s.id, {
      ...s,
      employeeIds: new Set(esvc.filter((x) => x.service_id === s.id).map((x) => x.employee_id)),
      stationIds: new Set(ssvc.filter((x) => x.service_id === s.id).map((x) => x.station_id)),
    });
  }
  return {
    business: b,
    businessHours,
    closures: closures.map((c) => [c.start_at.getTime(), c.end_at.getTime()] as Interval),
    employees,
    stations: stationMap,
    services: serviceMap,
  };
}

/** İleriye dönük günler için hangi günlerde en az bir boş saat olduğunu döndürür (takvim gösterimi) */
export function computeAvailableDays(data: AvailabilityData, plan: BookingPlan, fromDate: string, days: number, opts: SlotOptions = {}) {
  const out: { date: string; slots: number; first: string | null }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDaysLocal(fromDate, i);
    const slots = computeDaySlots(data, plan, d, opts);
    out.push({ date: d, slots: slots.length, first: slots[0]?.time ?? null });
  }
  return out;
}
