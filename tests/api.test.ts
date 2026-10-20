// Uçtan uca API testleri: gerçek HTTP sunucusu + gerçek PostgreSQL (koltuk_test veritabanı).
// Spesifikasyondaki 18. bölüm test senaryolarını kapsar (numaralar yorumlarda).
import { Client, allDays, futureWeekday, key, makeAdmin, registerUser, setupApprovedBusiness, sql, startTestServer, stopTestServer } from './helpers.ts';
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc } from '../shared/time.ts';
import { runJobsOnce } from '../server/jobs.ts';

const TZ = 'Europe/Istanbul';
const iso = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return zonedToUtc(date, h * 60 + m, TZ).toISOString();
};

let admin: Client;
before(async () => {
  await startTestServer();
  admin = await makeAdmin();
});
after(stopTestServer);

describe('Kimlik doğrulama', () => {
  test('1. Yeni müşteri kayıt olup giriş yapabiliyor', async () => {
    const { client, email } = await registerUser('Ayşe Yılmaz');
    const me = await client.get('/api/auth/me');
    assert.equal(me.body.user.email, email);
    await client.post('/api/auth/logout');
    assert.equal((await client.get('/api/auth/me')).body.user, null);
    const fresh = new Client();
    const bad = await fresh.post('/api/auth/login', { email, password: 'yanlis-sifre1' });
    assert.equal(bad.status, 401);
    const ok = await fresh.post('/api/auth/login', { email, password: 'Sifre1234' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.full_name, 'Ayşe Yılmaz');
    const [u] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE lower(email) = ${email}`;
    assert.ok(u.password_hash.startsWith('scrypt$') && !u.password_hash.includes('Sifre1234'), 'şifre düz metin saklanmaz');
  });

  test('Hız sınırlaması: art arda hatalı girişler engellenir', async () => {
    const { email } = await registerUser();
    const c = new Client();
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await c.post('/api/auth/login', { email, password: 'Yanlis1234' })).status);
    assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
    assert.equal(statuses[8], 429);
    // Doğru şifre de kilit süresince reddedilir
    assert.equal((await c.post('/api/auth/login', { email, password: 'Sifre1234' })).status, 429);
  });

  test('Kayıt doğrulaması: zayıf şifre ve onaysız koşullar reddedilir; aynı e-posta ikinci kez kaydolamaz', async () => {
    const c = new Client();
    const r = await c.post('/api/auth/register', { full_name: 'X Y', email: 'a@b.co', password: 'kisa', accept_terms: false, privacy_notice_ack: true });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.password && r.body.error.fields.accept_terms);
    const { email } = await registerUser();
    const dup = await new Client().post('/api/auth/register', { full_name: 'Başka', email, password: 'Sifre1234', accept_terms: true, privacy_notice_ack: true });
    assert.equal(dup.status, 409);
  });

  test('CSRF: özel başlık ve oturum anahtarı olmadan değişiklik yapılamaz', async () => {
    const { client } = await registerUser();
    const r1 = await fetch(`${(await import('./helpers.ts')).baseUrl}/api/me/profile`, {
      method: 'PATCH',
      headers: { Cookie: client.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Saldırgan' }),
    });
    assert.equal(r1.status, 403);
    const saved = client.csrf;
    client.csrf = 'yanlis';
    assert.equal((await client.patch('/api/me/profile', { full_name: 'Saldırgan' })).status, 403);
    client.csrf = saved;
    assert.equal((await client.patch('/api/me/profile', { full_name: 'Gerçek Ad' })).status, 200);
  });

  test('E-posta doğrulama akışı (geliştirme modunda kod ekranda, gerçek gönderim iddia edilmez)', async () => {
    const { client } = await registerUser();
    const r = await client.post('/api/auth/verify/request', { channel: 'email' });
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, false);
    assert.match(r.body.devCode, /^\d{6}$/);
    assert.equal((await client.post('/api/auth/verify/confirm', { channel: 'email', code: '000000' === r.body.devCode ? '111111' : '000000' })).status, 422);
    assert.equal((await client.post('/api/auth/verify/confirm', { channel: 'email', code: r.body.devCode })).status, 200);
    assert.ok((await client.get('/api/auth/me')).body.user.email_verified_at);
  });
});

describe('İşletme kurulumu ve yönetici onayı', () => {
  test('2-6. İşletme oluşturma, profil, hizmet, çalışan, istasyon ve yönetici onayı', async () => {
    const { client: owner } = await registerUser('Salon Sahibi');
    const created = await owner.post('/api/panel/businesses', { name: 'Deneme Kuaför', business_type: 'hair_salon', phone: '05321112233' });
    assert.equal(created.status, 201);
    const bid = created.body.id;
    // Eksik bilgiyle başvuru reddedilir
    const early = await owner.post(`/api/panel/${bid}/submit`);
    assert.equal(early.status, 422);
    assert.equal((await owner.patch(`/api/panel/${bid}/address`, { city: 'İstanbul', district: 'Şişli', address: 'Örnek Sk. 5' })).status, 200);
    assert.equal((await owner.put(`/api/panel/${bid}/hours`, { days: allDays('10:00', '19:00') })).status, 200);
    const st = await owner.post(`/api/panel/${bid}/stations`, { name: 'Boya istasyonu', station_type: 'color', capacity: 1 });
    assert.equal(st.status, 201);
    const s = await owner.post(`/api/panel/${bid}/services`, { name: 'Saç boyama', duration_minutes: 120, price_type: 'range', price_amount: 2000, price_max_amount: 3000, station_ids: [st.body.id] });
    assert.equal(s.status, 201);
    const badRange = await owner.post(`/api/panel/${bid}/services`, { name: 'Hatalı', duration_minutes: 30, price_type: 'range', price_amount: 500, price_max_amount: 100 });
    assert.equal(badRange.status, 422);
    const e = await owner.post(`/api/panel/${bid}/employees`, { display_name: 'Selin', service_ids: [s.body.id], hours: allDays('10:00', '19:00') });
    assert.equal(e.status, 201);
    // Onaylanmadan aramada görünmez
    const before = await new Client().get('/api/businesses?q=Deneme');
    assert.equal(before.body.items.length, 0);
    assert.equal((await owner.post(`/api/panel/${bid}/submit`)).status, 200);
    // Yönetici gerekçesiz reddedemez
    assert.equal((await admin.post(`/api/admin/businesses/${bid}/decision`, { decision: 'reject' })).status, 422);
    assert.equal((await admin.post(`/api/admin/businesses/${bid}/decision`, { decision: 'approve' })).status, 200);
    const after = await new Client().get('/api/businesses?q=Deneme');
    assert.equal(after.body.items.length, 1);
    const notifs = await owner.get('/api/me/notifications');
    assert.ok(notifs.body.some((n: { type: string }) => n.type === 'business_approve'));
  });

  test('Plan sınırı: deneme bitip ücretsize düşünce 3. çalışan eklenemez', async () => {
    const { owner, bid, serviceId } = await setupApprovedBusiness(admin, { employees: 2 });
    // Yeni işletme 30 günlük Profesyonel deneme ile başlar
    const b1 = await owner.get(`/api/panel/${bid}/billing`);
    assert.equal(b1.body.current.status, 'trialing');
    assert.equal(b1.body.current.code, 'pro');
    await sql`UPDATE subscriptions SET expires_at = now() - interval '1 minute' WHERE business_id = ${bid} AND status = 'trialing'`;
    await runJobsOnce();
    const b2 = await owner.get(`/api/panel/${bid}/billing`);
    assert.equal(b2.body.current.code, 'free');
    const r = await owner.post(`/api/panel/${bid}/employees`, { display_name: 'Üçüncü', service_ids: [serviceId], hours: allDays() });
    assert.equal(r.status, 402);
  });
});

describe('Arama ve randevu', () => {
  test('7-11. Arama, hizmet/çalışan doğrulaması, müsaitlik ve çakışma koruması', async () => {
    const biz = await setupApprovedBusiness(admin, { employees: 1 });
    const { client: c1 } = await registerUser('Müşteri Bir');
    const { client: c2 } = await registerUser('Müşteri İki');
    // 8. Arama ve filtre
    const found = await c1.get(`/api/businesses?type=barber&city=${encodeURIComponent('İstanbul')}&service=${encodeURIComponent('Saç kesimi')}`);
    assert.ok(found.body.items.some((i: { slug: string }) => i.slug === biz.slug));
    const priceFiltered = await c1.get(`/api/businesses?max_price=100&q=${encodeURIComponent(biz.slug.split('-')[2] ?? 'Test')}`);
    assert.ok(!priceFiltered.body.items.some((i: { slug: string }) => i.slug === biz.slug), 'fiyat filtresi sonuçları değiştirir');
    const kuafor = await c1.get('/api/businesses?type=hair_salon');
    assert.ok(!kuafor.body.items.some((i: { slug: string }) => i.slug === biz.slug));

    // 9-10. Tarih seçimi ve müsaitlik
    const date = futureWeekday(1); // Salı; çalışanın 13:00-14:00 molası var
    const slots = await c1.get(`/api/businesses/${biz.slug}/slots?services=${biz.serviceId}&date=${date}`);
    assert.equal(slots.status, 200);
    const times: string[] = slots.body.slots.map((s: { time: string }) => s.time);
    assert.equal(times[0], '09:00');
    assert.ok(!times.includes('13:00') && !times.includes('12:45'), 'mola saatleri verilmez');

    // 7. Çalışan yalnızca yetkili olduğu hizmette: yetkisiz hizmet oluştur
    const other = await biz.owner.post(`/api/panel/${biz.bid}/services`, { name: 'Sakal tıraşı', duration_minutes: 20, price_type: 'fixed', price_amount: 200 });
    const noEmp = await c1.get(`/api/businesses/${biz.slug}/slots?services=${other.body.id}&date=${date}`);
    assert.equal(noEmp.body.slots.length, 0);
    const bookNoEmp = await c1.post('/api/me/appointments', { business_id: biz.bid, service_ids: [other.body.id], employee_id: biz.employeeIds[0], start_at: iso(date, '10:00'), idempotency_key: key() });
    assert.equal(bookNoEmp.status, 400);

    // 11. Çakışma: 10:00–10:30 alındıktan sonra 10:15 verilemez
    const a1 = await c1.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], employee_id: null, start_at: iso(date, '10:00'), idempotency_key: key() });
    assert.equal(a1.status, 201, JSON.stringify(a1.body));
    assert.equal(a1.body.status, 'confirmed');
    assert.match(a1.body.public_reference, /^KLT-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const a2 = await c2.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '10:15'), idempotency_key: key() });
    assert.equal(a2.status, 409);
    const slots2 = await c2.get(`/api/businesses/${biz.slug}/slots?services=${biz.serviceId}&date=${date}`);
    const t2: string[] = slots2.body.slots.map((s: { time: string }) => s.time);
    assert.ok(!t2.includes('10:00') && !t2.includes('10:15') && !t2.includes('09:45') && t2.includes('10:30'));
    // Izgara dışı saat de reddedilir
    const odd = await c2.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '10:37'), idempotency_key: key() });
    assert.equal(odd.status, 409);
  });

  test('12. Eşzamanlı aynı saat: yalnızca bir istek başarılı olur', async () => {
    const biz = await setupApprovedBusiness(admin, { employees: 1 });
    const date = futureWeekday(2);
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => registerUser(`Eşzamanlı ${i}`)));
    const results = await Promise.all(
      users.map(({ client }) => client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '11:00'), idempotency_key: key() })),
    );
    const ok = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    assert.equal(ok.length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(conflicts.length, 5);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM appointments WHERE business_id = ${biz.bid} AND status IN ('pending', 'confirmed')`;
    assert.equal(n, 1);
  });

  test('Idempotency: aynı istek tekrar gönderilince ikinci randevu oluşmaz', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { client } = await registerUser();
    const date = futureWeekday(3);
    const k = key();
    const body = { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '15:00'), idempotency_key: k };
    const [r1, r2] = await Promise.all([client.post('/api/me/appointments', body), client.post('/api/me/appointments', body)]);
    const statuses = [r1.status, r2.status].sort();
    assert.ok(statuses[0] === 200 || statuses[0] === 201, JSON.stringify([r1.body, r2.body]));
    const r3 = await client.post('/api/me/appointments', body);
    assert.equal(r3.status, 200);
    assert.equal(r3.body.replayed, true);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM appointments WHERE business_id = ${biz.bid}`;
    assert.equal(n, 1);
    // Başka kullanıcı aynı anahtarı kullanamaz
    const { client: other } = await registerUser();
    assert.equal((await other.post('/api/me/appointments', body)).status, 409);
  });

  test('13 ve 21. İptal politikası uygulanır; iptal edilen saat yeniden açılır', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { client } = await registerUser();
    const date = futureWeekday(4);
    const a = await client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '16:00'), idempotency_key: key() });
    assert.equal(a.status, 201);
    let t: string[] = (await client.get(`/api/businesses/${biz.slug}/slots?services=${biz.serviceId}&date=${date}`)).body.slots.map((s: { time: string }) => s.time);
    assert.ok(!t.includes('16:00'));
    const cancel = await client.post(`/api/me/appointments/${a.body.public_reference}/cancel`, { reason: 'Planım değişti' });
    assert.equal(cancel.status, 200);
    t = (await client.get(`/api/businesses/${biz.slug}/slots?services=${biz.serviceId}&date=${date}`)).body.slots.map((s: { time: string }) => s.time);
    assert.ok(t.includes('16:00'), 'kapasite yeniden açıldı');
    // İkinci iptal denemesi geçersiz durum
    assert.equal((await client.post(`/api/me/appointments/${a.body.public_reference}/cancel`, {})).status, 409);

    // İptal süresi geçmiş randevu müşteri tarafından iptal edilemez
    const b = await client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '17:00'), idempotency_key: key() });
    await sql`UPDATE appointments SET cancel_min_hours_snapshot = 168 WHERE public_reference = ${b.body.public_reference}`;
    const late = await client.post(`/api/me/appointments/${b.body.public_reference}/cancel`, {});
    assert.equal(late.status, 422);
    assert.equal(late.body.error.code, 'cancel_window_passed');
  });

  test('14. Çalışan izni ve işletme tatili müsaitliğe yansır', async () => {
    const biz = await setupApprovedBusiness(admin);
    const date = futureWeekday(4, 9);
    const c = new Client();
    const before = (await c.get(`/api/businesses/${biz.slug}/slots?services=${biz.serviceId}&date=${date}`)).body.slots.length;
    assert.ok(before > 10);
    const off = await biz.owner.post(`/api/panel/${biz.bid}/employees/${biz.employeeIds[0]}/time-off`, { start_date: date, end_date: date, start_time: '09:00', end_time: '12:00', reason: 'Doktor' });
    assert.equal(off.status, 201);
    const mid: string[] = (await c.get(`/api/businesses/${biz.slug}/slots?services=${biz.serviceId}&date=${date}`)).body.slots.map((s: { time: string }) => s.time);
    assert.equal(mid[0], '12:00');
    const closure = await biz.owner.post(`/api/panel/${biz.bid}/closures`, { start_date: date, end_date: date, reason: 'Resmî tatil' });
    assert.equal(closure.status, 201);
    assert.equal((await c.get(`/api/businesses/${biz.slug}/slots?services=${biz.serviceId}&date=${date}`)).body.slots.length, 0);
  });

  test('15. Hizmet fiyatı değişince eski randevu fiyatı korunur', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { client } = await registerUser();
    const date = futureWeekday(5);
    const a = await client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '09:30'), idempotency_key: key() });
    assert.equal(a.status, 201);
    const upd = await biz.owner.put(`/api/panel/${biz.bid}/services/${biz.serviceId}`, { name: 'Saç kesimi', duration_minutes: 30, price_type: 'fixed', price_amount: 999, employee_ids: biz.employeeIds });
    assert.equal(upd.status, 200);
    const detail = await client.get(`/api/me/appointments/${a.body.public_reference}`);
    assert.equal(Number(detail.body.price_snapshot), 400);
    assert.equal(Number(detail.body.services[0].price), 400);
  });

  test('25. Fiyat, süre ve durum istemciden manipüle edilemez', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { client } = await registerUser();
    const date = futureWeekday(5);
    const a = await client.post('/api/me/appointments', {
      business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '11:00'), idempotency_key: key(),
      price_snapshot: 1, duration_snapshot: 1, status: 'completed', end_at: iso(date, '11:01'),
    });
    assert.equal(a.status, 201);
    const [row] = await sql<{ price_snapshot: string; duration_snapshot: number; status: string; end_at: Date }[]>`
      SELECT price_snapshot::text, duration_snapshot, status, end_at FROM appointments WHERE public_reference = ${a.body.public_reference}`;
    assert.equal(Number(row.price_snapshot), 400);
    assert.equal(row.duration_snapshot, 30);
    assert.equal(row.status, 'confirmed');
    assert.equal(row.end_at.toISOString(), iso(date, '11:30'));
  });

  test('Manuel onay: bekleyen talep işletme onayıyla kesinleşir, süresi dolan talep serbest kalır', async () => {
    const biz = await setupApprovedBusiness(admin, { autoConfirm: false });
    const { client } = await registerUser();
    const date = futureWeekday(1, 9);
    const a = await client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '10:00'), idempotency_key: key() });
    assert.equal(a.body.status, 'pending');
    const list = await biz.owner.get(`/api/panel/${biz.bid}/appointments?status=pending`);
    assert.equal(list.body.length, 1);
    const ok = await biz.owner.post(`/api/panel/${biz.bid}/appointments/${list.body[0].id}/status`, { action: 'confirm' });
    assert.equal(ok.status, 200);
    const b = await client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '12:00'), idempotency_key: key() });
    await sql`UPDATE appointments SET pending_expires_at = now() - interval '1 minute' WHERE public_reference = ${b.body.public_reference}`;
    await runJobsOnce();
    const [row] = await sql<{ status: string }[]>`SELECT status FROM appointments WHERE public_reference = ${b.body.public_reference}`;
    assert.equal(row.status, 'expired');
    const t: string[] = (await client.get(`/api/businesses/${biz.slug}/slots?services=${biz.serviceId}&date=${date}`)).body.slots.map((s: { time: string }) => s.time);
    assert.ok(t.includes('12:00'));
  });

  test('Müşteri randevusunu kurallara göre başka saate taşıyabilir; işletme yeni saat önerebilir', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { client } = await registerUser();
    const date = futureWeekday(2, 9);
    const a = await client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '10:00'), idempotency_key: key() });
    const mv = await client.post(`/api/me/appointments/${a.body.public_reference}/reschedule`, { start_at: iso(date, '10:15') });
    assert.equal(mv.status, 200, JSON.stringify(mv.body)); // kendi eski kaydıyla çakışma sayılmaz
    const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM appointments WHERE public_reference = ${a.body.public_reference}`;
    const prop = await biz.owner.post(`/api/panel/${biz.bid}/appointments/${id}/propose`, { start_at: iso(date, '15:00'), employee_id: biz.employeeIds[0], note: 'Sabah dolu' });
    assert.equal(prop.status, 201);
    const detail = await client.get(`/api/me/appointments/${a.body.public_reference}`);
    const open = detail.body.proposals.find((p: { status: string }) => p.status === 'open');
    const resp = await client.post(`/api/me/proposals/${open.id}/respond`, { accept: true });
    assert.equal(resp.status, 200);
    const [row] = await sql<{ start_at: Date }[]>`SELECT start_at FROM appointments WHERE id = ${id}`;
    assert.equal(row.start_at.toISOString(), iso(date, '15:00'));
  });

  test('Birden fazla hizmet tek randevuda: toplam süre doğru hesaplanır', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { client } = await registerUser();
    const date = futureWeekday(3, 9);
    const a = await client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId, biz.longServiceId], start_at: iso(date, '09:00'), idempotency_key: key() });
    assert.equal(a.status, 201);
    const [row] = await sql<{ end_at: Date; duration_snapshot: number; price_snapshot: string; upper: Date }[]>`
      SELECT end_at, duration_snapshot, price_snapshot::text, upper(occupied) AS upper FROM appointments WHERE public_reference = ${a.body.public_reference}`;
    assert.equal(row.duration_snapshot, 75);
    assert.equal(row.end_at.toISOString(), iso(date, '10:15'));
    assert.equal(row.upper.toISOString(), iso(date, '10:30'), '15 dk temizlik süresi meşguliyete eklenir');
    assert.equal(Number(row.price_snapshot), 950);
  });
});

