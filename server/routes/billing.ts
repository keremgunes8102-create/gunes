import { sql } from '../db.ts';
import { HttpError, badRequest, notFound, readBody, type Router } from '../http.ts';
import { requireAdmin, requireMember, requireUser } from '../auth.ts';
import { rateLimit } from '../security.ts';
import { uuid, z } from '../validation.ts';
import {
  FOUNDING, PERIODS, TRIAL_DAYS, demoPaymentsEnabled, ensureNoPendingConflict, foundingStatus, markFailed, markPaid,
  paytrConfigured, quote, startCheckout, supportWhatsapp, verifyPaytrCallback,
} from '../billing.ts';

export const PAYTR_CALLBACK_PATH = '/api/payments/paytr/callback';

async function publicPlans() {
  return sql<{ code: string; name: string; tagline: string | null; description: string | null; price_amount: string; features: string[]; feature_limits: Record<string, unknown>; is_featured: boolean }[]>`
    SELECT code, name, tagline, description, price_amount::text, features, feature_limits, is_featured FROM plans WHERE is_active ORDER BY sort_order`;
}

export function registerBillingRoutes(r: Router) {
  r.get('/api/plans', async () => {
    const [{ used }] = await sql<{ used: number }[]>`SELECT count(DISTINCT business_id)::int AS used FROM payments WHERE status = 'paid' AND founding`;
    return {
      plans: await publicPlans(),
      trialDays: TRIAL_DAYS,
      periods: PERIODS,
      founding: { price: FOUNDING.price, maxMonths: FOUNDING.maxMonths, slotsLeft: Math.max(0, FOUNDING.slots - used), slots: FOUNDING.slots, planCode: FOUNDING.planCode },
      onlinePayments: paytrConfigured(),
    };
  });

  r.get('/api/panel/:bid/billing', async (ctx) => {
    const m = await requireMember(ctx, uuid.parse(ctx.params.bid), ['owner', 'manager']);
    const [current] = await sql`
      SELECT s.status, s.started_at, s.expires_at, s.monthly_price::text, s.note, p.code, p.name, p.feature_limits
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.business_id = ${m.business_id} AND s.status IN ('active', 'trialing', 'past_due')`;
    const plans = await publicPlans();
    const quotes: Record<string, Record<number, { amount: number; monthly: number; founding: boolean; listAmount: number }>> = {};
    for (const p of plans) {
      if (!(Number(p.price_amount) > 0)) continue;
      quotes[p.code] = {};
      for (const months of PERIODS) {
        try {
          const q = await quote(sql, m.business_id, p.code, months);
          quotes[p.code][months] = { amount: q.amount, monthly: q.monthly, founding: q.founding, listAmount: q.listAmount };
        } catch {
          /* fiyatı hesaplanamayan seçenek gösterilmez */
        }
      }
    }
    const payments = await sql`
      SELECT p.merchant_oid, p.months, p.amount::text, p.status, p.founding, p.provider, p.created_at, p.paid_at, p.failure_reason, pl.name AS plan_name
      FROM payments p JOIN plans pl ON pl.id = p.plan_id WHERE p.business_id = ${m.business_id} ORDER BY p.created_at DESC LIMIT 50`;
    const [emp] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE business_id = ${m.business_id} AND is_active`;
    return {
      current: current ?? null,
      plans,
      quotes,
      periods: PERIODS,
      founding: await foundingStatus(sql, m.business_id),
      payments,
      activeEmployees: emp.n,
      onlinePayments: paytrConfigured(),
      demoPayments: demoPaymentsEnabled(),
      supportWhatsapp: supportWhatsapp() || null,
      canPay: m.role === 'owner' || m.role === 'manager',
    };
  });

  r.post('/api/panel/:bid/billing/checkout', async (ctx) => {
    const user = requireUser(ctx);
    const m = await requireMember(ctx, uuid.parse(ctx.params.bid), ['owner', 'manager']);
    rateLimit(`checkout:${m.business_id}`, 10, 3_600_000);
    const body = await ctx.json(z.object({ plan_code: z.string().min(1).max(30), months: z.number().int() }));
    await quote(sql, m.business_id, body.plan_code, body.months); // geçersiz paket/süre önce reddedilir
    await ensureNoPendingConflict(m.business_id);
    const r2 = await startCheckout({ businessId: m.business_id, planCode: body.plan_code, months: body.months, user, ip: ctx.ip });
    ctx.status = 201;
    return r2;
  });

  /** Yalnızca DEMO_MODE açıkken ve PayTR yapılandırılmamışken: ödeme simülasyonunu tamamlar */
  r.post('/api/panel/:bid/billing/demo-complete', async (ctx) => {
    const m = await requireMember(ctx, uuid.parse(ctx.params.bid), ['owner', 'manager']);
    if (!demoPaymentsEnabled()) throw new HttpError(403, 'forbidden', 'Demo ödeme bu kurulumda kapalı.');
    const { merchant_oid } = await ctx.json(z.object({ merchant_oid: z.string().regex(/^[A-Z0-9]{6,64}$/) }));
    const [p] = await sql`SELECT 1 FROM payments WHERE merchant_oid = ${merchant_oid} AND business_id = ${m.business_id} AND provider = 'demo' AND status = 'pending'`;
    if (!p) throw notFound('Ödeme bulunamadı.');
    return markPaid(merchant_oid, null);
  });

  r.get('/api/panel/:bid/billing/payments/:oid', async (ctx) => {
    const m = await requireMember(ctx, uuid.parse(ctx.params.bid), ['owner', 'manager']);
    const [p] = await sql`SELECT merchant_oid, status, months, amount::text, paid_at, failure_reason FROM payments
                          WHERE merchant_oid = ${ctx.params.oid} AND business_id = ${m.business_id}`;
    if (!p) throw notFound('Ödeme bulunamadı.');
    return p;
  });

  // PayTR bildirim URL'si. PayTR mağaza panelinde "Bildirim URL" olarak bu adres girilmelidir.
  r.post(PAYTR_CALLBACK_PATH, async (ctx) => {
    if (!paytrConfigured()) throw new HttpError(404, 'not_found', 'Bulunamadı.');
    const raw = (await readBody(ctx.req, 20_000)).toString('utf8');
    const f = new URLSearchParams(raw);
    const data = {
      merchant_oid: f.get('merchant_oid') ?? '',
      status: f.get('status') ?? '',
      total_amount: f.get('total_amount') ?? '',
      hash: f.get('hash') ?? '',
    };
    if (!data.merchant_oid || !verifyPaytrCallback(data)) {
      console.error('[PAYTR] geçersiz bildirim imzası');
      throw badRequest('PAYTR notification failed: bad hash');
    }
    if (data.status === 'success') {
      // Tutar doğrulaması: PayTR'nin bildirdiği tutar beklenenden az olmamalı (taksit farkı fazlası olabilir)
      const [p] = await sql<{ amount: string }[]>`SELECT amount::text FROM payments WHERE merchant_oid = ${data.merchant_oid}`;
      if (p && Number(data.total_amount) < Math.round(Number(p.amount) * 100)) {
        await markFailed(data.merchant_oid, `Tutar uyuşmazlığı: ${data.total_amount}`);
      } else {
        await markPaid(data.merchant_oid, data.total_amount);
      }
    } else {
      await markFailed(data.merchant_oid, `${f.get('failed_reason_code') ?? ''} ${f.get('failed_reason_msg') ?? 'Ödeme başarısız'}`.trim());
    }
    ctx.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    ctx.res.end('OK');
    return undefined;
  });

  // --- Yönetici -----------------------------------------------------------
  r.get('/api/admin/payments', async (ctx) => {
    requireAdmin(ctx);
    const rows = await sql`
      SELECT p.merchant_oid, p.months, p.amount::text, p.status, p.founding, p.provider, p.created_at, p.paid_at, p.failure_reason,
             pl.name AS plan_name, b.name AS business_name, b.id AS business_id
      FROM payments p JOIN plans pl ON pl.id = p.plan_id JOIN businesses b ON b.id = p.business_id
      ORDER BY p.created_at DESC LIMIT 300`;
    const [sum] = await sql`
      SELECT COALESCE(sum(amount) FILTER (WHERE status = 'paid' AND paid_at > date_trunc('month', now())), 0)::text AS this_month,
             COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::text AS total,
             count(*) FILTER (WHERE status = 'paid')::int AS paid_count,
             (SELECT COALESCE(sum(monthly_price), 0)::text FROM subscriptions WHERE status = 'active' AND monthly_price > 0) AS mrr,
             (SELECT count(*)::int FROM subscriptions WHERE status = 'active' AND monthly_price > 0) AS paying_businesses,
             (SELECT count(*)::int FROM subscriptions WHERE status = 'trialing') AS trialing_businesses
      FROM payments`;
    return { rows, summary: sum, onlinePayments: paytrConfigured(), demoPayments: demoPaymentsEnabled() };
  });
}
