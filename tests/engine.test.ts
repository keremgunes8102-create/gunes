// Müsaitlik motorunun veritabanından bağımsız birim testleri
import './env.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, computeDaySlots, subtract, validateStart, type AvailabilityData, type ServiceInfo } from '../server/availability.ts';
import { zonedToUtc, localDateOf, minutesOfDayOf, weekdayOfLocalDate, addDaysLocal } from '../shared/time.ts';

const TZ = 'Europe/Istanbul';
const DATE = '2030-03-05'; // Salı
const WD = weekdayOfLocalDate(DATE);
const at = (hhmm: string, date = DATE) => {
  const [h, m] = hhmm.split(':').map(Number);
  return zonedToUtc(date, h * 60 + m, TZ).getTime();
};
const NOW = new Date(zonedToUtc('2030-03-01', 9 * 60, TZ));

function svc(id: string, dur: number, opts: Partial<ServiceInfo> = {}): ServiceInfo {
  return { id, name: id, duration_minutes: dur, preparation_minutes: 0, cleanup_minutes: 0, price_type: 'fixed', price_amount: '100', price_max_amount: null, employeeIds: new Set(['e1', 'e2']), stationIds: new Set(), ...opts };
}

function baseData(): AvailabilityData {
  return {
    business: { id: 'b', timezone: TZ, slot_interval_minutes: 15, min_notice_minutes: 60, booking_window_days: 30, online_booking_enabled: true },
    businessHours: new Map([[WD, [[9 * 60, 18 * 60]]]]),
    closures: [],
    employees: new Map([
      ['e1', { id: 'e1', display_name: 'A', hours: new Map([[WD, [[9 * 60, 18 * 60]]]]), breaks: new Map([[WD, [[13 * 60, 14 * 60]]]]), timeOff: [], busy: [] }],
      ['e2', { id: 'e2', display_name: 'B', hours: new Map([[WD, [[12 * 60, 18 * 60]]]]), breaks: new Map(), timeOff: [], busy: [] }],
    ]),
    stations: new Map(),
    services: new Map([
      ['cut', svc('cut', 30)],
      ['beard', svc('beard', 20, { cleanup_minutes: 10 })],
      ['color', svc('color', 60, { preparation_minutes: 15, employeeIds: new Set(['e1']) })],
    ]),
  };
}

test('saat dilimi dönüşümü: İstanbul UTC+3', () => {
  const d = zonedToUtc('2030-03-05', 9 * 60, TZ);
  assert.equal(d.toISOString(), '2030-03-05T06:00:00.000Z');
  assert.equal(localDateOf(d, TZ), '2030-03-05');
  assert.equal(minutesOfDayOf(d, TZ), 540);
  assert.equal(weekdayOfLocalDate('2030-03-05'), 1); // Salı
  assert.equal(addDaysLocal('2030-02-28', 1), '2030-03-01');
});

test('aralık çıkarma', () => {
  assert.deepEqual(subtract([[0, 100]], [[20, 30], [50, 60]]), [[0, 20], [30, 50], [60, 100]]);
  assert.deepEqual(subtract([[0, 100]], [[0, 100]]), []);
});

test('çalışma saatleri ve mola dikkate alınır', () => {
  const data = baseData();
  const plan = buildPlan(data, ['cut']);
  const slots = computeDaySlots(data, plan, DATE, { employeeId: 'e1', now: NOW });
  const times = slots.map((s) => s.time);
  assert.equal(times[0], '09:00');
  assert.ok(times.includes('12:30'), '12:30–13:00 molaya değmez');
  assert.ok(!times.includes('12:45'), '12:45–13:15 mola ile çakışır');
  assert.ok(!times.includes('13:00'));
  assert.ok(times.includes('14:00'));
  assert.equal(times.at(-1), '17:30');
});

test('çakışan randevu: 10:00–10:30 varken 10:15 verilmez, farklı çalışan verebilir', () => {
  const data = baseData();
  data.employees.get('e1')!.busy.push([at('10:00'), at('10:30')]);
  const plan = buildPlan(data, ['cut']);
  const e1 = computeDaySlots(data, plan, DATE, { employeeId: 'e1', now: NOW }).map((s) => s.time);
  assert.ok(!e1.includes('09:45') && !e1.includes('10:00') && !e1.includes('10:15'));
  assert.ok(e1.includes('09:30') && e1.includes('10:30'));
  // e2 12:00'de başlar; 12:00'de iki çalışan da müsait
  const any = computeDaySlots(data, plan, DATE, { now: NOW });
  assert.deepEqual(any.find((s) => s.time === '12:00')!.employeeIds.sort(), ['e1', 'e2']);
});

