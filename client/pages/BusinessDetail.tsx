import { useState } from 'react';
import { Link, navigate } from '../lib/router.tsx';
import { api } from '../lib/api.ts';
import { useApi, useDocumentTitle } from '../lib/hooks.ts';
import { useAuth } from '../lib/auth.tsx';
import { BusinessVisual } from '../ui/brand.tsx';
import { Badge, Button, ButtonLink, Card, DemoBadge, ErrorState, Modal, Rating, Spinner, TextArea, useToast } from '../ui/index.tsx';
import { IconClock, IconExternal, IconFlag, IconHeart, IconHeartFilled, IconInfo, IconPhone, IconPin, IconShare, IconShield, IconStarFilled } from '../ui/icons.tsx';
import { BUSINESS_TYPE_LABEL, WEEKDAYS, type BusinessType } from '../../shared/constants.ts';
import { formatDate, formatDuration, formatPrice } from '../../shared/format.ts';
import { weekdayOfLocalDate } from '../../shared/time.ts';
import { todayLocal } from '../components/SearchPanel.tsx';

interface Detail {
  business: Record<string, any> & { id: string; name: string; slug: string; business_type: string; timezone: string };
  services: { id: string; name: string; description: string | null; duration_minutes: number; price_type: string; price_amount: string | null; price_max_amount: string | null; category: string | null; employee_ids: string[] }[];
  employees: { id: string; display_name: string; title: string | null; description: string | null; photo_url: string | null }[];
  hours: { weekday: number; opening_time: string; closing_time: string }[];
  photos: { id: string; url: string; caption: string | null }[];
  closures: { start_at: string; end_at: string; reason: string | null }[];
  reviews: { id: string; rating: number; comment: string | null; created_at: string; author: string; services: string | null; business_reply: string | null; edited_at: string | null }[];
  isFavorite: boolean;
}

export function ReportModal({ open, onClose, targetType, targetId }: { open: boolean; onClose: () => void; targetType: 'review' | 'business'; targetId: string }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={targetType === 'review' ? 'Yorumu bildir' : 'İşletmeyi bildir'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button
            busy={busy}
            disabled={reason.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await api.post('/api/reports', { target_type: targetType, target_id: targetId, reason });
                toast(r.message);
                setReason('');
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Gönder
          </Button>
        </>
      }
    >
      <TextArea label="Neden bildiriyorsunuz?" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={1000} error={err ?? undefined} hint="Örn. sahte işletme, uygunsuz içerik, yanıltıcı bilgi." />
    </Modal>
  );
}

