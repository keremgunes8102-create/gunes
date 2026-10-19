import { createContext, useContext, type ReactNode } from 'react';
import { Link, useLocation } from '../lib/router.tsx';
import { useApi } from '../lib/hooks.ts';
import { useAuth } from '../lib/auth.tsx';
import { Alert, ButtonLink, ErrorState, Spinner } from '../ui/index.tsx';
import { VerificationBadge } from '../ui/brand.tsx';
import {
  IconBell, IconCalendar, IconCard, IconChair, IconChart, IconClock, IconGrid, IconList, IconMessage, IconSettings, IconStore, IconTag, IconUser, IconUsers,
} from '../ui/icons.tsx';
import { MEMBER_ROLE_LABEL } from '../../shared/constants.ts';

export interface PanelDetail {
  business: Record<string, any> & {
    id: string; name: string; slug: string; business_type: string; timezone: string; verification_status: string; verification_note: string | null;
    setup_step: number; publication_status: string; is_demo: boolean;
  };
  category_ids: string[];
  hours: { weekday: number; start: string; end: string }[];
  counts: { employees: number; services: number; stations: number; bookable_employees: number };
  membership: { role: 'owner' | 'manager' | 'staff'; employee_id: string | null; business_id: string };
  plan: { code: string; name: string; feature_limits: Record<string, unknown> };
  checklist: { items: { key: string; label: string; done: boolean }[]; complete: boolean };
}

interface PanelCtx {
  bid: string;
  detail: PanelDetail;
  reload: () => Promise<void>;
  isManager: boolean;
  isOwner: boolean;
  base: string;
}
const Ctx = createContext<PanelCtx>(null as unknown as PanelCtx);
export const usePanel = () => useContext(Ctx);

const NAV = [
  { seg: '', label: 'Genel bakış', icon: IconGrid, staff: true },
  { seg: 'takvim', label: 'Takvim', icon: IconCalendar, staff: true },
  { seg: 'randevular', label: 'Randevular', icon: IconList, staff: true },
  { seg: 'musteriler', label: 'Müşteriler', icon: IconUser, staff: false },
  { section: 'İşletme' },
  { seg: 'calisanlar', label: 'Çalışanlar', icon: IconUsers, staff: false },
  { seg: 'istasyonlar', label: 'Koltuklar ve istasyonlar', icon: IconChair, staff: false },
  { seg: 'hizmetler', label: 'Hizmetler ve fiyatlar', icon: IconTag, staff: false },
  { seg: 'saatler', label: 'Çalışma saatleri', icon: IconClock, staff: false },
  { seg: 'profil', label: 'İşletme profili', icon: IconStore, staff: false },
  { seg: 'yorumlar', label: 'Yorumlar', icon: IconMessage, staff: true },
  { seg: 'raporlar', label: 'Raporlar', icon: IconChart, staff: false },
  { section: 'Hesap' },
  { seg: 'bildirimler', label: 'Bildirimler', icon: IconBell, staff: true },
  { seg: 'ekip', label: 'Ekip ve yetkiler', icon: IconUsers, staff: false },
  { seg: 'abonelik', label: 'Paket ve abonelik', icon: IconCard, staff: false },
  { seg: 'ayarlar', label: 'Randevu ayarları', icon: IconSettings, staff: false },
] as const;

