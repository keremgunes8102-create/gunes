// PayTR ile işletme aboneliği tahsilatı testleri (PayTR'ye gerçek istek gitmez; fetch taklit edilir)
import { Client, makeAdmin, registerUser, setupApprovedBusiness, sql, startTestServer, stopTestServer, baseUrl } from './helpers.ts';
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { runJobsOnce } from '../server/jobs.ts';

const KEY = process.env.PAYTR_MERCHANT_KEY!;
const SALT = process.env.PAYTR_MERCHANT_SALT!;
const sign = (oid: string, status: string, total: string) => createHmac('sha256', KEY).update(oid + SALT + status + total).digest('base64');

const realFetch = globalThis.fetch;
let lastPaytrForm: URLSearchParams | null = null;
function mockPaytr() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://www.paytr.com/')) {
      lastPaytrForm = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify({ status: 'success', token: 'TESTTOKEN123' }), { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

async function callback(fields: Record<string, string>) {
  const r = await realFetch(`${baseUrl}/api/payments/paytr/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: r.status, text: await r.text() };
}

let admin: Client;
before(async () => {
  await startTestServer();
  admin = await makeAdmin();
  mockPaytr();
});
after(async () => {
  globalThis.fetch = realFetch;
  await stopTestServer();
});

describe('Abonelik ve PayTR', () => {
  test('Herkese açık paketler: fiyatlar ve deneme süresi', async () => {
    const r = await new Client().get('/api/plans');
    const byCode = Object.fromEntries(r.body.plans.map((p: { code: string; price_amount: string }) => [p.code, Number(p.price_amount)]));
    assert.equal(byCode.free, 0);
    assert.equal(byCode.pro, 1000);
    assert.equal(byCode.premium, 1750);
    assert.equal(r.body.trialDays, 30);
    assert.equal(r.body.founding.slotsLeft, 10);
  });

  test('Fiyat sunucuda hesaplanır: dönem indirimi ve kurucu fiyatı', async () => {
    const { owner, bid } = await setupApprovedBusiness(admin);
    const b = await owner.get(`/api/panel/${bid}/billing`);
    assert.equal(b.status, 200);
    // Profesyonel: ilk 10 işletmeye kurucu fiyatı (600 TL/ay, en fazla 6 ay)
    assert.equal(b.body.quotes.pro[1].amount, 600);
    assert.equal(b.body.quotes.pro[1].founding, true);
    assert.equal(b.body.quotes.pro[6].amount, 3600);
    assert.equal(b.body.quotes.pro[12].founding, false, '12 ay kurucu sınırını aşar, liste fiyatı');
    assert.equal(b.body.quotes.pro[12].amount, 10000, '12 ay = 10 ay ücreti');
    assert.equal(b.body.quotes.premium[1].amount, 1750);
    assert.equal(b.body.quotes.premium[3].amount, 5250);
  });

  test('Ödeme başlatma PayTR token ister; istemci tutarı değiştiremez', async () => {
    const { owner, bid } = await setupApprovedBusiness(admin);
    const r = await owner.post(`/api/panel/${bid}/billing/checkout`, { plan_code: 'premium', months: 3, amount: 1 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.provider, 'paytr');
    assert.equal(r.body.iframeUrl, 'https://www.paytr.com/odeme/guvenli/TESTTOKEN123');
    assert.equal(lastPaytrForm!.get('payment_amount'), '525000', '5250 TL kuruş cinsinden');
    assert.equal(lastPaytrForm!.get('merchant_id'), '123456');
    assert.ok(lastPaytrForm!.get('paytr_token'));
    assert.equal((await owner.post(`/api/panel/${bid}/billing/checkout`, { plan_code: 'pro', months: 2 })).status, 400);
    assert.equal((await owner.post(`/api/panel/${bid}/billing/checkout`, { plan_code: 'free', months: 1 })).status, 400, 'ücretsiz paket için ödeme olmaz');
    assert.equal((await owner.post(`/api/panel/${bid}/billing/checkout`, { plan_code: 'pro', months: 1 })).status, 409, 'bekleyen ödeme varken art arda başlatılamaz');
  });

  test('Geçerli PayTR bildirimi paketi açar; tekrar gelen bildirim süreyi ikinci kez uzatmaz', async () => {
    const { owner, bid } = await setupApprovedBusiness(admin);
    const r = await owner.post(`/api/panel/${bid}/billing/checkout`, { plan_code: 'premium', months: 1 });
    const oid = r.body.merchantOid;
    const total = '175000';
    const cb1 = await callback({ merchant_oid: oid, status: 'success', total_amount: total, hash: sign(oid, 'success', total) });
    assert.equal(cb1.status, 200);
    assert.equal(cb1.text, 'OK');
    const b = await owner.get(`/api/panel/${bid}/billing`);
    assert.equal(b.body.current.code, 'premium');
    assert.equal(b.body.current.status, 'active');
    const exp1 = b.body.current.expires_at;
    const cb2 = await callback({ merchant_oid: oid, status: 'success', total_amount: total, hash: sign(oid, 'success', total) });
    assert.equal(cb2.text, 'OK');
    const b2 = await owner.get(`/api/panel/${bid}/billing`);
    assert.equal(b2.body.current.expires_at, exp1);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM subscriptions WHERE business_id = ${bid} AND status = 'active'`;
    assert.equal(n, 1);
    // Artık 10'dan fazla çalışan eklenebilir (Premium limiti)
    assert.equal(b2.body.current.feature_limits.max_employees, 25);
    const notifs = await owner.get('/api/me/notifications');
    assert.ok(notifs.body.some((x: { type: string }) => x.type === 'billing_paid'));
  });

  test('Sahte imzalı veya eksik tutarlı bildirim reddedilir', async () => {
    const { owner, bid } = await setupApprovedBusiness(admin);
    const r = await owner.post(`/api/panel/${bid}/billing/checkout`, { plan_code: 'premium', months: 1 });
    const oid = r.body.merchantOid;
    const bad = await callback({ merchant_oid: oid, status: 'success', total_amount: '175000', hash: 'sahte' });
    assert.equal(bad.status, 400);
    const low = await callback({ merchant_oid: oid, status: 'success', total_amount: '100', hash: sign(oid, 'success', '100') });
    assert.equal(low.text, 'OK');
    const [p] = await sql<{ status: string }[]>`SELECT status FROM payments WHERE merchant_oid = ${oid}`;
    assert.equal(p.status, 'failed');
    const b = await owner.get(`/api/panel/${bid}/billing`);
    assert.equal(b.body.current.code, 'pro', 'deneme paketi değişmedi');
    assert.equal(b.body.current.status, 'trialing');
  });

  test('Başarısız ödeme bildirimi kaydedilir, paket değişmez', async () => {
    const { owner, bid } = await setupApprovedBusiness(admin);
    const r = await owner.post(`/api/panel/${bid}/billing/checkout`, { plan_code: 'pro', months: 1 });
    const oid = r.body.merchantOid;
    const cb = await callback({ merchant_oid: oid, status: 'failed', total_amount: '60000', hash: sign(oid, 'failed', '60000'), failed_reason_msg: 'Yetersiz bakiye' });
    assert.equal(cb.text, 'OK');
    const s = await owner.get(`/api/panel/${bid}/billing/payments/${oid}`);
    assert.equal(s.body.status, 'failed');
    assert.match(s.body.failure_reason, /Yetersiz bakiye/);
  });

  test('Yetki: çalışan ve başka işletme ödeme başlatamaz; müşteri hiçbir ödeme ekranına erişemez', async () => {
    const a = await setupApprovedBusiness(admin);
    const b = await setupApprovedBusiness(admin);
    assert.equal((await a.owner.post(`/api/panel/${b.bid}/billing/checkout`, { plan_code: 'pro', months: 1 })).status, 404);
    const { client } = await registerUser();
    assert.equal((await client.get(`/api/panel/${a.bid}/billing`)).status, 404);
    assert.equal((await client.get('/api/admin/payments')).status, 403);
    const adm = await admin.get('/api/admin/payments');
    assert.equal(adm.status, 200);
    assert.ok(Number(adm.body.summary.total) > 0);
  });

  test('Ücretli paket süresi bitince ücretsize düşer, veriler silinmez', async () => {
    const { owner, bid } = await setupApprovedBusiness(admin);
    const r = await owner.post(`/api/panel/${bid}/billing/checkout`, { plan_code: 'premium', months: 1 });
    const oid = r.body.merchantOid;
    await callback({ merchant_oid: oid, status: 'success', total_amount: '175000', hash: sign(oid, 'success', '175000') });
    await sql`UPDATE subscriptions SET expires_at = now() - interval '1 minute' WHERE business_id = ${bid} AND status = 'active'`;
    await runJobsOnce();
    const b = await owner.get(`/api/panel/${bid}/billing`);
    assert.equal(b.body.current.code, 'free');
    const emps = await owner.get(`/api/panel/${bid}/employees`);
    assert.equal(emps.body.length, 1, 'çalışan kaydı korunur');
  });
});