export function BusinessDetail({ slug }: { slug: string }) {
  const { data, loading, error, reload } = useApi<Detail>(`/api/businesses/${slug}`);
  const { user } = useAuth();
  const toast = useToast();
  const [fav, setFav] = useState<boolean | null>(null);
  const [report, setReport] = useState<{ type: 'review' | 'business'; id: string } | null>(null);
  useDocumentTitle(data?.business.name);
  if (loading) return <Spinner />;
  if (error || !data) return <div className="container section"><ErrorState error={error} onRetry={reload} /></div>;
  const b = data.business;
  const isFav = fav ?? data.isFavorite;
  const todayWd = weekdayOfLocalDate(todayLocal());
  const groups = new Map<string, Detail['services']>();
  for (const s of data.services) {
    const k = s.category ?? 'Hizmetler';
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const bookUrl = `/randevu/${b.slug}`;
  const toggleFav = async () => {
    if (!user) return navigate(`/giris?next=${encodeURIComponent(location.pathname)}`);
    try {
      if (isFav) await api.del(`/api/me/favorites/${b.id}`);
      else await api.put(`/api/me/favorites/${b.id}`);
      setFav(!isFav);
      toast(isFav ? 'Favorilerden çıkarıldı.' : 'Favorilere eklendi.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: b.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Bağlantı kopyalandı.');
      }
    } catch {
      /* kullanıcı paylaşımı iptal etti */
    }
  };
  const mapSrc =
    b.latitude && b.longitude
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${b.longitude - 0.006},${b.latitude - 0.004},${b.longitude + 0.006},${b.latitude + 0.004}&layer=mapnik&marker=${b.latitude},${b.longitude}`
      : null;
  const hoursByDay = WEEKDAYS.map((name, wd) => ({ name, wd, ranges: data.hours.filter((h) => h.weekday === wd) }));

  return (
    <div className="container section-sm has-sticky-book">
      {b.is_demo && (
        <div className="demo-note" style={{ marginBottom: 16 }}>
          <IconInfo size={16} /> Bu bir <strong>örnek işletmedir</strong>. Bilgiler, fiyatlar ve değerlendirmeler demo amaçlıdır; gerçek bir işletmeyi temsil etmez.
        </div>
      )}
      <div className="biz-hero">
        <BusinessVisual name={b.name} type={b.business_type} url={b.cover_url} />
      </div>
      <div className="biz-head">
        <div className="biz-logo">
          <BusinessVisual name={b.name} type={b.business_type} url={b.logo_url} />
        </div>
        <div className="biz-head-text">
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            {b.is_demo ? <DemoBadge /> : <Badge tone="green"><IconShield size={13} /> Doğrulanmış işletme</Badge>}
            <Badge tone="beige">{BUSINESS_TYPE_LABEL[b.business_type as BusinessType]}</Badge>
            {b.open_now ? <Badge tone="green">Şu anda açık</Badge> : <Badge>Şu anda kapalı</Badge>}
          </div>
          <h1>{b.name}</h1>
          <div className="row muted small">
            <Rating value={b.rating} count={b.review_count} size="sm" />
            <span className="row" style={{ gap: 4 }}><IconPin size={15} /> {[b.neighborhood, b.district, b.city].filter(Boolean).join(', ')}</span>
          </div>
        </div>
        <div className="row">
          <Button variant="secondary" size="sm" onClick={toggleFav} aria-pressed={isFav}>
            {isFav ? <IconHeartFilled size={16} style={{ color: 'var(--danger)' }} /> : <IconHeart size={16} />} {isFav ? 'Favorilerde' : 'Favorilere ekle'}
          </Button>
          <Button variant="secondary" size="sm" onClick={share}>
            <IconShare size={16} /> Paylaş
          </Button>
        </div>
      </div>

      <div className="biz-layout">
        <div className="stack-lg">
          {b.description && (
            <Card>
              <h2 className="card-title">Hakkında</h2>
              <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{b.description}</p>
            </Card>
          )}
          <Card>
            <div className="row-between">
              <h2 className="card-title" style={{ margin: 0 }}>Hizmetler ve fiyatlar</h2>
              <ButtonLink to={bookUrl} size="sm">Randevu al</ButtonLink>
            </div>
            {data.services.length === 0 && <p className="muted">Bu işletme henüz hizmet eklemedi.</p>}
            {[...groups.entries()].map(([g, list]) => (
              <div key={g} className="service-group">
                {groups.size > 1 && <h3>{g}</h3>}
                {list.map((s) => (
                  <div key={s.id} className="service-row">
                    <div className="service-row-main">
                      <div className="service-row-name">{s.name}</div>
                      <div className="service-row-meta">
                        {formatDuration(s.duration_minutes)}
                        {s.description && ` · ${s.description}`}
                        {s.employee_ids.length === 0 && ' · Şu anda online randevuya kapalı'}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                      <span className="service-row-price">{formatPrice(s)}</span>
                      {s.employee_ids.length > 0 && (
                        <Link to={`${bookUrl}?s=${s.id}`} className="btn btn-secondary btn-sm" aria-label={`${s.name} için randevu al`}>
                          <span className="btn-label">Seç</span>
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <p className="muted xsmall" style={{ marginTop: 12, marginBottom: 0 }}>
              Fiyatlar işletme tarafından belirlenir. "Başlangıç fiyatı" ve "fiyat aralığı" olarak belirtilen hizmetlerde kesin tutar işlem sonrasında netleşir.
            </p>
          </Card>

          {data.employees.length > 0 && (
            <Card>
              <h2 className="card-title">Çalışanlar</h2>
              <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
                {data.employees.map((e) => (
                  <div key={e.id} className="employee-chip">
                    {e.photo_url ? <img src={e.photo_url} alt="" className="avatar" style={{ objectFit: 'cover' }} /> : <span className="avatar">{e.display_name.charAt(0)}</span>}
                    <div>
                      <strong className="small">{e.display_name}</strong>
                      {e.title && <div className="muted xsmall">{e.title}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {data.photos.length > 0 && (
            <Card>
              <h2 className="card-title">Fotoğraflar</h2>
              <div className="gallery">
                {data.photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.url} alt={p.caption ?? `${b.name} fotoğrafı`} loading="lazy" />
                  </a>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="row-between">
              <h2 className="card-title" style={{ margin: 0 }}>Değerlendirmeler</h2>
              {b.review_count > 0 && (
                <span className="row" style={{ gap: 6 }}>
                  <IconStarFilled size={20} style={{ color: '#b8862b' }} />
                  <strong style={{ fontSize: '1.3rem' }}>{String(b.rating).replace('.', ',')}</strong>
                  <span className="muted">/ 5 · {b.review_count} değerlendirme</span>
                </span>
              )}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Yalnızca bu işletmeden randevu alıp hizmeti tamamlayan müşteriler değerlendirme bırakabilir.</p>
            {data.reviews.length === 0 && <p className="muted">Henüz değerlendirme yok.</p>}
            {data.reviews.map((r) => (
              <div key={r.id} className="review">
                <div className="row-between">
                  <strong>{r.author}</strong>
                  <span className="muted xsmall">{formatDate(r.created_at, b.timezone, { weekday: undefined })}</span>
                </div>
                <div className="row" style={{ gap: 2, color: '#b8862b', margin: '4px 0' }} aria-label={`${r.rating} yıldız`}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <IconStarFilled key={i} size={14} style={{ opacity: i < r.rating ? 1 : 0.2 }} />
                  ))}
                  {r.services && <span className="muted xsmall" style={{ marginLeft: 8 }}>{r.services}</span>}
                </div>
                {r.comment && <p style={{ margin: '6px 0 0' }}>{r.comment}</p>}
                {r.business_reply && (
                  <div className="review-reply">
                    <strong className="small">İşletmenin yanıtı</strong>
                    <p style={{ margin: '4px 0 0' }}>{r.business_reply}</p>
                  </div>
                )}
                {user && (
                  <button type="button" className="link-btn xsmall" style={{ color: 'var(--muted)', marginTop: 8 }} onClick={() => setReport({ type: 'review', id: r.id })}>
                    Bildir
                  </button>
                )}
              </div>
            ))}
          </Card>
        </div>

        <aside className="biz-aside">
          <Card>
            <h2 className="card-title">Randevu</h2>
            {b.online_booking_enabled ? (
              <>
                <p className="muted small">{b.auto_confirm ? 'Randevular anında onaylanır.' : 'Randevu talepleri işletme onayıyla kesinleşir.'}</p>
                <ButtonLink to={bookUrl} block size="lg">Randevu al</ButtonLink>
              </>
            ) : (
              <p className="muted">Bu işletme şu anda online randevu kabul etmiyor. Lütfen telefonla iletişime geçin.</p>
            )}
            <div className="divider" />
            <h3 className="small" style={{ fontWeight: 650 }}>İptal politikası</h3>
            <p className="small muted" style={{ marginBottom: 0 }}>
              {b.cancellation_policy ?? `Randevunuzu başlangıçtan en az ${b.cancel_min_hours} saat önce iptal edebilirsiniz.`}
            </p>
          </Card>
          <Card>
            <h2 className="card-title row" style={{ gap: 8 }}><IconClock size={18} /> Çalışma saatleri</h2>
            <table className="hours-table">
              <tbody>
                {hoursByDay.map((d) => (
                  <tr key={d.wd} className={d.wd === todayWd ? 'today' : ''}>
                    <td>{d.name}</td>
                    <td>{d.ranges.length ? d.ranges.map((r) => `${r.opening_time}–${r.closing_time}`).join(', ') : 'Kapalı'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.closures.length > 0 && (
              <div className="alert alert-warning" style={{ marginTop: 12 }}>
                <IconInfo size={16} />
                <div className="small">
                  {data.closures.map((c, i) => (
                    <div key={i}>
                      {formatDate(c.start_at, b.timezone, { weekday: undefined })} – kapalı{c.reason ? ` (${c.reason})` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <Card>
            <h2 className="card-title">Konum ve iletişim</h2>
            {mapSrc ? (
              <iframe title={`${b.name} haritası`} className="map-frame" src={mapSrc} loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <p className="muted small">Harita konumu eklenmemiş.</p>
            )}
            <div className="stack-sm" style={{ marginTop: 12 }}>
              <span className="row small" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <IconPin size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {[b.address, b.neighborhood, b.district, b.city].filter(Boolean).join(', ')}
              </span>
              {b.latitude && (
                <a className="small row" style={{ gap: 6 }} href={`https://www.openstreetmap.org/directions?to=${b.latitude},${b.longitude}`} target="_blank" rel="noreferrer">
                  <IconExternal size={15} /> Yol tarifi al
                </a>
              )}
              {b.phone && (
                <a className="small row" style={{ gap: 6 }} href={`tel:${b.phone}`}>
                  <IconPhone size={15} /> {b.phone.replace(/^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/, '0$1 $2 $3 $4')}
                </a>
              )}
              {b.website && <a className="small" href={b.website} target="_blank" rel="noreferrer nofollow">{b.website.replace(/^https?:\/\//, '')}</a>}
              {b.instagram && <a className="small" href={`https://instagram.com/${b.instagram}`} target="_blank" rel="noreferrer nofollow">@{b.instagram}</a>}
            </div>
          </Card>
          {user && (
            <button type="button" className="link-btn small row" style={{ color: 'var(--muted)', gap: 6 }} onClick={() => setReport({ type: 'business', id: b.id })}>
              <IconFlag size={15} /> Bu işletmeyi bildir
            </button>
          )}
        </aside>
      </div>
      {b.online_booking_enabled && (
        <div className="sticky-book">
          <ButtonLink to={bookUrl} block size="lg">Randevu al</ButtonLink>
        </div>
      )}
      {report && <ReportModal open onClose={() => setReport(null)} targetType={report.type} targetId={report.id} />}
    </div>
  );
}
