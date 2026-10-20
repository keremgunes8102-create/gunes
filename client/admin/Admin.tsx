import { useState, type ReactNode } from 'react';
import { Link, useLocation } from '../lib/router.tsx';
import { api, qs } from '../lib/api.ts';
import { useApi, useDocumentTitle, useSubmit } from '../lib/hooks.ts';
import { useAuth } from '../lib/auth.tsx';
import { VerificationBadge } from '../ui/brand.tsx';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, Select, Spinner, Stat, Switch, Tabs, TextArea, TextInput, useConfirm, useToast } from '../ui/index.tsx';
import { IconFlag, IconGrid, IconList, IconLock, IconMessage, IconStore, IconTag, IconUsers, IconCard } from '../ui/icons.tsx';
import { BUSINESS_TYPE_LABEL, BUSINESS_TYPES, VERIFICATION_STATUS_LABEL, WEEKDAYS, type BusinessType } from '../../shared/constants.ts';
import { formatDate, formatDateTime, formatPrice, formatTL } from '../../shared/format.ts';

const NAV = [
  { to: '/yonetim', label: 'Genel bakış', icon: IconGrid },
  { to: '/yonetim/basvurular', label: 'İşletmeler', icon: IconStore },
  { to: '/yonetim/kullanicilar', label: 'Kullanıcılar', icon: IconUsers },
  { to: '/yonetim/moderasyon', label: 'Yorum ve şikâyetler', icon: IconFlag },
  { to: '/yonetim/kategoriler', label: 'Kategoriler', icon: IconTag },
  { to: '/yonetim/odemeler', label: 'Ödemeler ve gelir', icon: IconCard },
  { to: '/yonetim/paketler', label: 'Paketler', icon: IconTag },
  { to: '/yonetim/kvkk', label: 'KVKK başvuruları', icon: IconLock },
  { to: '/yonetim/mesajlar', label: 'Bildirim servisleri', icon: IconMessage },
  { to: '/yonetim/kayitlar', label: 'İşlem kayıtları', icon: IconList },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { path } = useLocation();
  if (!user || user.platform_role !== 'admin') {
    return <div className="container section"><EmptyState icon={<IconLock />} title="Yetkisiz erişim">Bu sayfa yalnızca platform yöneticilerine açıktır.</EmptyState></div>;
  }
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Yönetim menüsü">
        <div className="sidebar-biz"><strong>Platform yönetimi</strong><div className="muted xsmall">{user.email}</div></div>
        <nav>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={path === n.to ? 'page' : undefined}><n.icon size={18} /> {n.label}</Link>
          ))}
        </nav>
      </aside>
      <div style={{ minWidth: 0 }}>
        <nav className="mobile-subnav" aria-label="Yönetim bölümleri">{NAV.map((n) => <Link key={n.to} to={n.to} aria-current={path === n.to ? 'page' : undefined}>{n.label}</Link>)}</nav>
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  useDocumentTitle('Platform yönetimi');
  const { data, loading, error, reload } = useApi<{ stats: Record<string, number>; daily: { day: string; n: number }[]; integrations: Record<string, { configured: boolean; provider?: string; note?: string }> }>('/api/admin/stats');
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const s = data.stats;
  const max = Math.max(1, ...data.daily.map((d) => d.n));
  const INTEG: Record<string, string> = { email: 'E-posta', sms: 'SMS', payments: 'Ödeme', maps: 'Harita' };
  return (
    <div className="stack-lg">
      <PageHeader title="Genel bakış" />
      {s.businesses_pending > 0 && <Alert tone="warning" title={`${s.businesses_pending} işletme başvurusu inceleme bekliyor`}><Link to="/yonetim/basvurular?durum=pending_review" style={{ fontWeight: 600 }}>Başvuruları incele →</Link></Alert>}
      <div className="stats-grid">
        <Stat label="Kullanıcı" value={s.users} hint={`Son 30 gün: +${s.users_30d}`} />
        <Stat label="Onaylı işletme" value={s.businesses_approved} hint={`${s.businesses_demo} demo`} />
        <Stat label="Randevu (30 gün)" value={s.appointments_30d} />
        <Stat label="Tamamlanan (30 gün)" value={s.completed_30d} />
        <Stat label="İptal (30 gün)" value={s.cancelled_30d} />
        <Stat label="Açık şikâyet" value={s.open_reports} />
        <Stat label="Açık KVKK başvurusu" value={s.open_data_requests} />
      </div>
      <Card>
        <h2 className="card-title">Günlük oluşturulan randevular (30 gün)</h2>
        <div className="bar-chart">{data.daily.map((d) => <div key={d.day} className="b" style={{ height: `${(d.n / max) * 100}%` }} title={`${d.day}: ${d.n}`} />)}</div>
      </Card>
      <Card>
        <h2 className="card-title">Entegrasyon durumu</h2>
        {Object.entries(data.integrations).map(([k, v]) => (
          <div key={k} className="summary-row"><span>{INTEG[k] ?? k}</span><span>{v.configured ? <Badge tone="green">Yapılandırıldı ({v.provider})</Badge> : <Badge tone="amber">Yapılandırılmadı</Badge>}</span></div>
        ))}
        <p className="muted xsmall" style={{ marginBottom: 0, marginTop: 8 }}>Yapılandırma için README'deki ortam değişkenlerine bakın.</p>
      </Card>
    </div>
  );
}