describe('Yetkilendirme ve gizlilik', () => {
  test('16. Müşteri başka müşterinin randevusuna erişemez', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { client: c1 } = await registerUser();
    const { client: c2 } = await registerUser();
    const date = futureWeekday(4, 9);
    const a = await c1.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '09:00'), idempotency_key: key() });
    assert.equal((await c2.get(`/api/me/appointments/${a.body.public_reference}`)).status, 404);
    assert.equal((await c2.post(`/api/me/appointments/${a.body.public_reference}/cancel`, {})).status, 404);
    assert.ok(!(await c2.get('/api/me/appointments')).body.some((x: { public_reference: string }) => x.public_reference === a.body.public_reference));
    // Müşteri işletme paneline erişemez
    assert.equal((await c1.get(`/api/panel/${biz.bid}/appointments`)).status, 404);
  });

  test('17. Bir işletme başka işletmenin verilerini değiştiremez', async () => {
    const a = await setupApprovedBusiness(admin);
    const b = await setupApprovedBusiness(admin);
    assert.equal((await a.owner.put(`/api/panel/${b.bid}/services/${b.serviceId}`, { name: 'Ele geçirildi', duration_minutes: 30, price_type: 'fixed', price_amount: 1 })).status, 404);
    // Kendi panelinden başka işletmenin kaydını değiştirme girişimi
    assert.equal((await a.owner.put(`/api/panel/${a.bid}/services/${b.serviceId}`, { name: 'Ele geçirildi', duration_minutes: 30, price_type: 'fixed', price_amount: 1 })).status, 400);
    // Başka işletmenin çalışanını kendi hizmetine bağlayamaz
    assert.equal((await a.owner.post(`/api/panel/${a.bid}/services`, { name: 'Sızma', duration_minutes: 30, price_type: 'fixed', price_amount: 1, employee_ids: [b.employeeIds[0]] })).status, 400);
    const [svc] = await sql<{ name: string }[]>`SELECT name FROM services WHERE id = ${b.serviceId}`;
    assert.equal(svc.name, 'Saç kesimi');
  });

  test('18. Yetkisiz kullanıcı yönetici paneline erişemez', async () => {
    const { client } = await registerUser();
    for (const p of ['/api/admin/stats', '/api/admin/businesses', '/api/admin/users', '/api/admin/audit']) {
      assert.equal((await client.get(p)).status, 403, p);
      assert.equal((await new Client().get(p)).status, 401, p);
    }
    assert.equal((await admin.get('/api/admin/stats')).status, 200);
  });

  test('Çalışan rolü yalnızca kendi randevularını görür ve fiyat/telefon göremez', async () => {
    const biz = await setupApprovedBusiness(admin, { employees: 2 });
    const { client: staff, email } = await registerUser('Personel');
    const inv = await biz.owner.post(`/api/panel/${biz.bid}/members/invite`, { email, role: 'staff', employee_id: biz.employeeIds[1] });
    assert.equal(inv.status, 201);
    const token = inv.body.inviteLink.split('/').pop();
    // Doğrulanmamış e-posta ile davet kabul edilemez
    assert.equal((await staff.post(`/api/invitations/${token}/accept`)).status, 403);
    const code = (await staff.post('/api/auth/verify/request', { channel: 'email' })).body.devCode;
    await staff.post('/api/auth/verify/confirm', { channel: 'email', code });
    // Başka bir kullanıcı daveti kullanamaz
    const { client: intruder } = await registerUser();
    assert.equal((await intruder.post(`/api/invitations/${token}/accept`)).status, 403);
    assert.equal((await staff.post(`/api/invitations/${token}/accept`)).status, 200);

    const { client: cust } = await registerUser();
    const date = futureWeekday(5, 9);
    await cust.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], employee_id: biz.employeeIds[0], start_at: iso(date, '09:00'), idempotency_key: key() });
    await cust.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], employee_id: biz.employeeIds[1], start_at: iso(date, '10:00'), idempotency_key: key() });
    const list = await staff.get(`/api/panel/${biz.bid}/appointments`);
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].customer_phone, null);
    assert.equal((await staff.get(`/api/panel/${biz.bid}/customers`)).status, 403);
    assert.equal((await staff.post(`/api/panel/${biz.bid}/services`, { name: 'X', duration_minutes: 30, price_type: 'fixed', price_amount: 1 })).status, 403);
    const ov = await staff.get(`/api/panel/${biz.bid}/overview`);
    assert.equal(ov.body.stats.today_estimated, null);
  });
});

