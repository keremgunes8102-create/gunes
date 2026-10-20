// İşletme aboneliği: fiyat hesabı, deneme süresi, PayTR iFrame API entegrasyonu, ödeme sonrası paket açma.
// Fiyat ve süre DAİMA sunucuda hesaplanır; istemciden gelen tutara güvenilmez.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';
import { sql, type Tx } from './db.ts';
import { badRequest, conflict, HttpError, notFound } from './http.ts';
import { notifyBusinessManagers } from './notify.ts';
import { audit } from './audit.ts';

export const PERIODS = [1, 3, 6, 12] as const;
export type Period = (typeof PERIODS)[number];
/** Uzun dönem indirimi: ödenen ay sayısı (12 ay alana 10 ay ücret) */
const BILLED_MONTHS: Record<Period, number> = { 1: 1, 3: 3, 6: 5.5, 12: 10 };

export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 30);
export const FOUNDING = {
  slots: Number(process.env.FOUNDING_SLOTS ?? 10),
  price: Number(process.env.FOUNDING_PRICE ?? 600),
  maxMonths: Number(process.env.FOUNDING_MAX_MONTHS ?? 6),
  planCode: 'pro',
};

export const paytr = {
  merchantId: process.env.PAYTR_MERCHANT_ID ?? '',
  merchantKey: process.env.PAYTR_MERCHANT_KEY ?? '',
  merchantSalt: process.env.PAYTR_MERCHANT_SALT ?? '',
  testMode: process.env.PAYTR_TEST_MODE === '1' ? '1' : '0',
};
export const paytrConfigured = () => Boolean(paytr.merchantId && paytr.merchantKey && paytr.merchantSalt);
/** PayTR yapılandırılmamış demo kurulumda, ödeme akışını göstermek için açıkça etiketli simülasyon */
export const demoPaymentsEnabled = () => !paytrConfigured() && config.demoMode;

