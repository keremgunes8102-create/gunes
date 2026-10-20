import { useEffect, useState } from 'react';
import { useSearchParams } from '../lib/router.tsx';
import { useApi, useDebounced, useDocumentTitle, useMediaQuery } from '../lib/hooks.ts';
import { qs } from '../lib/api.ts';
import { BusinessCard } from '../components/BusinessCard.tsx';
import { todayLocal } from '../components/SearchPanel.tsx';
import { Button, Checkbox, EmptyState, ErrorState, Select, Skeleton, TextInput } from '../ui/index.tsx';
import { IconFilter, IconNavigation, IconSearch, IconX } from '../ui/icons.tsx';
import { BUSINESS_TYPE_LABEL, BUSINESS_TYPE_PLURAL, BUSINESS_TYPES, TR_CITIES, type BusinessType } from '../../shared/constants.ts';
import type { SearchResult } from '../types.ts';

const SORTS: [string, string][] = [
  ['recommended', 'Önerilen'],
  ['nearest', 'Yakınımdakiler'],
  ['soonest', 'En yakın müsait saat'],
  ['rating', 'En yüksek puan'],
  ['price_asc', 'Fiyat: düşükten yükseğe'],
  ['most_reviewed', 'En çok değerlendirilenler'],
];
const KEYS = ['type', 'city', 'district', 'q', 'service', 'min_price', 'max_price', 'min_rating', 'date', 'time', 'employee_choice', 'open_now', 'lat', 'lng', 'max_km', 'sort', 'page'];

