// 5 paket ve ücretli öne çıkarma: üst paket önerilen sıralamada üstte, Vitrin "Sponsorlu" olarak sabitlenir, etiketler şeffaf.
import { Client, makeAdmin, setupApprovedBusiness, sql, startTestServer, stopTestServer } from './helpers.ts';
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

let admin: Client;
before(async () => {
  await startTestServer();
  admin = await makeAdmin();
});
after(stopTestServer);

const DISTRICT = 'Sıralamaköy';

async function setPlan(bid: string, code: string, status: 'active' | 'trialing' = 'active') {
  await sql`UPDATE subscriptions SET status = 'cancelled' WHERE business_id = ${bid} AND status IN ('active', 'trialing', 'past_due')`;
  await sql`INSERT INTO subscriptions (business_id, plan_id, status, expires_at)
            SELECT ${bid}, id, ${status}, now() + interval '30 days' FROM plans WHERE code = ${code}`;
}

async function search(params: string) {
  const r = await new Client().get(`/api/businesses?district=${encodeURIComponent(DISTRICT)}&${params}`);
  assert.equal(r.status, 200);
  return r.body.items as { id: string; placement: string | null; plan_level: number }[];
}

describe('Paketler ve sıralama', () => {
  test('5 paket fiyat sırasıyla, öne çıkma seviyeleri artan', async () => {
    const r = await new Client().get('/api/plans');
    const plans = r.body.plans as { code: string; price_amount: string; feature_limits: { boost: number } }[];
    assert.deepEqual(plans.map((p) => p.code), ['free', 'starter', 'pro', 'premium', 'elite']);
    for (let i = 1; i < plans.length; i++) {
      assert.ok(Number(plans[i].price_amount) > Number(plans[i - 1].price_amount));
      assert.equal(plans[i].feature_limits.boost, i);
    }
  });

  test('Önerilen sıralamada fazla ödeyen üstte; deneme öne çıkarmaz; Vitrin başka sıralamada Sponsorlu', async () => {
    const free = await setupApprovedBusiness(admin);
    const trial = await setupApprovedBusiness(admin); // deneme (Profesyonel) — öne çıkarmaz
    const starter = await setupApprovedBusiness(admin);
    const premium = await setupApprovedBusiness(admin);
    const elite = await setupApprovedBusiness(admin);
    const all = [free, trial, starter, premium, elite];
    await sql`UPDATE businesses SET district = ${DISTRICT} WHERE id = ANY(${all.map((b) => b.bid)}::uuid[])`;
    await setPlan(free.bid, 'free');
    await setPlan(starter.bid, 'starter');
    await setPlan(premium.bid, 'premium');
    await setPlan(elite.bid, 'elite');
    // Ücretsiz işletmeye iyi bir puan verelim: kalite tek başına ücretli sıralamayı geçemez
    const items = await search('sort=recommended');
    assert.equal(items.length, 5);
    assert.deepEqual(items.slice(0, 3).map((i) => i.id), [elite.bid, premium.bid, starter.bid]);
    assert.equal(items.find((i) => i.id === trial.bid)!.plan_level, 0);
    assert.equal(items[0].placement, 'promoted');
    assert.equal(items.find((i) => i.id === free.bid)!.placement, null);

    // Kullanıcı fiyat sıralaması seçerse yalnızca Vitrin "Sponsorlu" olarak en üste sabitlenir
    await sql`UPDATE services SET price_amount = 999 WHERE business_id = ${elite.bid}`;
    const byPrice = await search('sort=price_asc');
    assert.equal(byPrice[0].id, elite.bid);
    assert.equal(byPrice[0].placement, 'sponsored');
    assert.equal(byPrice.filter((i) => i.placement === 'sponsored').length, 1);
    assert.equal(byPrice[1].placement, null, 'diğer kartlar etiketsiz ve normal sırada');
  });

  test('Kalite tabanı: puanı 3,5 altındaki işletme ücretli olsa da öne çıkarılmaz', async () => {
    const low = await setupApprovedBusiness(admin);
    await sql`UPDATE businesses SET district = ${DISTRICT} WHERE id = ${low.bid}`;
    await setPlan(low.bid, 'elite');
    // 5 yayınlanmış düşük puanlı yorum (doğrudan veri; yorum akışı ayrı testlerde)
    const [cust] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
    for (let i = 0; i < 5; i++) {
      const off = 10 + i;
      const [a] = await sql<{ id: string }[]>`
        INSERT INTO appointments (public_reference, business_id, employee_id, customer_user_id, start_at, end_at, occupied, status, source,
                                  price_type_snapshot, duration_snapshot, cancel_min_hours_snapshot)
        VALUES (${'LOW' + i + Date.now()}, ${low.bid}, ${low.employeeIds[0]}, ${cust.id},
                now() - make_interval(days => ${off}), now() - make_interval(days => ${off}) + interval '30 minutes',
                tstzrange(now() - make_interval(days => ${off}), now() - make_interval(days => ${off}) + interval '30 minutes'),
                'completed', 'manual', 'fixed', 30, 3)
        RETURNING id`;
      await sql`INSERT INTO reviews (business_id, appointment_id, customer_user_id, rating, comment, moderation_status)
                VALUES (${low.bid}, ${a.id}, ${cust.id}, 2, 'Beklediğim gibi değildi.', 'published')`;
    }
    const items = await search('sort=recommended');
    const it = items.find((i) => i.id === low.bid)!;
    assert.equal(it.plan_level, 0);
    assert.equal(it.placement, null);
    const byPrice = await search('sort=price_asc');
    assert.notEqual(byPrice.find((i) => i.id === low.bid)!.placement, 'sponsored');
  });
});
