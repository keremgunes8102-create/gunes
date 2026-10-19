import { useEffect, useState, type ReactNode } from 'react';
import { Link, navigate, useLocation, useSearchParams } from '../lib/router.tsx';
import { api } from '../lib/api.ts';
import { useApi, useDocumentTitle, useSubmit } from '../lib/hooks.ts';
import { useAuth } from '../lib/auth.tsx';
import { BusinessCard } from '../components/BusinessCard.tsx';
import { StatusBadge } from '../ui/brand.tsx';
import {
  Alert, Badge, Button, ButtonLink, Card, Checkbox, EmptyState, ErrorState, Modal, PageHeader, Select, Spinner, Switch, TabLinks, Tabs, TextArea, TextInput, useConfirm, useToast,
} from '../ui/index.tsx';
import { IconBell, IconCalendar, IconCheckCircle, IconDownload, IconHeart, IconMessage, IconStarFilled } from '../ui/icons.tsx';
import { formatDate, formatDateTime, formatDuration, formatTL, formatTime } from '../../shared/format.ts';
import type { Appointment, BizListItem } from '../types.ts';

const TABS = [
  { to: '/hesabim/randevular', label: 'Randevularım' },
  { to: '/hesabim/favoriler', label: 'Favorilerim' },
  { to: '/hesabim/yorumlar', label: 'Yorumlarım' },
  { to: '/hesabim/bildirimler', label: 'Bildirimler' },
  { to: '/hesabim/profil', label: 'Profilim' },
  { to: '/hesabim/gizlilik', label: 'Hesap ve gizlilik' },
];

export function AccountLayout({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const { unread } = useAuth();
  const current = TABS.find((t) => path.startsWith(t.to))?.to ?? '';
  return (
    <div className="container section-sm">
      <TabLinks items={TABS.map((t) => (t.to === '/hesabim/bildirimler' ? { ...t, count: unread } : t))} current={current} />
      {children}
    </div>
  );
}

export function priceText(a: Pick<Appointment, 'price_type_snapshot' | 'price_snapshot' | 'price_max_snapshot'>) {
  if (a.price_type_snapshot === 'consultation') return a.price_snapshot && Number(a.price_snapshot) > 0 ? `${formatTL(a.price_snapshot)} + danışma` : 'Danışma sonrası';
  if (a.price_type_snapshot === 'range') return `${formatTL(a.price_snapshot)} – ${formatTL(a.price_max_snapshot)}`;
  if (a.price_type_snapshot === 'starting_from') return `${formatTL(a.price_snapshot)}'den başlayan`;
  return formatTL(a.price_snapshot);
}

function ApptCard({ a }: { a: Appointment }) {
  const tz = a.timezone ?? 'Europe/Istanbul';
  const d = new Date(a.start_at);
  return (
    <Link to={`/hesabim/randevular/${a.public_reference}`} className="appt-card" style={{ color: 'inherit' }}>
      <div className="appt-date">
        <span>{new Intl.DateTimeFormat('tr-TR', { month: 'short', timeZone: tz }).format(d)}</span>
        <strong>{new Intl.DateTimeFormat('tr-TR', { day: 'numeric', timeZone: tz }).format(d)}</strong>
        <span>{new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: tz }).format(d)}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong className="ellipsis">{a.business_name}</strong>
          <StatusBadge status={a.status} />
        </div>
        <div className="muted small ellipsis">{a.services.map((s) => s.name).join(', ')} · {a.employee_name}</div>
        <div className="small" style={{ fontWeight: 600 }}>{formatTime(a.start_at, tz)} · {formatDuration(a.duration_snapshot)}</div>
      </div>
      <div className="small" style={{ fontWeight: 600, textAlign: 'right' }}>{priceText(a)}</div>
    </Link>
  );
}

