import './env.ts';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createAppServer } from '../server/app.ts';
import { migrate } from '../scripts/migrate.ts';
import { sql, closeDb } from '../server/db.ts';
import { resetRateLimits } from '../server/security.ts';
import { addDaysLocal, localDateOf, weekdayOfLocalDate } from '../shared/time.ts';

let server: Server | null = null;
export let baseUrl = '';

export async function startTestServer() {
  await migrate({ reset: true, quiet: true });
  resetRateLimits();
  server = createAppServer();
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

export async function stopTestServer() {
  await new Promise<void>((r) => server?.close(() => r()));
  await closeDb();
}

export interface Res<T = any> {
  status: number;
  body: T;
}

/** Çerez ve CSRF anahtarını taşıyan basit tarayıcı benzeri istemci */
export class Client {
  cookie = '';
  csrf: string | null = null;
  constructor(public label = 'client') {}
  async req<T = any>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { 'X-Koltuk-Client': '1', ...extraHeaders };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(baseUrl + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie();
    for (const c of set) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      if (name === 'koltuk_session') this.cookie = value ? `koltuk_session=${value}` : '';
    }
    const text = await r.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* metin */
    }
    if (parsed && typeof parsed === 'object' && 'csrfToken' in parsed) this.csrf = parsed.csrfToken;
    return { status: r.status, body: parsed };
  }
  get<T = any>(p: string) { return this.req<T>('GET', p); }
  post<T = any>(p: string, b: unknown = {}) { return this.req<T>('POST', p, b); }
  put<T = any>(p: string, b: unknown = {}) { return this.req<T>('PUT', p, b); }
  patch<T = any>(p: string, b: unknown = {}) { return this.req<T>('PATCH', p, b); }
  del<T = any>(p: string) { return this.req<T>('DELETE', p); }
}

let counter = 0;
export async function registerUser(name = 'Test Kullanıcı') {
  const c = new Client(name);
  counter++;
  resetRateLimits(); // testler tek IP'den çok sayıda hesap açar
  const email = `test${counter}-${randomUUID().slice(0, 6)}@ornek.test`;
  const r = await c.post('/api/auth/register', { full_name: name, email, password: 'Sifre1234', accept_terms: true, privacy_notice_ack: true });
  if (r.status !== 201) throw new Error(`Kayıt başarısız: ${JSON.stringify(r.body)}`);
  return { client: c, email, id: r.body.user.id as string };
}

export async function makeAdmin(): Promise<Client> {
  const { client, id } = await registerUser('Test Yönetici');
  await sql`UPDATE users SET platform_role = 'admin' WHERE id = ${id}`;
  await client.get('/api/auth/me'); // oturumu yenile
  return client;
}

/** Yarın değil, ileride bir Salı günü (çalışma günü) döndürür — testleri haftanın gününden bağımsız kılar */
export function futureWeekday(targetWeekday = 1, minDaysAhead = 2): string {
  const today = localDateOf(new Date(), 'Europe/Istanbul');
  for (let i = minDaysAhead; i < minDaysAhead + 8; i++) {
    const d = addDaysLocal(today, i);
    if (weekdayOfLocalDate(d) === targetWeekday) return d;
  }
  throw new Error('unreachable');
}

export const allDays = (start = '09:00', end = '18:00') => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ start, end }] }));

/** Sihirbaz akışını API üzerinden tamamlayıp onaylanmış bir işletme kurar */
export async function setupApprovedBusiness(admin: Client, opts: { autoConfirm?: boolean; employees?: number } = {}) {
  const { client: owner, id: ownerId } = await registerUser('Test Sahip');
  const created = await owner.post('/api/panel/businesses', { name: `Test Berber ${randomUUID().slice(0, 4)}`, business_type: 'barber', phone: '0532 111 22 33' });
  if (created.status !== 201) throw new Error(JSON.stringify(created.body));
  const bid = created.body.id as string;
  await owner.patch(`/api/panel/${bid}/address`, { city: 'İstanbul', district: 'Kadıköy', address: 'Test Sokak No:1' });
  await owner.put(`/api/panel/${bid}/hours`, { days: allDays('09:00', '18:00') });
  const svc = await owner.post(`/api/panel/${bid}/services`, { name: 'Saç kesimi', duration_minutes: 30, price_type: 'fixed', price_amount: 400 });
  const svcLong = await owner.post(`/api/panel/${bid}/services`, { name: 'Saç ve sakal', duration_minutes: 45, price_type: 'fixed', price_amount: 550, cleanup_minutes: 15 });
  const employeeIds: string[] = [];
  for (let i = 0; i < (opts.employees ?? 1); i++) {
    const e = await owner.post(`/api/panel/${bid}/employees`, {
      display_name: `Usta ${i + 1}`,
      service_ids: [svc.body.id, svcLong.body.id],
      hours: allDays('09:00', '18:00'),
      breaks: [{ weekday: 1, intervals: [{ start: '13:00', end: '14:00' }] }],
    });
    if (e.status !== 201) throw new Error(JSON.stringify(e.body));
    employeeIds.push(e.body.id);
  }
  await owner.put(`/api/panel/${bid}/settings`, {
    auto_confirm: opts.autoConfirm ?? true,
    booking_window_days: 60,
    min_notice_minutes: 60,
    cancel_min_hours: 3,
    slot_interval_minutes: 15,
    allow_employee_choice: true,
    accept_new_customers: true,
    online_booking_enabled: true,
    pending_expiry_minutes: 120,
    cancellation_policy: 'En geç 3 saat önce iptal edilebilir.',
  });
  const sub = await owner.post(`/api/panel/${bid}/submit`);
  if (sub.status !== 200) throw new Error(JSON.stringify(sub.body));
  const dec = await admin.post(`/api/admin/businesses/${bid}/decision`, { decision: 'approve' });
  if (dec.status !== 200) throw new Error(JSON.stringify(dec.body));
  const [b] = await sql<{ slug: string }[]>`SELECT slug FROM businesses WHERE id = ${bid}`;
  return { owner, ownerId, bid, slug: b.slug, serviceId: svc.body.id as string, longServiceId: svcLong.body.id as string, employeeIds };
}

export const key = () => randomUUID();
export { sql };