function BusinessReview({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useApi<{ business: Record<string, any>; services: { name: string; duration_minutes: number; price_type: string; price_amount: string | null; price_max_amount: string | null; is_active: boolean }[]; employees: { display_name: string; title: string | null; is_active: boolean }[]; stations: { name: string; capacity: number }[]; hours: { weekday: number; start: string; end: string }[]; history: { action: string; metadata: { note?: string }; created_at: string; actor: string }[] }>(`/api/admin/businesses/${id}`);
  const [note, setNote] = useState('');
  const [plan, setPlan] = useState('pro');
  const toast = useToast();
  const decide = useSubmit(async (decision: string) => {
    await api.post(`/api/admin/businesses/${id}/decision`, { decision, note: note || null });
    toast('Karar kaydedildi; işletme bilgilendirildi.');
    setNote('');
    reload();
    onChanged();
  });
  return (
    <Modal size="lg" open onClose={onClose} title={data?.business.name ?? 'İşletme'}>
      {loading || !data ? <Spinner /> : (
        <div className="stack">
          <div className="row"><VerificationBadge status={data.business.verification_status} />{data.business.is_demo && <Badge tone="amber">Demo</Badge>}<Badge tone="beige">{BUSINESS_TYPE_LABEL[data.business.business_type as BusinessType]}</Badge></div>
          <div className="grid-2">
            <div>
              <div className="summary-row"><span>Sahip</span><span>{data.business.owner_name}</span></div>
              <div className="summary-row"><span>E-posta</span><span>{data.business.owner_email} {data.business.owner_email_verified ? '✓' : '(doğrulanmamış)'}</span></div>
              <div className="summary-row"><span>Telefon</span><span>{data.business.phone}</span></div>
              <div className="summary-row"><span>Adres</span><span>{[data.business.address, data.business.neighborhood, data.business.district, data.business.city].filter(Boolean).join(', ')}</span></div>
              <div className="summary-row"><span>Konum</span><span>{data.business.latitude ? `${data.business.latitude}, ${data.business.longitude}` : 'Girilmemiş'}</span></div>
            </div>
            <div>
              <div className="summary-row"><span>Başvuru</span><span>{data.business.submitted_at ? formatDateTime(data.business.submitted_at) : '—'}</span></div>
              <div className="summary-row"><span>Hizmet / çalışan</span><span>{data.services.length} / {data.employees.length}</span></div>
              <div className="summary-row"><span>Saatler</span><span className="small">{WEEKDAYS.map((d, i) => { const r = data.hours.filter((h) => h.weekday === i); return r.length ? `${d.slice(0, 3)} ${r.map((x) => `${x.start}-${x.end}`).join(',')}` : null; }).filter(Boolean).join(' · ') || '—'}</span></div>
              {data.business.website && <div className="summary-row"><span>Web</span><span><a href={data.business.website} target="_blank" rel="noreferrer nofollow">{data.business.website}</a></span></div>}
            </div>
          </div>
          {data.business.description && <p className="small muted">{data.business.description}</p>}
          <details><summary className="small" style={{ cursor: 'pointer' }}>Hizmetler ({data.services.length})</summary><ul className="small">{data.services.map((s) => <li key={s.name}>{s.name} — {formatPrice(s)} · {s.duration_minutes} dk</li>)}</ul></details>
          <Switch label="Konum doğrulandı" checked={Boolean(data.business.location_verified)} onChange={async (v) => { await api.post(`/api/admin/businesses/${id}/location-verified`, { verified: v }); reload(); }} />
          <TextArea label="Karar notu / gerekçe" rows={3} value={note} onChange={(e) => setNote(e.target.value)} hint="Ret, ek bilgi isteme ve askıya almada zorunludur; işletmeye iletilir." error={decide.fields.note} />
          {decide.error && !decide.fields.note && <Alert tone="error">{decide.error}</Alert>}
          <div className="row">
            {['pending_review', 'rejected'].includes(data.business.verification_status) && <Button busy={decide.busy} onClick={() => decide.run('approve')}>Onayla</Button>}
            {data.business.verification_status === 'pending_review' && <Button variant="secondary" busy={decide.busy} onClick={() => decide.run('request_info')}>Ek bilgi iste</Button>}
            {data.business.verification_status === 'pending_review' && <Button variant="danger" busy={decide.busy} onClick={() => decide.run('reject')}>Reddet</Button>}
            {data.business.verification_status === 'approved' && <Button variant="danger" busy={decide.busy} onClick={() => decide.run('suspend')}>Askıya al</Button>}
            {data.business.verification_status === 'suspended' && <Button busy={decide.busy} onClick={() => decide.run('reinstate')}>Yeniden yayına al</Button>}
          </div>
          <div className="divider" />
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Select label="Paket ata (manuel faturalandırma)" value={plan} onChange={(e) => setPlan(e.target.value)}><option value="free">Ücretsiz</option><option value="pro">Profesyonel</option><option value="premium">Premium</option></Select>
            <Button variant="secondary" onClick={async () => { await api.post(`/api/admin/businesses/${id}/plan`, { plan_code: plan }); toast('Paket atandı.'); }}>Ata</Button>
          </div>
          {data.history.length > 0 && <details><summary className="small" style={{ cursor: 'pointer' }}>Karar geçmişi</summary><ul className="small">{data.history.map((h, i) => <li key={i}>{formatDateTime(h.created_at)} — {h.action.replace('admin.business_', '')} ({h.actor}){h.metadata?.note ? `: ${h.metadata.note}` : ''}</li>)}</ul></details>}
        </div>
      )}
    </Modal>
  );
}

export function AdminBusinesses() {
  useDocumentTitle('İşletmeler');
  const [status, setStatus] = useState(new URLSearchParams(location.search).get('durum') ?? 'pending_review');
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi<{ id: string; name: string; business_type: string; city: string | null; district: string | null; verification_status: string; is_demo: boolean; submitted_at: string | null; owner_name: string; owner_email: string; appointment_count: number; open_reports: number }[]>(`/api/admin/businesses${qs({ status: status === 'all' ? '' : status, q: q.length > 1 ? q : '' })}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack">
      <PageHeader title="İşletmeler" />
      <div className="row-between">
        <Tabs label="Durum" value={status} onChange={setStatus} items={[...['pending_review', 'approved', 'draft', 'rejected', 'suspended'].map((s) => ({ value: s, label: VERIFICATION_STATUS_LABEL[s] })), { value: 'all', label: 'Tümü' }]} />
        <input className="input" style={{ maxWidth: 260 }} placeholder="Ad veya e-posta ara" aria-label="İşletme ara" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && !data ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? <EmptyState title="Kayıt yok" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>İşletme</th><th>Konum</th><th>Sahip</th><th>Durum</th><th>Başvuru</th><th>Randevu</th></tr></thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.id} className="clickable" tabIndex={0} onClick={() => setOpen(b.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(b.id)}>
                  <td><strong>{b.name}</strong><div className="muted xsmall">{BUSINESS_TYPE_LABEL[b.business_type as BusinessType]}{b.is_demo ? ' · Demo' : ''}</div></td>
                  <td className="small">{[b.district, b.city].filter(Boolean).join(', ') || '—'}</td>
                  <td className="small">{b.owner_name}<div className="muted xsmall">{b.owner_email}</div></td>
                  <td><VerificationBadge status={b.verification_status} />{b.open_reports > 0 && <Badge tone="red">{b.open_reports} şikâyet</Badge>}</td>
                  <td className="small nowrap">{b.submitted_at ? formatDate(b.submitted_at, undefined, { weekday: undefined }) : '—'}</td>
                  <td>{b.appointment_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <BusinessReview id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

export function AdminUsers() {
  useDocumentTitle('Kullanıcılar');
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi<{ id: string; full_name: string; email: string; phone: string | null; platform_role: string; account_status: string; email_verified_at: string | null; created_at: string; last_login_at: string | null; appointment_count: number; business_count: number }[]>(`/api/admin/users${qs({ q: q.length > 1 ? q : '' })}`);
  const confirm = useConfirm();
  const toast = useToast();
  const setStatus = async (id: string, status: 'active' | 'suspended') => {
    const r = await confirm({ title: status === 'suspended' ? 'Hesabı askıya al' : 'Hesabı etkinleştir', message: status === 'suspended' ? 'Kullanıcının tüm oturumları kapatılır ve giriş yapamaz.' : 'Kullanıcı tekrar giriş yapabilir.', confirmLabel: 'Onayla', tone: status === 'suspended' ? 'danger' : 'primary', reason: { label: 'Not (kayıt için)' } });
    if (!r.ok) return;
    try { await api.post(`/api/admin/users/${id}/status`, { status, note: r.reason || null }); toast('Güncellendi.'); reload(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const STATUS: Record<string, [string, 'green' | 'red' | 'amber' | 'neutral']> = { active: ['Aktif', 'green'], suspended: ['Askıda', 'red'], deletion_requested: ['Silme talebi', 'amber'], deleted: ['Silindi', 'neutral'] };
  return (
    <div className="stack">
      <PageHeader title="Kullanıcılar" />
      <input className="input" style={{ maxWidth: 320 }} placeholder="Ad veya e-posta ara" aria-label="Kullanıcı ara" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && !data ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Kullanıcı</th><th>Rol</th><th>Durum</th><th>Randevu</th><th>İşletme</th><th>Kayıt</th><th /></tr></thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.full_name}</strong><div className="muted xsmall">{u.email}{u.email_verified_at ? ' ✓' : ''}</div></td>
                  <td>{u.platform_role === 'admin' ? <Badge tone="dark">Yönetici</Badge> : 'Kullanıcı'}</td>
                  <td><Badge tone={STATUS[u.account_status][1]}>{STATUS[u.account_status][0]}</Badge></td>
                  <td>{u.appointment_count}</td><td>{u.business_count}</td>
                  <td className="small nowrap">{formatDate(u.created_at, undefined, { weekday: undefined })}</td>
                  <td style={{ textAlign: 'right' }}>
                    {u.account_status === 'active' && u.platform_role !== 'admin' && <Button size="sm" variant="ghost" onClick={() => setStatus(u.id, 'suspended')}>Askıya al</Button>}
                    {u.account_status === 'suspended' && <Button size="sm" variant="ghost" onClick={() => setStatus(u.id, 'active')}>Etkinleştir</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AdminModeration() {
  useDocumentTitle('Yorum ve şikâyetler');
  const [tab, setTab] = useState<'reports' | 'reviews'>('reports');
  const reports = useApi<{ id: string; target_type: string; target_id: string; reason: string; status: string; created_at: string; reporter: string; target_label: string; resolution_note: string | null }[]>(tab === 'reports' ? '/api/admin/reports' : null);
  const reviews = useApi<{ id: string; rating: number; comment: string | null; moderation_status: string; created_at: string; business_name: string; author: string; open_reports: number }[]>(tab === 'reviews' ? '/api/admin/reviews' : null);
  const confirm = useConfirm();
  const toast = useToast();
  const resolve = async (id: string, status: 'resolved' | 'dismissed') => {
    const r = await confirm({ title: status === 'resolved' ? 'Şikâyeti çözüldü olarak kapat' : 'Şikâyeti reddet', message: 'Not ekleyebilirsiniz.', confirmLabel: 'Kaydet', reason: { label: 'Çözüm notu' } });
    if (!r.ok) return;
    await api.post(`/api/admin/reports/${id}/resolve`, { status, note: r.reason || null });
    toast('Kaydedildi.');
    reports.reload();
  };
  const moderate = async (id: string, status: 'published' | 'hidden' | 'removed') => {
    await api.post(`/api/admin/reviews/${id}/moderate`, { status });
    toast('Yorum durumu güncellendi.');
    reviews.reload();
  };
  return (
    <div className="stack">
      <PageHeader title="Yorum ve şikâyetler" />
      <Tabs label="Bölüm" value={tab} onChange={setTab} items={[{ value: 'reports', label: 'Şikâyetler' }, { value: 'reviews', label: 'Yorumlar' }]} />
      {tab === 'reports' && (reports.loading ? <Spinner /> : !reports.data?.length ? <EmptyState title="Şikâyet yok" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Tarih</th><th>Hedef</th><th>Neden</th><th>Bildiren</th><th>Durum</th><th /></tr></thead>
          <tbody>{reports.data.map((r) => (
            <tr key={r.id}>
              <td className="small nowrap">{formatDateTime(r.created_at)}</td>
              <td className="small"><Badge>{r.target_type === 'review' ? 'Yorum' : 'İşletme'}</Badge> {r.target_label}</td>
              <td className="small">{r.reason}</td><td className="small">{r.reporter}</td>
              <td>{r.status === 'open' ? <Badge tone="amber">Açık</Badge> : <Badge>{r.status === 'resolved' ? 'Çözüldü' : 'Reddedildi'}</Badge>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{r.status === 'open' && <><Button size="sm" variant="ghost" onClick={() => resolve(r.id, 'resolved')}>Çözüldü</Button><Button size="sm" variant="ghost" onClick={() => resolve(r.id, 'dismissed')}>Reddet</Button></>}</td>
            </tr>))}
          </tbody>
        </table></div>
      ))}
      {tab === 'reviews' && (reviews.loading ? <Spinner /> : !reviews.data?.length ? <EmptyState title="Yorum yok" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>İşletme</th><th>Yazan</th><th>Puan</th><th>Yorum</th><th>Durum</th><th /></tr></thead>
          <tbody>{reviews.data.map((r) => (
            <tr key={r.id}>
              <td className="small">{r.business_name}</td><td className="small">{r.author}</td><td>{r.rating}/5</td>
              <td className="small">{r.comment ?? '—'}{r.open_reports > 0 && <> <Badge tone="red">{r.open_reports} şikâyet</Badge></>}</td>
              <td><Badge tone={r.moderation_status === 'published' ? 'green' : 'amber'}>{{ published: 'Yayında', hidden: 'Gizli', removed: 'Kaldırıldı' }[r.moderation_status]}</Badge></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {r.moderation_status !== 'published' && <Button size="sm" variant="ghost" onClick={() => moderate(r.id, 'published')}>Yayınla</Button>}
                {r.moderation_status !== 'hidden' && <Button size="sm" variant="ghost" onClick={() => moderate(r.id, 'hidden')}>Gizle</Button>}
                {r.moderation_status !== 'removed' && <Button size="sm" variant="ghost" onClick={() => moderate(r.id, 'removed')}>Kaldır</Button>}
              </td>
            </tr>))}
          </tbody>
        </table></div>
      ))}
    </div>
  );
}

export function AdminCategories() {
  useDocumentTitle('Kategoriler');
  const { data, loading, reload } = useApi<{ id: string; name: string; business_type: string; sort_order: number; is_active: boolean; business_count: number; templates: { id: string; name: string; duration: number }[] }[]>('/api/admin/categories');
  const [edit, setEdit] = useState<{ id?: string; name: string; business_type: string; sort_order: number; is_active: boolean } | null>(null);
  const [tpl, setTpl] = useState<Record<string, { name: string; duration: number }>>({});
  const toast = useToast();
  const s = useSubmit(async () => {
    if (!edit) return;
    if (edit.id) await api.put(`/api/admin/categories/${edit.id}`, edit);
    else await api.post('/api/admin/categories', edit);
    toast('Kategori kaydedildi.');
    setEdit(null);
    reload();
  });
  return (
    <div className="stack">
      <PageHeader title="Hizmet kategorileri" actions={<Button onClick={() => setEdit({ name: '', business_type: 'barber', sort_order: (data?.length ?? 0) + 1, is_active: true })}>Yeni kategori</Button>} />
      {loading ? <Spinner /> : data?.map((c) => (
        <Card key={c.id}>
          <div className="row-between">
            <div><strong>{c.name}</strong> <span className="muted small">· {BUSINESS_TYPE_LABEL[c.business_type as BusinessType]} · {c.business_count} işletme</span> {!c.is_active && <Badge>Pasif</Badge>}</div>
            <Button size="sm" variant="secondary" onClick={() => setEdit({ id: c.id, name: c.name, business_type: c.business_type, sort_order: c.sort_order, is_active: c.is_active })}>Düzenle</Button>
          </div>
          <div className="chips" style={{ marginTop: 12 }}>
            {c.templates.map((t) => (
              <span key={t.id} className="chip" style={{ cursor: 'default' }}>{t.name} · {t.duration} dk <button type="button" className="link-btn xsmall" aria-label={`${t.name} şablonunu sil`} onClick={async () => { await api.del(`/api/admin/templates/${t.id}`); reload(); }}>×</button></span>
            ))}
          </div>
          <form className="row" style={{ marginTop: 12, alignItems: 'flex-end' }} onSubmit={async (e) => { e.preventDefault(); const t = tpl[c.id]; if (!t?.name) return; try { await api.post(`/api/admin/categories/${c.id}/templates`, { name: t.name, default_duration_minutes: t.duration || 30 }); setTpl({ ...tpl, [c.id]: { name: '', duration: 30 } }); reload(); } catch (er) { toast((er as Error).message, 'error'); } }}>
            <TextInput label="Yeni başlangıç hizmeti" value={tpl[c.id]?.name ?? ''} onChange={(e) => setTpl({ ...tpl, [c.id]: { duration: tpl[c.id]?.duration ?? 30, name: e.target.value } })} />
            <TextInput label="Süre (dk)" type="number" min={5} style={{ width: 100 }} value={tpl[c.id]?.duration ?? 30} onChange={(e) => setTpl({ ...tpl, [c.id]: { name: tpl[c.id]?.name ?? '', duration: Number(e.target.value) } })} />
            <Button type="submit" size="sm" variant="secondary">Ekle</Button>
          </form>
        </Card>
      ))}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Kategoriyi düzenle' : 'Yeni kategori'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Vazgeç</Button><Button busy={s.busy} onClick={() => s.run()}>Kaydet</Button></>}>
        {edit && <div className="stack">
          <TextInput label="Ad" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={s.fields.name} />
          <Select label="İşletme türü" value={edit.business_type} onChange={(e) => setEdit({ ...edit, business_type: e.target.value })}>{BUSINESS_TYPES.map((t) => <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t]}</option>)}</Select>
          <TextInput label="Sıra" type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} />
          <Switch label="Aktif" checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} />
          {s.error && !Object.keys(s.fields).length && <Alert tone="error">{s.error}</Alert>}
        </div>}
      </Modal>
    </div>
  );
}

export function AdminPlans() {
  useDocumentTitle('Paketler');
  const { data, loading, reload } = useApi<{ id: string; code: string; name: string; description: string | null; price_amount: string; billing_period: string; features: string[]; feature_limits: Record<string, any>; is_active: boolean; active_subscriptions: number }[]>('/api/admin/plans');
  const [edit, setEdit] = useState<any>(null);
  const toast = useToast();
  const s = useSubmit(async () => {
    await api.put(`/api/admin/plans/${edit.id}`, { ...edit, price_amount: Number(edit.price_amount), features: String(edit.featuresText).split('\n').map((x: string) => x.trim()).filter(Boolean) });
    toast('Paket güncellendi.');
    setEdit(null);
    reload();
  });
  return (
    <div className="stack">
      <PageHeader title="Paketler" description="Ödeme sağlayıcısı bağlı değil; paketler manuel atanır. Fiyatlar yalnızca bilgi amaçlı gösterilir." />
      {loading ? <Spinner /> : <div className="grid-3">{data?.map((p) => (
        <Card key={p.id} className="stack-sm">
          <div className="row-between"><h3 style={{ margin: 0 }}>{p.name}</h3>{!p.is_active && <Badge>Pasif</Badge>}</div>
          <strong>{formatTL(p.price_amount)} / {p.billing_period === 'monthly' ? 'ay' : 'yıl'}</strong>
          <span className="muted small">{p.active_subscriptions} aktif abonelik · {p.feature_limits.max_employees} çalışan · {p.feature_limits.max_services} hizmet</span>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
          <Button size="sm" variant="secondary" onClick={() => setEdit({ ...p, featuresText: p.features.join('\n'), feature_limits: { ...p.feature_limits } })}>Düzenle</Button>
        </Card>
      ))}</div>}
      <Modal size="lg" open={Boolean(edit)} onClose={() => setEdit(null)} title="Paketi düzenle" footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Vazgeç</Button><Button busy={s.busy} onClick={() => s.run()}>Kaydet</Button></>}>
        {edit && <div className="stack">
          <div className="form-grid">
            <TextInput label="Ad" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <TextInput label="Fiyat (TL)" type="number" min={0} value={edit.price_amount} onChange={(e) => setEdit({ ...edit, price_amount: e.target.value })} />
            <TextInput label="En fazla çalışan" type="number" min={1} value={edit.feature_limits.max_employees} onChange={(e) => setEdit({ ...edit, feature_limits: { ...edit.feature_limits, max_employees: Number(e.target.value) } })} />
            <TextInput label="En fazla hizmet" type="number" min={1} value={edit.feature_limits.max_services} onChange={(e) => setEdit({ ...edit, feature_limits: { ...edit.feature_limits, max_services: Number(e.target.value) } })} />
            <Select label="Raporlar" value={edit.feature_limits.reports} onChange={(e) => setEdit({ ...edit, feature_limits: { ...edit.feature_limits, reports: e.target.value } })}><option value="basic">Temel</option><option value="detailed">Ayrıntılı</option><option value="advanced">Gelişmiş</option></Select>
            <Select label="Dönem" value={edit.billing_period} onChange={(e) => setEdit({ ...edit, billing_period: e.target.value })}><option value="monthly">Aylık</option><option value="yearly">Yıllık</option></Select>
          </div>
          <TextArea label="Açıklama" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={2} />
          <TextArea label="Özellikler (her satır bir madde)" value={edit.featuresText} onChange={(e) => setEdit({ ...edit, featuresText: e.target.value })} rows={5} />
          <Switch label="Hatırlatmalar" checked={Boolean(edit.feature_limits.reminders)} onChange={(v) => setEdit({ ...edit, feature_limits: { ...edit.feature_limits, reminders: v } })} />
          <Switch label="Aktif" checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} />
          {s.error && <Alert tone="error">{s.error}</Alert>}
        </div>}
      </Modal>
    </div>
  );
}

export function AdminDataRequests() {
  useDocumentTitle('KVKK başvuruları');
  const { data, loading, reload } = useApi<{ id: string; request_type: string; details: string | null; status: string; resolution_note: string | null; created_at: string; full_name: string | null; email: string | null; account_status: string | null; deletion_requested_at: string | null }[]>('/api/admin/data-requests');
  const [sel, setSel] = useState<any>(null);
  const [note, setNote] = useState('');
  const toast = useToast();
  const act = useSubmit(async (status: string, anonymize = false) => {
    await api.post(`/api/admin/data-requests/${sel.id}`, { status, resolution_note: note || null, anonymize });
    toast('Başvuru güncellendi.');
    setSel(null);
    setNote('');
    reload();
  });
  const T: Record<string, string> = { access: 'Bilgi talebi', correction: 'Düzeltme', deletion: 'Silme', objection: 'İtiraz', other: 'Diğer' };
  return (
    <div className="stack">
      <PageHeader title="KVKK başvuruları" description="Yasal süre: başvurular en geç 30 gün içinde sonuçlandırılmalıdır (KVKK m.13)." />
      {loading ? <Spinner /> : !data?.length ? <EmptyState title="Başvuru yok" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Tarih</th><th>Kişi</th><th>Tür</th><th>Açıklama</th><th>Durum</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => setSel(d)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(d)}>
              <td className="small nowrap">{formatDateTime(d.created_at)}</td>
              <td className="small">{d.full_name}<div className="muted xsmall">{d.email}</div></td>
              <td>{T[d.request_type]}</td><td className="small">{d.details}</td>
              <td><Badge tone={d.status === 'completed' ? 'green' : d.status === 'rejected' ? 'neutral' : 'amber'}>{{ open: 'Açık', in_progress: 'İnceleniyor', completed: 'Tamamlandı', rejected: 'Kapatıldı' }[d.status]}</Badge></td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      <Modal open={Boolean(sel)} onClose={() => setSel(null)} title={sel ? `${T[sel.request_type]} — ${sel.full_name}` : ''}>
        {sel && <div className="stack">
          <p className="small">{sel.details}</p>
          {sel.request_type === 'deletion' && <Alert tone="warning">Anonimleştirme geri alınamaz. Kullanıcı bekleme süresi dolmadan talebini geri çekebilir; süre dolunca sistem otomatik anonimleştirir.</Alert>}
          <TextArea label="Sonuç notu (kullanıcıya iletilir)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          {act.error && <Alert tone="error">{act.error}</Alert>}
          <div className="row">
            <Button variant="secondary" busy={act.busy} onClick={() => act.run('in_progress')}>İncelemeye al</Button>
            <Button busy={act.busy} onClick={() => act.run('completed')}>Tamamlandı</Button>
            <Button variant="ghost" busy={act.busy} onClick={() => act.run('rejected')}>Reddet</Button>
            {sel.request_type === 'deletion' && sel.account_status !== 'deleted' && <Button variant="danger" busy={act.busy} onClick={() => act.run('completed', true)}>Şimdi anonimleştir</Button>}
          </div>
        </div>}
      </Modal>
    </div>
  );
}

export function AdminMessages() {
  useDocumentTitle('Bildirim servisleri');
  const { data, loading } = useApi<{ integrations: Record<string, { configured: boolean; provider?: string }>; summary: { channel: string; status: string; n: number }[]; rows: { id: string; channel: string; recipient: string; subject: string | null; status: string; attempts: number; last_error: string | null; created_at: string }[] }>('/api/admin/messages');
  const S: Record<string, string> = { queued: 'Kuyrukta', sent: 'Gönderildi', failed: 'Başarısız', skipped_unconfigured: 'Servis yok — gönderilmedi', skipped_preference: 'Kullanıcı tercihi — gönderilmedi' };
  if (loading || !data) return <Spinner />;
  return (
    <div className="stack">
      <PageHeader title="Bildirim servisleri" description="E-posta ve SMS gönderimlerinin gerçek durumu. Servis yapılandırılmadıysa mesajlar gönderilmiş gibi gösterilmez." />
      <div className="grid-2">
        {(['email', 'sms'] as const).map((c) => (
          <Card key={c}>
            <div className="row-between"><strong>{c === 'email' ? 'E-posta' : 'SMS'}</strong>{data.integrations[c].configured ? <Badge tone="green">{data.integrations[c].provider}</Badge> : <Badge tone="amber">Yapılandırılmadı</Badge>}</div>
            {data.summary.filter((x) => x.channel === c).map((x) => <div key={x.status} className="summary-row"><span>{S[x.status]}</span><span>{x.n}</span></div>)}
          </Card>
        ))}
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Tarih</th><th>Kanal</th><th>Alıcı</th><th>Konu</th><th>Durum</th></tr></thead>
        <tbody>{data.rows.map((r) => <tr key={r.id}><td className="small nowrap">{formatDateTime(r.created_at)}</td><td>{r.channel === 'email' ? 'E-posta' : 'SMS'}</td><td className="small mono">{r.recipient}</td><td className="small">{r.subject ?? '—'}</td><td className="small">{S[r.status]}{r.last_error && r.status === 'failed' ? ` (${r.last_error})` : ''}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}

export function AdminAudit() {
  useDocumentTitle('İşlem kayıtları');
  const [action, setAction] = useState('');
  const { data, loading } = useApi<{ id: number; action: string; target_type: string | null; target_id: string | null; ip: string | null; created_at: string; actor: string | null; actor_email: string | null; business_name: string | null }[]>(`/api/admin/audit${qs({ action })}`);
  return (
    <div className="stack">
      <PageHeader title="İşlem ve güvenlik kayıtları" />
      <Select label="Filtre" value={action} onChange={(e) => setAction(e.target.value)} style={{ maxWidth: 260 }}>
        <option value="">Tümü</option><option value="user.">Kullanıcı</option><option value="admin.">Yönetici</option><option value="business.">İşletme</option><option value="appointment.">Randevu</option><option value="service.">Hizmet</option><option value="employee.">Çalışan</option><option value="member.">Ekip</option>
      </Select>
      {loading ? <Spinner /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Zaman</th><th>İşlem</th><th>Yapan</th><th>İşletme</th><th>IP</th></tr></thead>
          <tbody>{data?.map((l) => <tr key={l.id}><td className="small nowrap">{formatDateTime(l.created_at)}</td><td className="small mono">{l.action}</td><td className="small">{l.actor ?? 'Sistem'}</td><td className="small">{l.business_name ?? '—'}</td><td className="small mono">{l.ip ?? '—'}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}


export function AdminPayments() {
  useDocumentTitle('Ödemeler ve gelir');
  const { data, loading, error, reload } = useApi<{ rows: { merchant_oid: string; months: number; amount: string; status: string; founding: boolean; provider: string; created_at: string; paid_at: string | null; failure_reason: string | null; plan_name: string; business_name: string }[]; summary: Record<string, string | number>; onlinePayments: boolean; demoPayments: boolean }>('/api/admin/payments');
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const s = data.summary;
  return (
    <div className="stack">
      <PageHeader title="Ödemeler ve gelir" description="İşletmelerin PayTR ile yaptığı abonelik ödemeleri. Randevu alan kişilerden ödeme alınmaz." />
      {!data.onlinePayments && <Alert tone="warning" title="PayTR henüz bağlı değil">Render'da PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY ve PAYTR_MERCHANT_SALT ortam değişkenlerini girin. PayTR mağaza panelinde Bildirim URL olarak <span className="mono">/api/payments/paytr/callback</span> adresini tanımlayın.{data.demoPayments ? ' Şu an demo ödemeler açık; bunlar gerçek gelir değildir.' : ''}</Alert>}
      <div className="stats-grid">
        <Stat label="Aylık tekrarlayan gelir" value={formatTL(s.mrr as string)} hint="Aktif ücretli paketlerin aylık tutarı" />
        <Stat label="Bu ay tahsil edilen" value={formatTL(s.this_month as string)} />
        <Stat label="Toplam tahsilat" value={formatTL(s.total as string)} hint={`${s.paid_count} başarılı ödeme`} />
        <Stat label="Ödeyen işletme" value={s.paying_businesses} />
        <Stat label="Denemedeki işletme" value={s.trialing_businesses} />
      </div>
      {!data.rows.length ? <EmptyState title="Henüz ödeme yok" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Tarih</th><th>İşletme</th><th>Paket</th><th>Tutar</th><th>Durum</th><th>Kaynak</th></tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={r.merchant_oid}>
              <td className="small nowrap">{formatDateTime(r.created_at)}</td>
              <td className="small">{r.business_name}</td>
              <td className="small">{r.plan_name} · {r.months} ay{r.founding ? ' · kurucu' : ''}</td>
              <td className="small mono">{formatTL(r.amount)}</td>
              <td>{r.status === 'paid' ? <Badge tone="green">Ödendi</Badge> : r.status === 'pending' ? <Badge tone="amber">Bekliyor</Badge> : <Badge tone="red">Başarısız</Badge>}{r.failure_reason && r.status === 'failed' && <div className="muted xsmall">{r.failure_reason}</div>}</td>
              <td className="small">{r.provider === 'paytr' ? 'PayTR' : r.provider === 'demo' ? 'Demo' : 'Manuel'}</td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