export function MyAppointments() {
  useDocumentTitle('Randevularım');
  const [scope, setScope] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming');
  const { data, loading, error, reload } = useApi<Appointment[]>(`/api/me/appointments?scope=${scope}`);
  return (
    <>
      <PageHeader title="Randevularım" actions={<ButtonLink to="/kesfet" size="sm">Yeni randevu</ButtonLink>} />
      <Tabs label="Randevu türü" value={scope} onChange={setScope} items={[{ value: 'upcoming', label: 'Yaklaşan' }, { value: 'past', label: 'Geçmiş' }, { value: 'cancelled', label: 'İptal edilen' }]} />
      {loading ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon={<IconCalendar />} title={scope === 'upcoming' ? 'Yaklaşan randevunuz yok' : scope === 'past' ? 'Geçmiş randevunuz yok' : 'İptal edilen randevu yok'} action={scope === 'upcoming' ? <ButtonLink to="/kesfet">Randevu al</ButtonLink> : undefined} />
      ) : (
        <div className="stack-sm">{data.map((a) => <ApptCard key={a.id} a={a} />)}</div>
      )}
    </>
  );
}

interface ApptDetail extends Appointment {
  can_cancel: boolean;
  can_reschedule: boolean;
  can_review: boolean;
  cancel_deadline: string;
  cancellation_policy_snapshot: string | null;
  proposals: { id: string; proposed_start_at: string; status: string; note: string | null; employee_name: string }[];
}