export function PanelShell({ bid, children }: { bid: string; children: ReactNode }) {
  const { data, loading, error, reload } = useApi<PanelDetail>(`/api/panel/${bid}`);
  const { path } = useLocation();
  const { memberships } = useAuth();
  if (loading && !data) return <Spinner />;
  if (error || !data) return <div className="container section"><ErrorState error={error} onRetry={reload} /></div>;
  const role = data.membership.role;
  const isManager = role !== 'staff';
  const base = `/panel/${bid}`;
  const items = NAV.filter((n) => 'section' in n || isManager || n.staff);
  const currentSeg = path.slice(base.length).split('/')[1] ?? '';
  const b = data.business;
  const setupIncomplete = isManager && (b.verification_status === 'draft' || b.verification_status === 'rejected');
  return (
    <Ctx.Provider value={{ bid, detail: data, reload, isManager, isOwner: role === 'owner', base }}>
      <div className="app-shell">
        <aside className="sidebar" aria-label="İşletme paneli menüsü">
          <div className="sidebar-biz">
            <strong className="ellipsis" style={{ display: 'block' }}>{b.name}</strong>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <VerificationBadge status={b.verification_status} />
              <span className="muted xsmall">{MEMBER_ROLE_LABEL[role]}</span>
            </div>
            {memberships.length > 1 && (
              <select className="input select" style={{ marginTop: 10, minHeight: 36, padding: '6px 32px 6px 10px', fontSize: '0.85rem' }} value={bid} onChange={(e) => (location.href = `/panel/${e.target.value}`)} aria-label="İşletme değiştir">
                {memberships.map((m) => <option key={m.business_id} value={m.business_id}>{m.name}</option>)}
              </select>
            )}
          </div>
          <nav>
            {items.map((n, i) =>
              'section' in n ? (
                <div key={i} className="sidebar-section">{n.section}</div>
              ) : (
                <Link key={n.seg} to={n.seg ? `${base}/${n.seg}` : base} aria-current={currentSeg === n.seg ? 'page' : undefined}>
                  <n.icon size={18} /> {n.label}
                </Link>
              ),
            )}
          </nav>
          {b.verification_status === 'approved' && (
            <div style={{ padding: '16px 12px' }}>
              <Link to={`/isletme/${b.slug}`} className="small" style={{ color: 'var(--green)', fontWeight: 600 }}>Herkese açık sayfayı gör →</Link>
            </div>
          )}
        </aside>
        <div style={{ minWidth: 0 }}>
          <nav className="mobile-subnav" aria-label="Panel bölümleri">
            {items.filter((n) => !('section' in n)).map((n) => {
              const it = n as { seg: string; label: string };
              return (
                <Link key={it.seg} to={it.seg ? `${base}/${it.seg}` : base} aria-current={currentSeg === it.seg ? 'page' : undefined}>{it.label}</Link>
              );
            })}
          </nav>
          <main className="app-main">
            {setupIncomplete && currentSeg !== 'kurulum' && (
              <div style={{ marginBottom: 20 }}>
                <Alert tone={b.verification_status === 'rejected' ? 'error' : 'warning'} title={b.verification_status === 'rejected' ? 'Başvurunuz reddedildi' : 'Kurulumu tamamlayın'}>
                  {b.verification_note && <p style={{ margin: '4px 0' }}>Yönetici notu: {b.verification_note}</p>}
                  <p style={{ margin: '4px 0 10px' }}>İşletmeniz yönetici onayından sonra aramalarda görünür ve online randevu alabilir.</p>
                  <ButtonLink to={`${base}/kurulum`} size="sm">Kuruluma devam et</ButtonLink>
                </Alert>
              </div>
            )}
            {b.verification_status === 'pending_review' && currentSeg === '' && (
              <div style={{ marginBottom: 20 }}><Alert tone="info" title="Başvurunuz inceleniyor">Onaylandığında bildirim alacaksınız. Bu sürede hizmet, çalışan ve saatlerinizi düzenlemeye devam edebilirsiniz.</Alert></div>
            )}
            {b.verification_status === 'suspended' && (
              <div style={{ marginBottom: 20 }}><Alert tone="error" title="İşletmeniz askıya alındı">{b.verification_note}</Alert></div>
            )}
            {children}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function RequireManager({ children }: { children: ReactNode }) {
  const { isManager } = usePanel();
  if (!isManager) return <Alert tone="warning">Bu bölüm yalnızca işletme sahibi ve yöneticilere açıktır.</Alert>;
  return <>{children}</>;
}