export const supportWhatsapp = () => (process.env.SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');

const round2 = (n: number) => Math.round(n * 100) / 100;

interface PlanRow {
  id: string;
  code: string;
  name: string;
  price_amount: string;
  is_active: boolean;
}

/** Kurucu müşteri indiriminin bu işletme için geçerli olup olmadığı ve kalan ay */
export async function foundingStatus(db: Tx | typeof sql, businessId: string) {
  const [{ used_slots }] = await db<{ used_slots: number }[]>`
    SELECT count(DISTINCT business_id)::int AS used_slots FROM payments WHERE status = 'paid' AND founding`;
  const [{ months_used, is_member }] = await db<{ months_used: number; is_member: boolean }[]>`
    SELECT COALESCE(sum(months) FILTER (WHERE status = 'paid' AND founding), 0)::int AS months_used,
           bool_or(status = 'paid' AND founding) IS TRUE AS is_member
    FROM payments WHERE business_id = ${businessId}`;
  const [{ paid_before }] = await db<{ paid_before: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM payments WHERE business_id = ${businessId} AND status = 'paid' AND NOT founding) AS paid_before`;
  const slotsLeft = Math.max(0, FOUNDING.slots - used_slots);
  const monthsLeft = Math.max(0, FOUNDING.maxMonths - months_used);
  // Yer varsa yeni katılım; zaten kurucu üyeyse kalan aylarını kullanabilir. Daha önce tam fiyat ödemiş işletme katılamaz.
  const eligible = monthsLeft > 0 && !paid_before && (is_member || slotsLeft > 0);
  return { eligible, monthsLeft, slotsLeft, price: FOUNDING.price, maxMonths: FOUNDING.maxMonths };
}

export async function quote(db: Tx | typeof sql, businessId: string, planCode: string, months: number) {
  if (!PERIODS.includes(months as Period)) throw badRequest('Geçersiz süre.');
  const [plan] = await db<PlanRow[]>`SELECT id, code, name, price_amount::text, is_active FROM plans WHERE code = ${planCode}`;
  if (!plan || !plan.is_active) throw notFound('Paket bulunamadı.');
  const listMonthly = Number(plan.price_amount);
  if (!(listMonthly > 0)) throw badRequest('Bu paket ücretsizdir; ödeme gerekmez.');
  let founding = false;
  let monthly = listMonthly;
  let amount = round2(listMonthly * BILLED_MONTHS[months as Period]);
  if (plan.code === FOUNDING.planCode) {
    const f = await foundingStatus(db, businessId);
    if (f.eligible && months <= f.monthsLeft) {
      founding = true;
      monthly = f.price;
      amount = round2(f.price * months); // kurucu fiyatında ek dönem indirimi uygulanmaz
    }
  }
  return { plan, months: months as Period, monthly, amount, founding, listAmount: round2(listMonthly * months) };
}

// ---------------------------------------------------------------------------
// PayTR iFrame API
// ---------------------------------------------------------------------------
export function paytrHash(parts: string[]): string {
  return createHmac('sha256', paytr.merchantKey).update(parts.join('') + paytr.merchantSalt).digest('base64');
}

/** Bildirim (callback) imzası: base64(hmac_sha256(merchant_oid + salt + status + total_amount, key)) */
export function verifyPaytrCallback(p: { merchant_oid: string; status: string; total_amount: string; hash: string }): boolean {
  const expected = createHmac('sha256', paytr.merchantKey).update(p.merchant_oid + paytr.merchantSalt + p.status + p.total_amount).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(p.hash ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

const newOid = () => `KLT${Date.now().toString(36)}${randomBytes(6).toString('hex')}`.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface CheckoutInput {
  businessId: string;
  planCode: string;
  months: number;
  user: { id: string; email: string; full_name: string; phone: string | null };
  ip: string;
}

export async function startCheckout(input: CheckoutInput) {
  const q = await quote(sql, input.businessId, input.planCode, input.months);
  const [b] = await sql<{ name: string; phone: string | null; address: string | null; district: string | null; city: string | null; is_demo: boolean }[]>`
    SELECT name, phone, address, district, city, is_demo FROM businesses WHERE id = ${input.businessId}`;
  const provider = paytrConfigured() ? 'paytr' : demoPaymentsEnabled() ? 'demo' : null;
  if (!provider) throw new HttpError(503, 'payments_not_configured', 'Online ödeme henüz aktif değil. Paket yükseltmek için bizimle iletişime geçin.');
  // Açık bekleyen eski talepler yeni ödeme başlarken geçersiz sayılır
  await sql`UPDATE payments SET status = 'failed', failure_reason = 'Yeni ödeme başlatıldı' WHERE business_id = ${input.businessId} AND status = 'pending'`;
  const oid = newOid();
  const [pay] = await sql<{ id: string }[]>`
    INSERT INTO payments (business_id, plan_id, months, monthly_price, amount, founding, provider, merchant_oid, created_by_user_id)
    VALUES (${input.businessId}, ${q.plan.id}, ${q.months}, ${q.monthly}, ${q.amount}, ${q.founding}, ${provider}, ${oid}, ${input.user.id})
    RETURNING id`;
  await audit({ actor: input.user.id, businessId: input.businessId, action: 'billing.checkout', targetType: 'payment', targetId: pay.id, metadata: { plan: q.plan.code, months: q.months, amount: q.amount, provider }, ip: input.ip });

  if (provider === 'demo') return { provider, merchantOid: oid, quote: q };

  const paymentAmount = String(Math.round(q.amount * 100)); // kuruş
  const basket = Buffer.from(JSON.stringify([[`KOLTUK ${q.plan.name} paketi - ${q.months} ay (${b.name})`.slice(0, 120), q.amount.toFixed(2), 1]])).toString('base64');
  const noInstallment = '1';
  const maxInstallment = '0';
  const currency = 'TL';
  const email = input.user.email;
  const token = paytrHash([paytr.merchantId, input.ip, oid, email, paymentAmount, basket, noInstallment, maxInstallment, currency, paytr.testMode]);
  const back = `${config.appUrl}/panel/${input.businessId}/abonelik`;
  const form = new URLSearchParams({
    merchant_id: paytr.merchantId,
    user_ip: input.ip,
    merchant_oid: oid,
    email,
    payment_amount: paymentAmount,
    paytr_token: token,
    user_basket: basket,
    debug_on: config.isProduction ? '0' : '1',
    no_installment: noInstallment,
    max_installment: maxInstallment,
    user_name: input.user.full_name.slice(0, 60),
    user_address: [b.address, b.district, b.city].filter(Boolean).join(', ').slice(0, 400) || 'Türkiye',
    user_phone: (input.user.phone ?? b.phone ?? '').replace(/^\+90/, '0') || '05000000000',
    merchant_ok_url: `${back}?odeme=tamam&oid=${oid}`,
    merchant_fail_url: `${back}?odeme=basarisiz&oid=${oid}`,
    timeout_limit: '30',
    currency,
    test_mode: paytr.testMode,
    lang: 'tr',
  });
  let res: Response;
  try {
    res = await fetch('https://www.paytr.com/odeme/api/get-token', { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
  } catch {
    await sql`UPDATE payments SET status = 'failed', failure_reason = 'PayTR bağlantı hatası' WHERE id = ${pay.id}`;
    throw new HttpError(502, 'payment_provider_error', 'Ödeme sağlayıcısına ulaşılamadı. Lütfen birkaç dakika sonra tekrar deneyin.');
  }
  const j = (await res.json().catch(() => ({}))) as { status?: string; token?: string; reason?: string };
  if (j.status !== 'success' || !j.token) {
    await sql`UPDATE payments SET status = 'failed', failure_reason = ${`PayTR: ${(j.reason ?? 'bilinmeyen hata').slice(0, 200)}`} WHERE id = ${pay.id}`;
    console.error('[PAYTR] token alınamadı:', (j.reason ?? '').slice(0, 200));
    throw new HttpError(502, 'payment_provider_error', 'Ödeme başlatılamadı. Lütfen daha sonra tekrar deneyin.');
  }
  return { provider, merchantOid: oid, quote: q, iframeUrl: `https://www.paytr.com/odeme/guvenli/${j.token}` };
}

/**
 * Ödeme başarılı: aboneliği aç veya uzat. Tekrar gelen bildirimler (PayTR aynı bildirimi birden çok kez gönderebilir)
 * satır kilidi ve durum kontrolü sayesinde ikinci kez işlenmez.
 */
export async function markPaid(merchantOid: string, providerTotal: string | null) {
  return sql.begin(async (tx) => {
    const [p] = await tx<{ id: string; business_id: string; plan_id: string; months: number; monthly_price: string; status: string; amount: string; plan_name: string }[]>`
      SELECT p.id, p.business_id, p.plan_id, p.months, p.monthly_price::text, p.status, p.amount::text, pl.name AS plan_name
      FROM payments p JOIN plans pl ON pl.id = p.plan_id WHERE p.merchant_oid = ${merchantOid} FOR UPDATE OF p`;
    if (!p) return { handled: false as const };
    if (p.status === 'paid') return { handled: true as const, duplicate: true };
    await tx`UPDATE payments SET status = 'paid', paid_at = now(), provider_total = ${providerTotal}, failure_reason = NULL WHERE id = ${p.id}`;

    // Aynı paket aktif ve süresi devam ediyorsa süre sonuna eklenir; değilse bugünden başlar.
    const [cur] = await tx<{ id: string; plan_id: string; status: string; expires_at: Date | null }[]>`
      SELECT id, plan_id, status, expires_at FROM subscriptions
      WHERE business_id = ${p.business_id} AND status IN ('active', 'trialing', 'past_due') FOR UPDATE`;
    const now = new Date();
    const base = cur && cur.plan_id === p.plan_id && cur.status === 'active' && cur.expires_at && cur.expires_at > now ? cur.expires_at : now;
    const expires = new Date(base);
    expires.setMonth(expires.getMonth() + p.months);
    if (cur) await tx`UPDATE subscriptions SET status = 'cancelled' WHERE id = ${cur.id}`;
    await tx`INSERT INTO subscriptions (business_id, plan_id, status, started_at, expires_at, monthly_price, external_provider_reference, note)
             VALUES (${p.business_id}, ${p.plan_id}, 'active', now(), ${expires}, ${p.monthly_price}, ${`payment:${merchantOid}`}, ${`${p.months} ay`})`;
    await notifyBusinessManagers(tx, p.business_id, {
      type: 'billing_paid',
      title: 'Ödemeniz alındı',
      body: `${p.plan_name} paketiniz ${expires.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })} tarihine kadar aktif. Teşekkürler!`,
      link: `/panel/${p.business_id}/abonelik`,
      dedupeKey: `paid:${merchantOid}`,
      channels: { email: true },
    });
    await audit({ businessId: p.business_id, action: 'billing.paid', targetType: 'payment', targetId: p.id, metadata: { amount: p.amount, months: p.months } }, tx);
    return { handled: true as const, duplicate: false, expiresAt: expires };
  });
}

export async function markFailed(merchantOid: string, reason: string) {
  await sql`UPDATE payments SET status = 'failed', failure_reason = ${reason.slice(0, 300)} WHERE merchant_oid = ${merchantOid} AND status = 'pending'`;
}

/** Yeni işletmeye deneme aboneliği */
export async function startTrial(tx: Tx, businessId: string) {
  const [pro] = await tx<{ id: string }[]>`SELECT id FROM plans WHERE code = 'pro' AND is_active`;
  const [free] = await tx<{ id: string }[]>`SELECT id FROM plans WHERE code = 'free'`;
  if (pro && TRIAL_DAYS > 0) {
    await tx`INSERT INTO subscriptions (business_id, plan_id, status, expires_at, note)
             VALUES (${businessId}, ${pro.id}, 'trialing', now() + make_interval(days => ${TRIAL_DAYS}), ${`${TRIAL_DAYS} günlük deneme`})`;
  } else if (free) {
    await tx`INSERT INTO subscriptions (business_id, plan_id, status) VALUES (${businessId}, ${free.id}, 'active')`;
  }
}

/** Zamanlanmış görev: süresi biten abonelikleri ücretsiz pakete düşür, bitişe yakın olanlara hatırlat */
export async function processSubscriptions() {
  const [free] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = 'free'`;
  const expired = await sql<{ id: string; business_id: string; status: string }[]>`
    UPDATE subscriptions SET status = 'expired'
    WHERE status IN ('active', 'trialing', 'past_due') AND expires_at IS NOT NULL AND expires_at < now()
    RETURNING id, business_id, status`;
  for (const s of expired) {
    if (free) await sql`INSERT INTO subscriptions (business_id, plan_id, status, note) VALUES (${s.business_id}, ${free.id}, 'active', 'Süre bitimi')
                        ON CONFLICT DO NOTHING`;
    await notifyBusinessManagers(sql, s.business_id, {
      type: 'billing_expired',
      title: 'Paketinizin süresi doldu',
      body: 'İşletmeniz Ücretsiz pakete geçti. Verileriniz korunuyor; tüm özellikler için paketinizi yenileyebilirsiniz.',
      link: `/panel/${s.business_id}/abonelik`,
      dedupeKey: `expired:${s.id}`,
      channels: { email: true },
    });
  }
  for (const days of [7, 1]) {
    const soon = await sql<{ id: string; business_id: string; expires_at: Date; status: string }[]>`
      SELECT id, business_id, expires_at, status FROM subscriptions
      WHERE status IN ('active', 'trialing') AND expires_at IS NOT NULL
        AND expires_at > now() AND expires_at < now() + make_interval(days => ${days})`;
    for (const s of soon) {
      await notifyBusinessManagers(sql, s.business_id, {
        type: 'billing_expiring',
        title: s.status === 'trialing' ? 'Deneme süreniz bitiyor' : 'Paketinizin süresi bitiyor',
        body: `${s.expires_at.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })} tarihinde sona eriyor. Kesintisiz kullanım için paketinizi yenileyin.`,
        link: `/panel/${s.business_id}/abonelik`,
        dedupeKey: `expiring:${s.id}:${days}`,
        channels: { email: true },
      });
    }
  }
  return { expired: expired.length };
}

export async function ensureNoPendingConflict(businessId: string) {
  const [p] = await sql`SELECT 1 FROM payments WHERE business_id = ${businessId} AND status = 'pending' AND created_at > now() - interval '2 minutes'`;
  if (p) throw conflict('Bir ödeme işlemi az önce başlatıldı. Lütfen birkaç saniye bekleyin.');
}