describe('Yorumlar ve bildirimler', () => {
  test('19-20. Yalnızca tamamlanmış randevuya bir kez yorum yapılabilir', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { client } = await registerUser('Yorumcu Kişi');
    const date = futureWeekday(1, 2);
    const a = await client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(date, '14:00'), idempotency_key: key() });
    const ref = a.body.public_reference;
    assert.equal((await client.post(`/api/me/appointments/${ref}/review`, { rating: 5, comment: 'Harika' })).status, 400);
    // Gelecekteki randevu tamamlandı işaretlenemez
    const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM appointments WHERE public_reference = ${ref}`;
    assert.equal((await biz.owner.post(`/api/panel/${biz.bid}/appointments/${id}/status`, { action: 'complete' })).status, 400);
    await sql`UPDATE appointments SET start_at = now() - interval '2 hours', end_at = now() - interval '90 minutes',
              occupied = tstzrange(now() - interval '2 hours', now() - interval '90 minutes') WHERE id = ${id}`;
    assert.equal((await biz.owner.post(`/api/panel/${biz.bid}/appointments/${id}/status`, { action: 'complete' })).status, 200);
    const r1 = await client.post(`/api/me/appointments/${ref}/review`, { rating: 5, comment: 'Harika' });
    assert.equal(r1.status, 201);
    const r2 = await client.post(`/api/me/appointments/${ref}/review`, { rating: 1, comment: 'İkinci' });
    assert.equal(r2.status, 409);
    const { client: other } = await registerUser();
    assert.equal((await other.post(`/api/me/appointments/${ref}/review`, { rating: 1 })).status, 404);
    const pub = await new Client().get(`/api/businesses/${biz.slug}`);
    assert.equal(pub.body.business.review_count, 1);
    assert.equal(pub.body.reviews[0].author, 'Yorumcu K.');
  });

  test('24. Bildirimler ve hatırlatmalar tekrar gönderilmez; servis yoksa "gönderildi" denmez', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { client, id: uid } = await registerUser();
    const a = await client.post('/api/me/appointments', { business_id: biz.bid, service_ids: [biz.serviceId], start_at: iso(futureWeekday(2, 2), '09:00'), idempotency_key: key() });
    await sql`UPDATE notification_preferences SET reminder_hours = 48 WHERE user_id = ${uid}`;
    await sql`UPDATE appointments SET start_at = now() + interval '5 hours', end_at = now() + interval '5 hours 30 minutes',
              occupied = tstzrange(now() + interval '5 hours', now() + interval '5 hours 30 minutes') WHERE public_reference = ${a.body.public_reference}`;
    await runJobsOnce();
    await runJobsOnce();
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${uid} AND type = 'appointment_reminder'`;
    assert.equal(n, 1);
    const msgs = await sql<{ status: string }[]>`SELECT status FROM outbound_messages WHERE user_id = ${uid}`;
    assert.ok(msgs.length > 0);
    assert.ok(msgs.every((m) => m.status === 'skipped_unconfigured'), JSON.stringify(msgs));
  });
});

