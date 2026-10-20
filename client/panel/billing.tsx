import { useEffect, useState } from 'react';
import { BoostMeter } from '../components/Media.tsx';
import { Link, useSearchParams } from '../lib/router.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useApi, useDocumentTitle } from '../lib/hooks.ts';
import { Alert, Badge, Button, Card, ErrorState, Modal, PageHeader, Segmented, Spinner, cx, useToast } from '../ui/index.tsx';
import { IconCheck, IconCheckCircle, IconShield } from '../ui/icons.tsx';
import { formatDate, formatDateTime, formatTL } from '../../shared/format.ts';
import { usePanel, RequireManager } from './context.tsx';

interface Billing {
  current: { status: string; started_at: string; expires_at: string | null; monthly_price: string | null; code: string; name: string; feature_limits: Record<string, number> } | null;
  plans: { code: string; name: string; tagline: string | null; price_amount: string; features: string[]; is_featured: boolean; feature_limits: Record<string, number> }[];
  quotes: Record<string, Record<number, { amount: number; monthly: number; founding: boolean; listAmount: number }>>;
  periods: number[];
  founding: { eligible: boolean; monthsLeft: number; slotsLeft: number; price: number; maxMonths: number };
  payments: { merchant_oid: string; months: number; amount: string; status: string; founding: boolean; provider: string; created_at: string; paid_at: string | null; failure_reason: string | null; plan_name: string }[];
  activeEmployees: number;
  onlinePayments: boolean;
  demoPayments: boolean;
  supportWhatsapp: string | null;
}

const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null);
const PERIOD_LABEL: Record<number, string> = { 1: '1 ay', 3: '3 ay', 6: '6 ay', 12: '12 ay' };

/** Panelin üstünde: deneme bitiyor / ücretsiz pakette uyarısı */
export function PlanBanner() {
  const { detail, base, isManager } = usePanel();
  const p = detail.plan as { code: string; name: string; status?: string; expires_at?: string | null };
  if (!isManager || detail.business.is_demo) return null;
  const left = daysLeft(p.expires_at ?? null);
  if (p.status === 'trialing' && left !== null && left <= 7) {
    return (
      <div style={{ marginBottom: 20 }}>
        <Alert tone="warning" title={left === 0 ? 'Deneme süreniz bugün bitiyor' : `Deneme sürenizin bitmesine ${left} gün kaldı`}>
          Kesintisiz kullanım için paketinizi seçin. <Link to={`${base}/abonelik`} style={{ fontWeight: 600 }}>Paketleri gör →</Link>
        </Alert>
      </div>
    );
  }
  if (p.status === 'active' && left !== null && left <= 5) {
    return (
      <div style={{ marginBottom: 20 }}>
        <Alert tone="warning" title={`${p.name} paketinizin bitmesine ${left} gün kaldı`}>
          <Link to={`${base}/abonelik`} style={{ fontWeight: 600 }}>Süreyi uzat →</Link>
        </Alert>
      </div>
    );
  }
  return null;
}

function CheckoutModal({ planCode, planName, months, amount, onClose, onDone }: { planCode: string; planName: string; months: number; amount: number; onClose: () => void; onDone: () => void }) {
  const { bid } = usePanel();
  const [state, setState] = useState<'confirm' | 'redirecting' | 'demo' | 'error'>('confirm');
  const [oid, setOid] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const plan = planName;
  const start = async (planCode: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ provider: string; merchantOid: string; iframeUrl?: string }>(`/api/panel/${bid}/billing/checkout`, { plan_code: planCode, months });
      setOid(r.merchantOid);
      if (r.provider === 'paytr' && r.iframeUrl) {
        setState('redirecting');
        window.location.href = r.iframeUrl; // PayTR güvenli ödeme sayfası
      } else {
        setState('demo');
      }
    } catch (e) {
      setErr((e as ApiError).message);
      setState('error');
    } finally {
      setBusy(false);
    }
  };
  const completeDemo = async () => {
    setBusy(true);
    try {
      await api.post(`/api/panel/${bid}/billing/demo-complete`, { merchant_oid: oid });
      toast('Demo ödeme tamamlandı; paket açıldı.');
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={state === 'demo' ? 'Demo ödeme ekranı' : 'Ödemeyi onayla'} size="sm"
      footer={
        state === 'confirm' || state === 'error' ? (
          <>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button busy={busy} onClick={() => start(planCode)}>{formatTL(amount)} öde</Button>
          </>
        ) : state === 'demo' ? (
          <>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button busy={busy} onClick={completeDemo}>Ödemeyi tamamla (simülasyon)</Button>
          </>
        ) : undefined
      }
    >
      <div className="stack">
        <div className="billing-summary">
          <div className="summary-row"><span>Paket</span><span>{plan}</span></div>
          <div className="summary-row"><span>Süre</span><span>{PERIOD_LABEL[months]}</span></div>
          <div className="summary-total"><span>Toplam (KDV dahil)</span><span className="mono">{formatTL(amount)}</span></div>
        </div>
        {state === 'confirm' && (
          <p className="small muted" style={{ margin: 0 }}>
            <IconShield size={14} style={{ verticalAlign: -2 }} /> PayTR güvenli ödeme sayfasına yönlendirileceksiniz. Tek çekim; abonelik otomatik yenilenmez. Devam ederek <Link to="/mesafeli-satis-sozlesmesi" target="_blank">mesafeli hizmet sözleşmesini</Link> ve <Link to="/iptal-iade" target="_blank">iptal-iade koşullarını</Link> kabul etmiş olursunuz.
          </p>
        )}
        {state === 'redirecting' && <div className="row"><span className="spinner" /> <span>PayTR ödeme sayfası açılıyor…</span></div>}
        {state === 'demo' && <Alert tone="warning" title="Bu bir demo kurulum">Online ödeme henüz bağlanmadığı için gerçek kart çekimi yapılmaz. Aşağıdaki düğme, başarılı bir PayTR ödemesinden sonra olacakları gösterir.</Alert>}
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  );
}