function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="row" role="radiogroup" aria-label="Puan" style={{ gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} yıldız`} className="icon-btn" style={{ color: n <= value ? '#b8862b' : 'var(--line-2)' }} onClick={() => onChange(n)}>
          <IconStarFilled size={26} />
        </button>
      ))}
    </div>
  );
}

export function AppointmentDetailPage({ reference }: { reference: string }) {
  const { data: a, loading, error, reload } = useApi<ApptDetail>(`/api/me/appointments/${reference}`);
  const [params] = useSearchParams();
  const confirm = useConfirm();
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  useDocumentTitle(a ? `Randevu ${a.public_reference}` : 'Randevu');
  const review = useSubmit(async () => {
    await api.post(`/api/me/appointments/${reference}/review`, { rating, comment: comment || null });
    toast('Değerlendirmeniz için teşekkürler.');
    reload();
  });
  useEffect(() => {
    if (params.get('moved')) toast('Randevu saatiniz güncellendi.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (loading) return <Spinner />;
  if (error || !a) return <ErrorState error={error} onRetry={reload} />;
  const tz = a.timezone ?? 'Europe/Istanbul';
  const openProposal = a.proposals.find((p) => p.status === 'open');
  const cancel = async () => {
    const r = await confirm({ title: 'Randevuyu iptal et', message: `${a.business_name} — ${formatDateTime(a.start_at, tz)} randevunuz iptal edilecek. Bu işlem geri alınamaz.`, confirmLabel: 'İptal et', tone: 'danger', reason: { label: 'İptal nedeni', placeholder: 'İşletmeyle paylaşılır' } });
    if (!r.ok) return;
    try {
      await api.post(`/api/me/appointments/${reference}/cancel`, { reason: r.reason || null });
      toast('Randevunuz iptal edildi.');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const respond = async (id: string, accept: boolean) => {
    try {
      await api.post(`/api/me/proposals/${id}/respond`, { accept });
      toast(accept ? 'Yeni saat kabul edildi.' : 'Öneri reddedildi.');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
      reload();
    }
  };
  return (
    <div className="stack">
      <PageHeader back={{ to: '/hesabim/randevular', label: 'Randevularım' }} title={a.business_name} description={<span className="row" style={{ gap: 8 }}><StatusBadge status={a.status} /> <span>Randevu no: <strong className="mono">{a.public_reference}</strong></span></span>} />
      {a.business_is_demo && <div className="demo-note">Bu randevu bir örnek (demo) işletmeye aittir.</div>}
      {openProposal && (
        <Alert tone="warning" title="İşletme yeni bir saat önerdi">
          <p style={{ margin: '4px 0 10px' }}>{formatDateTime(openProposal.proposed_start_at, tz)} · {openProposal.employee_name}{openProposal.note ? ` — “${openProposal.note}”` : ''}</p>
          <div className="row">
            <Button size="sm" onClick={() => respond(openProposal.id, true)}>Kabul et</Button>
            <Button size="sm" variant="secondary" onClick={() => respond(openProposal.id, false)}>Reddet</Button>
          </div>
        </Alert>
      )}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card>
          <div className="summary-row"><span>Tarih</span><span>{formatDate(a.start_at, tz)}</span></div>
          <div className="summary-row"><span>Saat</span><span>{formatTime(a.start_at, tz)} – {formatTime(a.end_at, tz)}</span></div>
          <div className="summary-row"><span>Hizmet</span><span>{a.services.map((s) => s.name).join(', ')}</span></div>
          <div className="summary-row"><span>Çalışan</span><span>{a.employee_name}</span></div>
          <div className="summary-row"><span>Süre</span><span>{formatDuration(a.duration_snapshot)}</span></div>
          <div className="summary-row"><span>Tutar</span><span>{priceText(a)}</span></div>
          <div className="summary-row"><span>Adres</span><span>{[a.business_address, a.business_district, a.business_city].filter(Boolean).join(', ')}</span></div>
          {a.business_phone && <div className="summary-row"><span>Telefon</span><span><a href={`tel:${a.business_phone}`}>{a.business_phone}</a></span></div>}
          {a.customer_note && <div className="summary-row"><span>Notunuz</span><span>{a.customer_note}</span></div>}
          {a.cancellation_reason && <div className="summary-row"><span>İptal/ret nedeni</span><span>{a.cancellation_reason}</span></div>}
        </Card>
        <div className="stack">
          {(a.status === 'pending' || a.status === 'confirmed') && (
            <Card>
              <h3 className="card-title">Değişiklik ve iptal</h3>
              {a.can_cancel ? (
                <>
                  <p className="small muted">{formatDateTime(a.cancel_deadline, tz)} tarihine kadar ücretsiz iptal edebilir veya saatini değiştirebilirsiniz.</p>
                  <div className="row">
                    <ButtonLink to={`/randevu/${a.business_slug}?reschedule=${a.public_reference}`} variant="secondary" size="sm">Saati değiştir</ButtonLink>
                    <Button variant="danger" size="sm" onClick={cancel}>Randevuyu iptal et</Button>
                  </div>
                </>
              ) : (
                <Alert tone="warning">İptal/değişiklik süresi geçti (başlangıçtan {a.cancel_min_hours_snapshot} saat öncesine kadar). Lütfen işletmeyi arayın.</Alert>
              )}
              {a.cancellation_policy_snapshot && <p className="xsmall muted" style={{ marginTop: 12, marginBottom: 0 }}>İşletmenin iptal politikası: {a.cancellation_policy_snapshot}</p>}
            </Card>
          )}
          {a.can_review && (
            <Card>
              <h3 className="card-title">Deneyiminizi değerlendirin</h3>
              <form className="stack" onSubmit={(e) => { e.preventDefault(); review.run(); }}>
                <StarInput value={rating} onChange={setRating} />
                <TextArea label="Yorumunuz" optional value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1500} rows={4} error={review.fields.comment} />
                {review.error && <Alert tone="error">{review.error}</Alert>}
                <Button type="submit" busy={review.busy}>Değerlendirmeyi gönder</Button>
              </form>
            </Card>
          )}
          {a.review_id && (
            <Alert tone="success">Bu randevu için değerlendirme bıraktınız. <Link to="/hesabim/yorumlar" style={{ fontWeight: 600 }}>Yorumlarım</Link></Alert>
          )}
          <ButtonLink to={`/isletme/${a.business_slug}`} variant="ghost">İşletme sayfasına git →</ButtonLink>
        </div>
      </div>
    </div>
  );
}

export function MyFavorites() {
  useDocumentTitle('Favorilerim');
  const { data, loading, error, reload } = useApi<(BizListItem & { created_at: string })[]>('/api/me/favorites');
  return (
    <>
      <PageHeader title="Favori işletmelerim" />
      {loading ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon={<IconHeart />} title="Henüz favoriniz yok" action={<ButtonLink to="/kesfet">İşletmeleri keşfet</ButtonLink>}>
          Beğendiğiniz işletmeleri kalp simgesiyle kaydedin, buradan hızlıca randevu alın.
        </EmptyState>
      ) : (
        <div className="grid-auto">
          {data.map((b) => (
            <BusinessCard key={b.id} favorite b={{ ...b, neighborhood: null, allow_employee_choice: true, online_booking_enabled: true, min_price: null, distance_km: null, sample_services: null, next_available: null }} />
          ))}
        </div>
      )}
    </>
  );
}

export function MyReviews() {
  useDocumentTitle('Yorumlarım');
  const { data, loading, error, reload } = useApi<{ id: string; rating: number; comment: string | null; created_at: string; moderation_status: string; business_reply: string | null; business_name: string; business_slug: string; public_reference: string }[]>('/api/me/reviews');
  const [editing, setEditing] = useState<{ id: string; rating: number; comment: string } | null>(null);
  const toast = useToast();
  const save = useSubmit(async () => {
    if (!editing) return;
    await api.patch(`/api/me/reviews/${editing.id}`, { rating: editing.rating, comment: editing.comment || null });
    toast('Yorumunuz güncellendi.');
    setEditing(null);
    reload();
  });
  return (
    <>
      <PageHeader title="Yorumlarım" description="Tamamlanan randevularınız için bıraktığınız değerlendirmeler." />
      {loading ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon={<IconMessage />} title="Henüz yorumunuz yok">Tamamlanan bir randevunun detayından değerlendirme bırakabilirsiniz.</EmptyState>
      ) : (
        <div className="stack-sm">
          {data.map((r) => (
            <Card key={r.id}>
              <div className="row-between">
                <Link to={`/isletme/${r.business_slug}`}><strong>{r.business_name}</strong></Link>
                <div className="row" style={{ gap: 8 }}>
                  {r.moderation_status !== 'published' && <Badge tone="amber">{r.moderation_status === 'hidden' ? 'Gizlendi' : 'Kaldırıldı'}</Badge>}
                  <span className="muted xsmall">{formatDate(r.created_at, undefined, { weekday: undefined })}</span>
                </div>
              </div>
              <div className="row" style={{ gap: 2, color: '#b8862b', margin: '6px 0' }} aria-label={`${r.rating} yıldız`}>
                {Array.from({ length: 5 }, (_, i) => <IconStarFilled key={i} size={15} style={{ opacity: i < r.rating ? 1 : 0.2 }} />)}
              </div>
              {r.comment && <p style={{ margin: 0 }}>{r.comment}</p>}
              {r.business_reply && <div className="review-reply"><strong className="small">İşletmenin yanıtı</strong><p style={{ margin: '4px 0 0' }}>{r.business_reply}</p></div>}
              {r.moderation_status !== 'removed' && (
                <Button variant="ghost" size="sm" style={{ marginTop: 8 }} onClick={() => setEditing({ id: r.id, rating: r.rating, comment: r.comment ?? '' })}>Düzenle</Button>
              )}
            </Card>
          ))}
        </div>
      )}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Yorumu düzenle" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Vazgeç</Button><Button busy={save.busy} onClick={() => save.run()}>Kaydet</Button></>}>
        {editing && (
          <div className="stack">
            <StarInput value={editing.rating} onChange={(v) => setEditing({ ...editing, rating: v })} />
            <TextArea label="Yorumunuz" value={editing.comment} onChange={(e) => setEditing({ ...editing, comment: e.target.value })} maxLength={1500} rows={4} />
            {save.error && <Alert tone="error">{save.error}</Alert>}
          </div>
        )}
      </Modal>
    </>
  );
}

export function NotificationsPage() {
  useDocumentTitle('Bildirimler');
  const { refresh } = useAuth();
  const { data, loading, error, reload } = useApi<{ id: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }[]>('/api/me/notifications');
  const markAll = async () => {
    await api.post('/api/me/notifications/read', {});
    reload();
    refresh();
  };
  const open = async (n: { id: string; link: string | null; read_at: string | null }) => {
    if (!n.read_at) {
      await api.post('/api/me/notifications/read', { ids: [n.id] });
      refresh();
    }
    if (n.link) navigate(n.link);
    else reload();
  };
  return (
    <>
      <PageHeader title="Bildirimler" actions={data?.some((n) => !n.read_at) ? <Button variant="secondary" size="sm" onClick={markAll}>Tümünü okundu işaretle</Button> : undefined} />
      {loading ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon={<IconBell />} title="Bildiriminiz yok">Randevu onayları, hatırlatmalar ve işletme yanıtları burada görünür.</EmptyState>
      ) : (
        <Card padded={false}>
          {data.map((n) => (
            <button key={n.id} type="button" onClick={() => open(n)} className="list-item" style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--line)', padding: '16px 20px', textAlign: 'left', cursor: 'pointer', alignItems: 'flex-start' }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, marginTop: 8, flexShrink: 0, background: n.read_at ? 'transparent' : 'var(--green)' }} aria-hidden />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block', fontWeight: n.read_at ? 550 : 700 }}>{n.title}</strong>
                <span className="muted small">{n.body}</span>
              </span>
              <span className="muted xsmall nowrap">{formatDateTime(n.created_at)}</span>
            </button>
          ))}
        </Card>
      )}
    </>
  );
}

function VerifyBlock({ channel, verified, available }: { channel: 'email' | 'sms'; verified: boolean; available: boolean }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [sent, setSent] = useState<{ devCode?: string; message?: string } | null>(null);
  const [code, setCode] = useState('');
  const req = useSubmit(async () => setSent(await api.post('/api/auth/verify/request', { channel })));
  const conf = useSubmit(async () => {
    await api.post('/api/auth/verify/confirm', { channel, code });
    toast(channel === 'email' ? 'E-posta adresiniz doğrulandı.' : 'Telefon numaranız doğrulandı.');
    setSent(null);
    await refresh();
  });
  const label = channel === 'email' ? 'E-posta' : 'Telefon';
  if (verified) return <div className="row small" style={{ color: 'var(--success)' }}><IconCheckCircle size={16} /> {label} doğrulandı</div>;
  if (!available) return null;
  return (
    <div className="stack-sm">
      {!sent ? (
        <div className="row">
          <span className="small muted">{label} doğrulanmadı.</span>
          <Button size="sm" variant="secondary" busy={req.busy} onClick={() => req.run()}>Doğrulama kodu gönder</Button>
        </div>
      ) : (
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); conf.run(); }}>
          <TextInput label={`${label} doğrulama kodu`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} error={conf.fields.code ?? conf.error ?? undefined} style={{ maxWidth: 160 }} />
          <Button type="submit" size="sm" busy={conf.busy}>Doğrula</Button>
        </form>
      )}
      {sent?.devCode && <Alert tone="info" title="Geliştirme modu">{sent.message} Kod: <strong className="mono">{sent.devCode}</strong></Alert>}
      {req.error && <Alert tone="warning">{req.error}</Alert>}
    </div>
  );
}

export function ProfilePage() {
  useDocumentTitle('Profilim');
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [f, setF] = useState({ full_name: user?.full_name ?? '', phone: user?.phone ?? '' });
  const save = useSubmit(async () => {
    await api.patch('/api/me/profile', { full_name: f.full_name, phone: f.phone || null });
    await refresh();
    toast('Profiliniz güncellendi.');
  });
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const changePw = useSubmit(async () => {
    await api.post('/api/auth/password/change', pw);
    setPw({ current_password: '', new_password: '' });
    toast('Şifreniz değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.');
  });
  if (!user) return null;
  const next = params.get('next');
  return (
    <div className="stack">
      <PageHeader title="Profilim" />
      {next && user.email_verified_at && <Alert tone="success">E-postanız doğrulandı. <Link to={next} style={{ fontWeight: 600 }}>Kaldığınız yere dönün →</Link></Alert>}
      <Card>
        <h2 className="card-title">Kişisel bilgiler</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); save.run(); }}>
          <div className="form-grid">
            <TextInput label="Ad soyad" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} error={save.fields.full_name} />
            <TextInput label="Cep telefonu" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={save.fields.phone} optional placeholder="05xx xxx xx xx" />
          </div>
          {save.error && !Object.keys(save.fields).length && <Alert tone="error">{save.error}</Alert>}
          <div className="form-actions"><Button type="submit" busy={save.busy}>Kaydet</Button></div>
        </form>
      </Card>
      <Card>
        <h2 className="card-title">Doğrulama</h2>
        <div className="stack">
          <div><div className="small" style={{ fontWeight: 600 }}>{user.email}</div><VerifyBlock channel="email" verified={Boolean(user.email_verified_at)} available /></div>
          <div className="divider" style={{ margin: 0 }} />
          {user.phone ? (
            <div><div className="small" style={{ fontWeight: 600 }}>{user.phone}</div><VerifyBlock channel="sms" verified={Boolean(user.phone_verified_at)} available /></div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>Telefon doğrulaması için önce telefon numaranızı ekleyin.</p>
          )}
        </div>
      </Card>
      <Card>
        <h2 className="card-title">Şifre değiştir</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); changePw.run(); }}>
          <div className="form-grid">
            <TextInput label="Mevcut şifre" type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} error={changePw.fields.current_password} />
            <TextInput label="Yeni şifre" type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} error={changePw.fields.new_password} />
          </div>
          {changePw.error && !Object.keys(changePw.fields).length && <Alert tone="error">{changePw.error}</Alert>}
          <div className="form-actions"><Button type="submit" variant="secondary" busy={changePw.busy}>Şifreyi değiştir</Button></div>
        </form>
      </Card>
    </div>
  );
}

export function PrivacyPage() {
  useDocumentTitle('Hesap ve gizlilik');
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const prefs = useApi<{ email_service: boolean; sms_service: boolean; reminders: boolean; reminder_hours: number; marketing_email: boolean; marketing_sms: boolean }>('/api/me/preferences');
  const reqs = useApi<{ id: string; request_type: string; details: string; status: string; resolution_note: string | null; created_at: string }[]>('/api/me/data-requests');
  const [p, setP] = useState<NonNullable<typeof prefs.data> | null>(null);
  useEffect(() => {
    if (prefs.data) setP(prefs.data);
  }, [prefs.data]);
  const savePrefs = useSubmit(async () => {
    await api.put('/api/me/preferences', p);
    toast('Tercihleriniz kaydedildi.');
  });
  const [dr, setDr] = useState({ request_type: 'access', details: '' });
  const sendReq = useSubmit(async () => {
    await api.post('/api/me/data-requests', dr);
    toast('Başvurunuz alındı.');
    setDr({ request_type: 'access', details: '' });
    reqs.reload();
  });
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delAck, setDelAck] = useState(false);
  const del = useSubmit(async () => {
    const r = await api.post<{ graceDays: number }>('/api/me/delete-account', { password: delPw });
    setDelOpen(false);
    toast(`Hesap silme talebiniz alındı. ${r.graceDays} gün içinde geri alabilirsiniz.`);
    await refresh();
  });
  const download = async () => {
    try {
      const data = await api.get('/api/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'koltuk-verilerim.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  if (!user) return null;
  const REQ_LABEL: Record<string, string> = { access: 'Bilgi talebi', correction: 'Düzeltme', deletion: 'Silme', objection: 'İtiraz', other: 'Diğer' };
  return (
    <div className="stack">
      <PageHeader title="Hesap ve gizlilik" />
      {user.account_status === 'deletion_requested' && (
        <Alert tone="warning" title="Hesabınız silinmek üzere">
          Silme talebiniz işleme alındı. Bekleme süresi dolmadan vazgeçebilirsiniz.{' '}
          <button type="button" className="link-btn" onClick={async () => { await api.post('/api/me/delete-account/cancel'); await refresh(); toast('Silme talebiniz geri alındı.'); }}>Talebi geri al</button>
        </Alert>
      )}
      <Card>
        <h2 className="card-title">Bildirim tercihleri</h2>
        {!p ? <Spinner /> : (
          <div className="stack-sm">
            <p className="small muted" style={{ margin: 0 }}>Hizmet bildirimleri randevularınızla ilgilidir (onay, iptal, hatırlatma). Pazarlama izinleri bunlardan ayrıdır.</p>
            <Switch label="Randevu bildirimleri — e-posta" checked={p.email_service} onChange={(v) => setP({ ...p, email_service: v })} />
            <Switch label="Randevu bildirimleri — SMS" checked={p.sms_service} onChange={(v) => setP({ ...p, sms_service: v })} />
            <Switch label="Randevu hatırlatmaları" checked={p.reminders} onChange={(v) => setP({ ...p, reminders: v })} />
            {p.reminders && (
              <Select label="Hatırlatma zamanı" value={String(p.reminder_hours)} onChange={(e) => setP({ ...p, reminder_hours: Number(e.target.value) })}>
                {[2, 6, 12, 24, 48].map((h) => <option key={h} value={h}>{h} saat önce</option>)}
              </Select>
            )}
            <div className="divider" />
            <h3 className="small" style={{ fontWeight: 650, margin: 0 }}>Pazarlama izinleri (ticari elektronik ileti)</h3>
            <Switch label="Kampanya e-postaları" checked={p.marketing_email} onChange={(v) => setP({ ...p, marketing_email: v })} />
            <Switch label="Kampanya SMS'leri" checked={p.marketing_sms} onChange={(v) => setP({ ...p, marketing_sms: v })} />
            <div className="form-actions"><Button busy={savePrefs.busy} onClick={() => savePrefs.run()}>Tercihleri kaydet</Button></div>
          </div>
        )}
      </Card>
      <Card>
        <h2 className="card-title">Verilerim (KVKK)</h2>
        <p className="small muted">6698 sayılı KVKK kapsamında verilerinize erişebilir, düzeltilmesini veya silinmesini talep edebilirsiniz. <Link to="/kvkk" style={{ color: 'var(--green)' }}>Aydınlatma metni</Link></p>
        <div className="row" style={{ marginBottom: 16 }}>
          <Button variant="secondary" onClick={download}><IconDownload size={16} /> Verilerimi indir (JSON)</Button>
        </div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); sendReq.run(); }}>
          <div className="form-grid">
            <Select label="Başvuru türü" value={dr.request_type} onChange={(e) => setDr({ ...dr, request_type: e.target.value })}>
              <option value="access">İşlenen verilerim hakkında bilgi</option>
              <option value="correction">Verilerimin düzeltilmesi</option>
              <option value="objection">İşlemeye itiraz</option>
              <option value="other">Diğer</option>
            </Select>
            <div />
            <div className="span-2"><TextArea label="Açıklama" value={dr.details} onChange={(e) => setDr({ ...dr, details: e.target.value })} error={sendReq.fields.details} rows={3} maxLength={2000} /></div>
          </div>
          {sendReq.error && !Object.keys(sendReq.fields).length && <Alert tone="error">{sendReq.error}</Alert>}
          <div className="form-actions"><Button type="submit" variant="secondary" busy={sendReq.busy}>Başvuru gönder</Button></div>
        </form>
        {reqs.data && reqs.data.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead><tr><th>Tarih</th><th>Tür</th><th>Durum</th><th>Sonuç</th></tr></thead>
              <tbody>
                {reqs.data.map((r) => (
                  <tr key={r.id}><td className="nowrap">{formatDate(r.created_at, undefined, { weekday: undefined })}</td><td>{REQ_LABEL[r.request_type]}</td><td><Badge tone={r.status === 'completed' ? 'green' : r.status === 'rejected' ? 'neutral' : 'amber'}>{{ open: 'Açık', in_progress: 'İnceleniyor', completed: 'Tamamlandı', rejected: 'Kapatıldı' }[r.status]}</Badge></td><td className="small">{r.resolution_note ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <h2 className="card-title">Hesabı sil</h2>
        <p className="small muted">Hesabınız silindiğinde kişisel bilgileriniz anonimleştirilir, gelecekteki randevularınız iptal edilir. Geçmiş randevu kayıtları işletmelerin yasal yükümlülükleri için kimliğinizden ayrılarak saklanabilir.</p>
        <div className="row">
          <Button variant="danger" onClick={() => setDelOpen(true)} disabled={user.account_status === 'deletion_requested'}>Hesabımı sil</Button>
          <Button variant="ghost" onClick={async () => { await logout(); navigate('/'); }}>Çıkış yap</Button>
        </div>
      </Card>
      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Hesabı sil" size="sm" footer={<><Button variant="ghost" onClick={() => setDelOpen(false)}>Vazgeç</Button><Button variant="danger" busy={del.busy} disabled={!delAck || !delPw} onClick={() => del.run()}>Hesabımı sil</Button></>}>
        <div className="stack">
          <Alert tone="warning">Bekleme süresi sonunda bu işlem geri alınamaz.</Alert>
          <TextInput label="Şifreniz" type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} error={del.fields.password} />
          <Checkbox label="Gelecekteki randevularımın iptal edileceğini anlıyorum." checked={delAck} onChange={setDelAck} />
          {del.error && !del.fields.password && <Alert tone="error">{del.error}</Alert>}
        </div>
      </Modal>
    </div>
  );
}
