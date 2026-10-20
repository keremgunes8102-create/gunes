import { useState } from 'react';
import { Link, navigate } from '../lib/router.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { BusinessVisual } from '../ui/brand.tsx';
import { Badge, DemoBadge, Rating, useToast } from '../ui/index.tsx';
import { IconCalendar, IconHeart, IconHeartFilled, IconPin, IconShield } from '../ui/icons.tsx';
import { BUSINESS_TYPE_LABEL, type BusinessType } from '../../shared/constants.ts';
import { formatPrice, formatDuration } from '../../shared/format.ts';
import type { BizListItem } from '../types.ts';

export function nextSlotLabel(n: BizListItem['next_available']) {
  if (!n) return null;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  const day =
    n.date === today
      ? 'Bugün'
      : n.date === tomorrow
        ? 'Yarın'
        : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${n.date}T00:00:00Z`));
  return `${day} ${n.time}`;
}

export function BusinessCard({ b, favorite: initialFav = false }: { b: BizListItem; favorite?: boolean }) {
  const { user } = useAuth();
  const toast = useToast();
  const [fav, setFav] = useState(initialFav);
  const next = nextSlotLabel(b.next_available);
  const toggleFav = async () => {
    if (!user) {
      navigate(`/giris?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    try {
      if (fav) await api.del(`/api/me/favorites/${b.id}`);
      else await api.put(`/api/me/favorites/${b.id}`);
      setFav(!fav);
      toast(fav ? 'Favorilerden çıkarıldı.' : 'Favorilere eklendi.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <article className="biz-card">
      <div className="biz-card-media">
        <BusinessVisual name={b.name} type={b.business_type} url={b.cover_url} />
        <div className="biz-card-badges">
          {b.is_demo ? <DemoBadge /> : <Badge tone="green"><IconShield size={13} /> Doğrulanmış</Badge>}
          {b.placement === 'sponsored' && <span className="badge badge-ad" title="Bu işletme ücretli Vitrin paketiyle üst sırada gösteriliyor.">Sponsorlu</span>}
          {b.placement !== 'sponsored' && (b.plan_level ?? 0) >= 3 && <span className="badge badge-ad" title="Bu işletme ücretli paketle öne çıkarılıyor.">Öne çıkan</span>}
        </div>
        <button type="button" className={`icon-btn biz-card-fav ${fav ? 'on' : ''}`} onClick={toggleFav} aria-pressed={fav} aria-label={fav ? `${b.name} favorilerden çıkar` : `${b.name} favorilere ekle`} style={{ zIndex: 2 }}>
          {fav ? <IconHeartFilled size={18} /> : <IconHeart size={18} />}
        </button>
      </div>
      <div className="biz-card-body">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <h3 className="biz-card-title">
            <Link to={`/isletme/${b.slug}`}>{b.name}</Link>
          </h3>
        </div>
        <div className="biz-card-meta">
          <span>{BUSINESS_TYPE_LABEL[b.business_type as BusinessType]}</span>
          <span>
            <IconPin size={14} /> {[b.district, b.city].filter(Boolean).join(', ')}
            {b.distance_km !== null && ` · ${String(b.distance_km).replace('.', ',')} km`}
          </span>
        </div>
        <Rating value={b.rating} count={b.review_count} size="sm" />
        {b.sample_services && b.sample_services.length > 0 && (
          <div className="biz-card-services">
            {b.sample_services.map((s) => (
              <div key={s.name}>
                <span>
                  {s.name} <span className="muted">· {formatDuration(s.duration_minutes)}</span>
                </span>
                <span className="nowrap">{formatPrice(s)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="biz-card-foot">
          {next ? (
            <span className="next-slot">
              <IconCalendar size={15} /> {next}
            </span>
          ) : (
            <span className="next-slot none">{b.online_booking_enabled ? 'Yakın tarihte boş saat yok' : 'Online randevu kapalı'}</span>
          )}
          <Link to={`/randevu/${b.slug}`} className="btn btn-primary btn-sm">
            <span className="btn-label">Randevu al</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