function PaymentReturn({ oid, onSettled }: { oid: string; onSettled: () => void }) {
  const { bid } = usePanel();
  const [status, setStatus] = useState<'pending' | 'paid' | 'failed' | 'timeout'>('pending');
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => {
    let n = 0;
    let stop = false;
    const tick = async () => {
      try {
        const p = await api.get<{ status: string; failure_reason: string | null }>(`/api/panel/${bid}/billing/payments/${oid}`);
        if (p.status === 'paid') { setStatus('paid'); onSettled(); return; }
        if (p.status === 'failed') { setStatus('failed'); setReason(p.failure_reason); return; }
      } catch { /* tekrar dene */ }
      if (++n > 20) { setStatus('timeout'); return; }
      if (!stop) setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; };
  }, [bid, oid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (status === 'pending') return <Alert tone="info" title="Ödemeniz kontrol ediliyor">PayTR’den onay bekleniyor, bu birkaç saniye sürebilir…</Alert>;
  if (status === 'paid') return <Alert tone="success" title="Ödemeniz alındı">Paketiniz açıldı. Teşekkürler!</Alert>;
  if (status === 'failed') return <Alert tone="error" title="Ödeme tamamlanamadı">{reason ?? 'Kartınızdan ücret çekilmedi. Tekrar deneyebilirsiniz.'}</Alert>;
  return <Alert tone="warning" title="Onay henüz gelmedi">Kartınızdan ücret çekildiyse paketiniz birkaç dakika içinde kendiliğinden açılır. Sayfayı daha sonra yenileyin.</Alert>;
}

export function BillingPage() {
  const { bid, detail, reload: reloadPanel } = usePanel();
  useDocumentTitle('Paket ve abonelik');
  const { data, loading, error, reload } = useApi<Billing>(`/api/panel/${bid}/billing`);
  const [params, setParams] = useSearchParams();
  const [months, setMonths] = useState<number>(1);
  const [checkout, setCheckout] = useState<{ code: string; name: string; amount: number } | null>(null);
  const returnOid = params.get('oid');
  useEffect(() => {
    if (data?.founding.eligible && months > data.founding.monthsLeft) setMonths(1);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const cur = data.current;
  const left = daysLeft(cur?.expires_at ?? null);
  const settled = () => { reload(); reloadPanel(); };
  const paidPlans = data.plans.filter((p) => Number(p.price_amount) > 0);
  const empLimit = Number(cur?.feature_limits.max_employees ?? 2);
  const canPayOnline = data.onlinePayments || data.demoPayments;
  const wa = data.supportWhatsapp ? `https://wa.me/${data.supportWhatsapp}?text=${encodeURIComponent(`Merhaba, KOLTUK'ta ${detail.business.name} işletmem için paket almak istiyorum.`)}` : null;

  return (
    <RequireManager>
      <div className="stack-lg">
        <PageHeader title="Paket ve abonelik" description="Paketinizi seçin, PayTR ile güvenle ödeyin; paket anında açılır." />
        {returnOid && <div className="stack-sm"><PaymentReturn oid={returnOid} onSettled={settled} /><div><Button variant="ghost" size="sm" onClick={() => setParams({ oid: null, odeme: null })}>Kapat</Button></div></div>}
        {data.demoPayments && <Alert tone="info" title="Demo kurulum">Online ödeme (PayTR) bu kurulumda henüz bağlı değil. Ödeme akışını simülasyonla deneyebilirsiniz; gerçek çekim yapılmaz.</Alert>}

        <Card className="billing-current">
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <div>
              <span className="muted small">Mevcut paket</span>
              <h2 style={{ margin: '2px 0 6px' }}>{cur?.name ?? 'Ücretsiz'}</h2>
              <div className="row" style={{ gap: 8 }}>
                {cur?.status === 'trialing' ? <Badge tone="amber">Deneme</Badge> : <Badge tone="green">Aktif</Badge>}
                {cur?.expires_at && <span className="small muted">{cur.status === 'trialing' ? 'Deneme bitişi' : 'Bitiş'}: <strong>{formatDate(cur.expires_at, undefined, { weekday: undefined })}</strong> ({left} gün)</span>}
                {!cur?.expires_at && <span className="small muted">Süresiz</span>}
              </div>
            </div>
            <div className="billing-usage">
              <span className="small muted">Aktif çalışan</span>
              <strong className="mono">{data.activeEmployees} / {empLimit}</strong>
              <div className="bar"><span style={{ width: `${Math.min(100, (data.activeEmployees / empLimit) * 100)}%` }} /></div>
            </div>
          </div>
          {cur?.status === 'trialing' && <p className="small muted" style={{ marginBottom: 0, marginTop: 14 }}>Deneme bitince paket almazsanız işletmeniz Ücretsiz pakete geçer (en fazla 2 çalışan). Verileriniz silinmez.</p>}
        </Card>

        {data.founding.eligible && (
          <div className="fb-founding">
            <div>
              <strong>Kurucu işletme fırsatı sizin için geçerli</strong>
              <span>Profesyonel paket aylık <b>{formatTL(data.founding.price)}</b> (normali {formatTL(1000)}). Bu fiyattan en fazla {data.founding.monthsLeft} ay daha alabilirsiniz.</span>
            </div>
          </div>
        )}

        <div className="row-between">
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Paket seçin</h2>
          <Segmented label="Süre" value={String(months)} onChange={(v) => setMonths(Number(v))} options={data.periods.map((m) => ({ value: String(m), label: m === 12 ? '12 ay · 2 ay hediye' : PERIOD_LABEL[m] }))} />
        </div>

        <div className="fb-plans compact">
          {paidPlans.map((p) => {
            const q = data.quotes[p.code]?.[months];
            const isCurrent = cur?.code === p.code && cur.status === 'active';
            return (
              <article key={p.code} className={cx('fb-plan', p.is_featured && 'featured')}>
                {q?.founding && <span className="fb-plan-flag">Kurucu fiyatı</span>}
                {!q?.founding && p.is_featured && <span className="fb-plan-flag">Önerilen</span>}
                <header><h3>{p.name}</h3><p>{p.tagline}</p></header>
                {q ? (
                  <>
                    <div className="fb-plan-price">
                      <strong className="mono">{formatTL(q.amount)}</strong>
                      <span>/ {PERIOD_LABEL[months]}</span>
                    </div>
                    <p className="fb-plan-note">
                      {q.listAmount > q.amount ? <><s>{formatTL(q.listAmount)}</s> · aylık {formatTL(Math.round(q.amount / months))}</> : `aylık ${formatTL(q.monthly)}`}
                    </p>
                  </>
                ) : <p className="muted small">Bu süre için uygun değil.</p>}
                <BoostMeter level={Number(p.feature_limits?.boost ?? 0)} />
                <ul>{p.features.map((f) => <li key={f}><IconCheck size={16} /> {f}</li>)}</ul>
                {canPayOnline && q ? (
                  <Button block variant={p.is_featured ? 'primary' : 'secondary'} onClick={() => setCheckout({ code: p.code, name: p.name, amount: q.amount })}>
                    {isCurrent ? 'Süreyi uzat' : `${p.name} paketine geç`}
                  </Button>
                ) : wa ? (
                  <a className="btn btn-secondary btn-md btn-block" href={wa} target="_blank" rel="noreferrer"><span className="btn-label">WhatsApp ile satın al</span></a>
                ) : <Button block disabled>Online ödeme yakında</Button>}
              </article>
            );
          })}
        </div>
        <p className="fb-secure"><IconShield size={16} /> Ödemeler PayTR altyapısıyla alınır; kart bilgileriniz KOLTUK’ta saklanmaz. Fiyatlara KDV dahildir. <Link to="/iptal-iade">İptal ve iade</Link> · <Link to="/mesafeli-satis-sozlesmesi">Sözleşme</Link></p>

        <Card>
          <h2 className="card-title">Ödeme geçmişi</h2>
          {!data.payments.length ? <p className="muted small" style={{ margin: 0 }}>Henüz ödeme yok.</p> : (
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="table">
                <thead><tr><th>Tarih</th><th>Paket</th><th>Süre</th><th>Tutar</th><th>Durum</th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.merchant_oid}>
                      <td className="small nowrap">{formatDateTime(p.created_at)}</td>
                      <td className="small">{p.plan_name}{p.founding && <> <Badge tone="beige">Kurucu</Badge></>}{p.provider === 'demo' && <> <Badge>Demo</Badge></>}</td>
                      <td className="small">{PERIOD_LABEL[p.months]}</td>
                      <td className="small mono">{formatTL(p.amount)}</td>
                      <td>{p.status === 'paid' ? <Badge tone="green"><IconCheckCircle size={13} /> Ödendi</Badge> : p.status === 'pending' ? <Badge tone="amber">Bekliyor</Badge> : <Badge tone="red" >Başarısız</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {checkout && <CheckoutModal planCode={checkout.code} planName={checkout.name} months={months} amount={checkout.amount} onClose={() => setCheckout(null)} onDone={() => { setCheckout(null); settled(); }} />}
      </div>
    </RequireManager>
  );
}
