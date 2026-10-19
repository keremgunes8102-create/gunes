import { useState } from 'react';
import { Redirect, navigate, useSearchParams } from '../lib/router.tsx';
import { api } from '../lib/api.ts';
import { useApi, useDocumentTitle, useSubmit } from '../lib/hooks.ts';
import { useAuth } from '../lib/auth.tsx';
import { Alert, Button, ButtonLink, Card, PageHeader, cx, useToast } from '../ui/index.tsx';
import { BusinessVisual, VerificationBadge } from '../ui/brand.tsx';
import { IconCheck, IconCheckCircle, IconX } from '../ui/icons.tsx';
import { AddressForm, BusinessInfoFields, ClosuresManager, EmployeesManager, HoursForm, InfoForm, ServicesManager, SettingsForm, StationsManager } from './forms.tsx';
import { usePanel } from './context.tsx';
import { BUSINESS_TYPE_LABEL, type BusinessType } from '../../shared/constants.ts';

export const STEPS = [
  'Hesap',
  'İşletme bilgileri',
  'Adres',
  'Çalışma saatleri',
  'Koltuk ve istasyonlar',
  'Çalışanlar',
  'Hizmetler',
  'Randevu tercihleri',
  'Önizleme ve başvuru',
];

/** Adım 2: işletmeyi oluştur (henüz işletmesi olmayan kullanıcı) */
export function NewBusiness() {
  useDocumentTitle('İşletme oluştur');
  const { user, loading, refresh } = useAuth();
  const { data: meta } = useApi<{ categories: { id: string; name: string; business_type: string }[] }>('/api/meta');
  const [f, setF] = useState({ name: '', business_type: 'barber', description: '', phone: user?.phone ?? '', email: '', website: '', instagram: '', category_ids: [] as string[] });
  const s = useSubmit(async () => {
    const r = await api.post<{ id: string }>('/api/panel/businesses', f);
    await refresh();
    navigate(`/panel/${r.id}/kurulum?adim=3`);
  });
  if (loading) return null;
  if (!user) return <Redirect to="/isletme-kayit" />;
  return (
    <div className="container section-sm">
      <div className="wizard">
        <WizardSteps current={2} maxReached={2} onGo={() => {}} />
        <div>
          <PageHeader title="İşletme bilgileri" description="Adım 2 / 9 — Müşterilerin göreceği temel bilgiler." />
          <Card>
            <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }} noValidate>
              <BusinessInfoFields f={f} setF={setF} fields={s.fields} categories={meta?.categories ?? []} />
              {s.error && !Object.keys(s.fields).length && <Alert tone="error">{s.error}</Alert>}
              <div className="form-actions"><Button type="submit" busy={s.busy} size="lg">Kaydet ve devam et</Button></div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