describe('Hata ve sınır durumları', () => {
  test('23. Bulunamayan kaynak ve geçersiz girdiler anlaşılır hata döner', async () => {
    const c = new Client();
    const r = await c.get('/api/businesses/olmayan-isletme');
    assert.equal(r.status, 404);
    assert.equal(typeof r.body.error.message, 'string');
    const empty = await c.get('/api/businesses?city=Hakkari');
    assert.equal(empty.status, 200);
    assert.equal(empty.body.items.length, 0);
    const bad = await c.get('/api/businesses?min_rating=9');
    assert.equal(bad.status, 422);
    assert.equal((await c.get('/api/olmayan')).status, 404);
  });

  test('KVKK: veri dökümü ve hesap silme talebi', async () => {
    const { client, id } = await registerUser('Silinecek Kişi');
    const exp = await client.get('/api/me/export');
    assert.equal(exp.body.user.full_name, 'Silinecek Kişi');
    assert.ok(Array.isArray(exp.body.consents));
    assert.equal((await client.post('/api/me/delete-account', { password: 'yanlis' })).status, 422);
    assert.equal((await client.post('/api/me/delete-account', { password: 'Sifre1234' })).status, 200);
    const reqs = await admin.get('/api/admin/data-requests');
    const req = reqs.body.find((d: { user_id: string }) => d.user_id === id);
    assert.ok(req);
    assert.equal((await admin.post(`/api/admin/data-requests/${req.id}`, { status: 'completed', anonymize: true })).status, 200);
    const [u] = await sql<{ full_name: string; account_status: string; email: string }[]>`SELECT full_name, account_status, email FROM users WHERE id = ${id}`;
    assert.equal(u.account_status, 'deleted');
    assert.equal(u.full_name, 'Silinmiş kullanıcı');
    assert.ok(u.email.endsWith('@koltuk.invalid'));
  });

  test('Görsel yükleme: imza kontrolü yapılır, sahte dosya reddedilir', async () => {
    const biz = await setupApprovedBusiness(admin);
    const { baseUrl } = await import('./helpers.ts');
    const headers = { 'X-Koltuk-Client': '1', 'X-CSRF-Token': biz.owner.csrf!, Cookie: biz.owner.cookie };
    const fake = await fetch(`${baseUrl}/api/panel/${biz.bid}/uploads?purpose=logo`, { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: Buffer.from('<script>alert(1)</script>') });
    assert.equal(fake.status, 400);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f3d3f60000000049454e44ae426082', 'hex');
    const ok = await fetch(`${baseUrl}/api/panel/${biz.bid}/uploads?purpose=logo`, { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: png });
    assert.equal(ok.status, 201);
    const { url } = (await ok.json()) as { url: string };
    const img = await fetch(baseUrl + url);
    assert.equal(img.headers.get('content-type'), 'image/png');
  });
});