test('hazırlık ve temizlik süreleri meşguliyete eklenir', () => {
  const data = baseData();
  const plan = buildPlan(data, ['color']); // 15 dk hazırlık + 60 dk
  const times = computeDaySlots(data, plan, DATE, { employeeId: 'e1', now: NOW }).map((s) => s.time);
  assert.equal(times[0], '09:15', 'hazırlık vardiya içinde olmalı');
  const beard = buildPlan(data, ['beard']); // 20 + 10 temizlik = 30
  const t2 = computeDaySlots(data, beard, DATE, { employeeId: 'e1', now: NOW }).map((s) => s.time);
  assert.ok(t2.includes('12:30') && !t2.includes('12:45'));
});

test('birden fazla hizmet: toplam süre ve yalnızca hepsini yapabilen çalışan', () => {
  const data = baseData();
  const plan = buildPlan(data, ['cut', 'color']);
  assert.deepEqual(plan.eligibleEmployeeIds, ['e1']);
  assert.equal(plan.innerMinutes, 30 + 15 + 60);
});

test('istasyon kapasitesi: tek boya istasyonu iki çalışan tarafından aynı anda kullanılamaz', () => {
  const data = baseData();
  data.services.get('color')!.employeeIds = new Set(['e1', 'e2']);
  data.services.get('color')!.stationIds = new Set(['s1']);
  data.stations.set('s1', { id: 's1', capacity: 1, busy: [[at('12:00'), at('13:15')]] });
  const plan = buildPlan(data, ['color']);
  const times = computeDaySlots(data, plan, DATE, { now: NOW }).map((s) => s.time);
  assert.ok(!times.includes('12:15'), 'istasyon dolu');
  assert.ok(times.includes('14:30'));
  data.stations.get('s1')!.capacity = 2;
  const t2 = computeDaySlots(data, plan, DATE, { employeeId: 'e2', now: NOW }).map((s) => s.time);
  assert.ok(t2.includes('12:15'), 'kapasite 2 iken müsait');
});

test('koltuk varken çalışan yoksa saat verilmez', () => {
  const data = baseData();
  data.employees.get('e1')!.timeOff.push([at('00:00'), at('23:59')]);
  data.employees.get('e2')!.timeOff.push([at('00:00'), at('23:59')]);
  const plan = buildPlan(data, ['cut']);
  assert.equal(computeDaySlots(data, plan, DATE, { now: NOW }).length, 0);
});

test('işletme tatili ve geçmiş/ön bildirim kuralları', () => {
  const data = baseData();
  data.closures.push([at('00:00'), at('12:00')]);
  const plan = buildPlan(data, ['cut']);
  const times = computeDaySlots(data, plan, DATE, { now: NOW }).map((s) => s.time);
  assert.equal(times[0], '12:00');
  const now = new Date(at('14:10'));
  const t2 = computeDaySlots(data, plan, DATE, { now }).map((s) => s.time);
  assert.equal(t2[0], '15:15', 'en az 60 dk ön bildirim, 15 dk ızgaraya yuvarlanır');
  assert.equal(computeDaySlots(data, plan, '2030-03-04', { now }).length, 0, 'geçmiş gün');
  assert.equal(computeDaySlots(data, plan, '2030-06-01', { now: NOW }).length, 0, 'randevu penceresi dışı');
});

test('validateStart: "fark etmez" seçiminde en az yüklü çalışanı seçer', () => {
  const data = baseData();
  data.employees.get('e1')!.busy.push([at('09:00'), at('09:30')]);
  const plan = buildPlan(data, ['cut']);
  const v = validateStart(data, plan, new Date(at('15:00')), null, { now: NOW });
  assert.equal(v?.employeeId, 'e2');
  assert.equal(validateStart(data, plan, new Date(at('15:05')), null, { now: NOW }), null, 'ızgara dışı saat');
});