function WizardSteps({ current, maxReached, onGo }: { current: number; maxReached: number; onGo: (n: number) => void }) {
  return (
    <ol className="wizard-steps" aria-label="Kurulum adımları">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current || n === 1 || (n <= maxReached && n !== current);
        return (
          <li key={label} className={cx(n === current && 'current', done && 'done')}>
            <button type="button" disabled={n === 1 || n > maxReached} onClick={() => onGo(n)} aria-current={n === current ? 'step' : undefined}>
              <span className="ws-num">{done && n !== current ? <IconCheck size={14} /> : n}</span>
              <span className="ws-label">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function SetupWizard() {
  const { bid, detail, base, reload, isOwner } = usePanel();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const maxReached = Math.max(detail.business.setup_step, 3);
  const step = Math.min(Math.max(Number(params.get('adim') ?? maxReached), 2), 9);
  useDocumentTitle(`Kurulum — ${STEPS[step - 1]}`);
  const go = async (n: number) => {
    if (n > detail.business.setup_step) {
      await api.patch(`/api/panel/${bid}/setup-step`, { step: n });
      await reload();
    }
    setParams({ adim: String(n) }, false);
    window.scrollTo({ top: 0 });
  };
  const next = () => go(step + 1);
  const submit = useSubmit(async () => {
    await api.post(`/api/panel/${bid}/submit`);
    await reload();
    toast('Başvurunuz gönderildi. İnceleme sonrası bilgilendirileceksiniz.');
    navigate(base);
  });
  const b = detail.business;
  const nav = (
    <div className="form-actions" style={{ justifyContent: 'space-between' }}>
      <Button variant="ghost" onClick={() => go(step - 1)} disabled={step <= 2}>← Geri</Button>
      {step < 9 && <Button onClick={next}>Devam et →</Button>}
    </div>
  );
  return (
    <div className="wizard">
      <WizardSteps current={step} maxReached={Math.max(maxReached, step)} onGo={go} />
      <div className="stack">
        <PageHeader title={STEPS[step - 1]} description={`Adım ${step} / 9`} />
        {step === 2 && <Card><InfoForm submitLabel="Kaydet ve devam et" onSaved={next} /></Card>}
        {step === 3 && <Card><AddressForm submitLabel="Kaydet ve devam et" onSaved={next} /></Card>}
        {step === 4 && (
          <>
            <Card><HoursForm submitLabel="Kaydet ve devam et" onSaved={next} /></Card>
            <Card><h2 className="card-title">Özel tatil ve kapalı günler</h2><ClosuresManager /></Card>
          </>
        )}
        {step === 5 && <><StationsManager />{nav}</>}
        {step === 6 && <><EmployeesManager />{nav}</>}
        {step === 7 && <><ServicesManager />{nav}</>}
        {step === 8 && <SettingsForm submitLabel="Kaydet ve devam et" onSaved={next} />}
        {step === 9 && (
          <div className="stack">
            <Card>
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <div className="upload-preview"><BusinessVisual name={b.name} type={b.business_type} url={b.logo_url} /></div>
                <div>
                  <h2 style={{ marginBottom: 4 }}>{b.name}</h2>
                  <div className="muted small">{BUSINESS_TYPE_LABEL[b.business_type as BusinessType]} · {[b.district, b.city].filter(Boolean).join(', ')}</div>
                  <div style={{ marginTop: 8 }}><VerificationBadge status={b.verification_status} /></div>
                </div>
              </div>
            </Card>
            <Card>
              <h3 className="card-title">Kontrol listesi</h3>
              <ul className="checklist">
                {detail.checklist.items.map((i) => (
                  <li key={i.key} className={i.done ? 'ok' : 'missing'}>{i.done ? <IconCheckCircle size={18} /> : <IconX size={18} />} {i.label}</li>
                ))}
              </ul>
              <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
                {detail.counts.services} hizmet · {detail.counts.employees} çalışan · {detail.counts.stations} istasyon
              </p>
            </Card>
            {b.verification_status === 'approved' ? (
              <Alert tone="success" title="İşletmeniz yayında">Profiliniz onaylı. Değişiklikleriniz anında yansır.</Alert>
            ) : b.verification_status === 'pending_review' ? (
              <Alert tone="info" title="Başvurunuz inceleniyor">Onaylandığında bildirim alacaksınız.</Alert>
            ) : (
              <>
                <Alert tone="info">Başvurunuz platform ekibi tarafından incelenir. Onaylanana kadar işletmeniz aramalarda doğrulanmış olarak görünmez ve online randevu alamaz.</Alert>
                {submit.error && <Alert tone="error">{submit.error}</Alert>}
                {!isOwner && <Alert tone="warning">Başvuruyu yalnızca işletme sahibi gönderebilir.</Alert>}
                <Button size="lg" busy={submit.busy} disabled={!detail.checklist.complete || !isOwner} onClick={() => submit.run()}>Başvuruyu gönder</Button>
              </>
            )}
            <ButtonLink to={base} variant="ghost">Panele dön</ButtonLink>
          </div>
        )}
      </div>
    </div>
  );
}