export function Explore({ presetType }: { presetType?: BusinessType }) {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const type = presetType ?? (get('type') as BusinessType | '');
  useDocumentTitle(type ? BUSINESS_TYPE_PLURAL[type] : 'Keşfet');
  const isMobile = useMediaQuery('(max-width: 960px)');
  const [showFilters, setShowFilters] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [text, setText] = useState(get('q'));
  const debounced = useDebounced(text, 350);
  useEffect(() => {
    if (debounced !== get('q')) setParams({ q: debounced, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query: Record<string, string> = {};
  for (const k of KEYS) if (get(k)) query[k] = get(k);
  if (presetType) query.type = presetType;
  const { data: meta } = useApi<{ cities: { city: string; districts: string[] | null }[] }>('/api/meta');
  const { data, loading, error, reload } = useApi<SearchResult>(`/api/businesses${qs(query)}`);
  const districts = meta?.cities.find((c) => c.city === get('city'))?.districts ?? [];
  const activeCount = KEYS.filter((k) => !['sort', 'page', 'lat', 'lng', 'q'].includes(k) && get(k)).length;

  const set = (k: string, v: string | null) => setParams({ [k]: v, page: null });
  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg('Tarayıcınız konum desteklemiyor.');
    setGeoMsg('Konum alınıyor…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setParams({ lat: p.coords.latitude.toFixed(4), lng: p.coords.longitude.toFixed(4), sort: 'nearest', page: null });
        setGeoMsg(null);
      },
      () => setGeoMsg('Konum izni verilmedi; şehir ve ilçe ile arayabilirsiniz.'),
      { timeout: 10_000 },
    );
  };
  const clearAll = () => {
    const reset: Record<string, null> = {};
    for (const k of KEYS) reset[k] = null;
    setText('');
    setParams(reset);
  };

  return (
    <div className="container section-sm">
      <div className="page-header">
        <div>
          <h1>{type ? BUSINESS_TYPE_PLURAL[type] : 'Keşfet'}</h1>
          <p className="page-desc">Hizmetleri karşılaştır, gerçek boş saatleri gör ve randevunu oluştur.</p>
        </div>
      </div>
      <div className="explore-layout">
        {isMobile && (
          <div className="row">
            <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} aria-controls="filters">
              <IconFilter size={16} /> Filtreler {activeCount > 0 && `(${activeCount})`}
            </Button>
            {activeCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <IconX size={16} /> Temizle
              </Button>
            )}
          </div>
        )}
        <aside id="filters" className={`filters ${isMobile && !showFilters ? 'collapsed' : ''}`} aria-label="Filtreler">
          <div className="row-between">
            <h3>Filtreler</h3>
            {activeCount > 0 && (
              <button type="button" className="link-btn small" onClick={clearAll}>
                Temizle
              </button>
            )}
          </div>
          <TextInput label="İşletme veya semt ara" value={text} onChange={(e) => setText(e.target.value)} placeholder="Örn. Moda" />
          {!presetType && (
            <Select label="İşletme türü" value={get('type')} onChange={(e) => set('type', e.target.value)}>
              <option value="">Hepsi</option>
              {BUSINESS_TYPES.map((t) => (
                <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t]}</option>
              ))}
            </Select>
          )}
          <Select label="Şehir" value={get('city')} onChange={(e) => setParams({ city: e.target.value, district: null, page: null })}>
            <option value="">Tüm şehirler</option>
            {TR_CITIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          {get('city') && (
            <Select label="İlçe" value={get('district')} onChange={(e) => set('district', e.target.value)} hint={districts.length ? undefined : 'Bu şehirde henüz yayında işletme yok.'}>
              <option value="">Tüm ilçeler</option>
              {districts.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          )}
          <div className="filter-group">
            <Button variant="secondary" size="sm" onClick={locate}>
              <IconNavigation size={16} /> Konumumu kullan
            </Button>
            {geoMsg && <span className="field-hint" role="status">{geoMsg}</span>}
            {get('lat') && (
              <Select label="Mesafe" value={get('max_km')} onChange={(e) => set('max_km', e.target.value)}>
                <option value="">Sınır yok</option>
                {['2', '5', '10', '25', '50'].map((k) => (
                  <option key={k} value={k}>{k} km içinde</option>
                ))}
              </Select>
            )}
          </div>
          <TextInput label="Hizmet" value={get('service')} onChange={(e) => set('service', e.target.value)} placeholder="Örn. Saç kesimi" />
          <div className="filter-group">
            <span className="field-label">Fiyat aralığı (TL)</span>
            <div className="price-range">
              <TextInput label={<span className="sr-only">En az</span>} type="number" min={0} inputMode="numeric" placeholder="En az" value={get('min_price')} onChange={(e) => set('min_price', e.target.value)} />
              <TextInput label={<span className="sr-only">En çok</span>} type="number" min={0} inputMode="numeric" placeholder="En çok" value={get('max_price')} onChange={(e) => set('max_price', e.target.value)} />
            </div>
          </div>
          <Select label="Puan" value={get('min_rating')} onChange={(e) => set('min_rating', e.target.value)}>
            <option value="">Hepsi</option>
            <option value="4.5">4,5 ve üzeri</option>
            <option value="4">4 ve üzeri</option>
            <option value="3">3 ve üzeri</option>
          </Select>
          <TextInput label="Tarih" type="date" min={todayLocal()} value={get('date')} onChange={(e) => set('date', e.target.value)} hint="Seçilen günde boş saati olanlar listelenir." />
          <TextInput label="Saat" type="time" step={900} value={get('time')} onChange={(e) => set('time', e.target.value)} hint="Bu saatten itibaren 2 saat içinde müsait olanlar." />
          <Checkbox label="Şu anda açık" checked={get('open_now') === '1'} onChange={(v) => set('open_now', v ? '1' : null)} />
          <Checkbox label="Çalışan seçilebilen işletmeler" checked={get('employee_choice') === '1'} onChange={(v) => set('employee_choice', v ? '1' : null)} />
        </aside>

        <section aria-live="polite" aria-busy={loading}>
          <div className="results-head">
            <span className="muted">{loading ? 'Aranıyor…' : data ? `${data.total} işletme bulundu` : ''}
              {data?.items.some((i) => i.placement) && <span className="ad-disclosure" title="Önerilen sıralamada ücretli paket kullanan işletmeler üstte gösterilir. “Sponsorlu” ve “Öne çıkan” etiketli kartlar reklamdır."> · Sıralamaya ücretli paketler etki eder</span>}
            </span>
            <label className="row small" style={{ gap: 8 }}>
              <span className="muted">Sırala</span>
              <select className="input select" style={{ width: 'auto', minHeight: 40, padding: '6px 36px 6px 12px' }} value={get('sort') || data?.sort || 'recommended'} onChange={(e) => {
                if (e.target.value === 'nearest' && !get('lat')) locate();
                else set('sort', e.target.value);
              }}>
                {SORTS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          {error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : loading && !data ? (
            <div className="grid-auto">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="card" style={{ overflow: 'hidden' }}>
                  <Skeleton h={170} r={0} />
                  <div style={{ padding: 18 }} className="stack-sm">
                    <Skeleton h={18} w="70%" />
                    <Skeleton h={14} w="50%" />
                  </div>
                </div>
              ))}
            </div>
          ) : data && data.items.length === 0 ? (
            <EmptyState icon={<IconSearch />} title="Sonuç bulunamadı" action={activeCount > 0 ? <Button variant="secondary" onClick={clearAll}>Filtreleri temizle</Button> : undefined}>
              {activeCount > 0 ? 'Seçtiğiniz filtrelere uyan işletme yok. Filtreleri genişletmeyi deneyin.' : 'Bu bölgede henüz yayında işletme yok.'}
            </EmptyState>
          ) : (
            <>
              <div className="grid-auto" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
                {data?.items.map((b) => (
                  <BusinessCard key={b.id} b={b} />
                ))}
              </div>
              {data && data.total > data.pageSize && (
                <nav className="pagination" aria-label="Sayfalar">
                  <Button variant="secondary" size="sm" disabled={data.page <= 1} onClick={() => setParams({ page: String(data.page - 1) }, false)}>
                    Önceki
                  </Button>
                  <span className="muted small">
                    Sayfa {data.page} / {Math.ceil(data.total / data.pageSize)}
                  </span>
                  <Button variant="secondary" size="sm" disabled={data.page * data.pageSize >= data.total} onClick={() => setParams({ page: String(data.page + 1) }, false)}>
                    Sonraki
                  </Button>
                </nav>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
