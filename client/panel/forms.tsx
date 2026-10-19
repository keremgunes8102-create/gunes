// İşletme kurulum sihirbazı ve panel sayfalarında ortak kullanılan düzenleyiciler
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { useApi, useSubmit } from '../lib/hooks.ts';
import { BusinessVisual } from '../ui/brand.tsx';
import {
  Alert, Badge, Button, Card, Checkbox, EmptyState, ErrorState, Modal, Select, Spinner, Switch, TextArea, TextInput, cx, useConfirm, useToast,
} from '../ui/index.tsx';
import { IconChair, IconEdit, IconImage, IconPlus, IconTag, IconTrash, IconUsers } from '../ui/icons.tsx';
import {
  BUSINESS_TYPE_LABEL, BUSINESS_TYPES, PRICE_TYPE_LABEL, PRICE_TYPES, STATION_TYPE_LABEL, STATION_TYPES, TR_CITIES, WEEKDAYS,
} from '../../shared/constants.ts';
import { formatDuration, formatPrice } from '../../shared/format.ts';
import { usePanel } from './context.tsx';

type Interval = { start: string; end: string };
type DayIntervals = { weekday: number; intervals: Interval[] }[];

export const fromRows = (rows: { weekday: number; start: string; end: string }[]): DayIntervals =>
  WEEKDAYS.map((_, weekday) => ({ weekday, intervals: rows.filter((r) => r.weekday === weekday).map((r) => ({ start: r.start, end: r.end })) }));

/** Haftalık aralık düzenleyici (işletme saatleri, vardiyalar, molalar) */
export function WeekEditor({ value, onChange, defaultInterval = { start: '09:00', end: '18:00' }, allowMultiple = true, emptyLabel = 'Kapalı' }: { value: DayIntervals; onChange: (v: DayIntervals) => void; defaultInterval?: Interval; allowMultiple?: boolean; emptyLabel?: string }) {
  const setDay = (wd: number, intervals: Interval[]) => onChange(value.map((d) => (d.weekday === wd ? { ...d, intervals } : d)));
  const copyToAll = (wd: number) => {
    const src = value.find((d) => d.weekday === wd)!.intervals;
    onChange(value.map((d) => ({ ...d, intervals: d.weekday === 6 && wd !== 6 ? d.intervals : src.map((i) => ({ ...i })) })));
  };
  return (
    <div>
      {value.map((d) => {
        const open = d.intervals.length > 0;
        return (
          <div key={d.weekday} className="day-editor">
            <strong className="small">{WEEKDAYS[d.weekday]}</strong>
            <button type="button" role="switch" aria-checked={open} aria-label={`${WEEKDAYS[d.weekday]} ${open ? 'açık' : 'kapalı'}`} className={cx('switch', open && 'on')} onClick={() => setDay(d.weekday, open ? [] : [{ ...defaultInterval }])}>
              <span />
            </button>
            <div className="stack-sm">
              {!open && <span className="muted small">{emptyLabel}</span>}
              {d.intervals.map((iv, idx) => (
                <div key={idx} className="interval">
                  <input type="time" className="input" step={300} value={iv.start} aria-label={`${WEEKDAYS[d.weekday]} başlangıç`} onChange={(e) => setDay(d.weekday, d.intervals.map((x, i) => (i === idx ? { ...x, start: e.target.value } : x)))} />
                  <span className="muted">–</span>
                  <input type="time" className="input" step={300} value={iv.end} aria-label={`${WEEKDAYS[d.weekday]} bitiş`} onChange={(e) => setDay(d.weekday, d.intervals.map((x, i) => (i === idx ? { ...x, end: e.target.value } : x)))} />
                  {d.intervals.length > 1 && (
                    <button type="button" className="icon-btn" aria-label="Aralığı kaldır" onClick={() => setDay(d.weekday, d.intervals.filter((_, i) => i !== idx))}><IconTrash size={16} /></button>
                  )}
                </div>
              ))}
              {open && (
                <div className="row" style={{ gap: 4 }}>
                  {allowMultiple && d.intervals.length < 4 && (
                    <button type="button" className="link-btn xsmall" onClick={() => setDay(d.weekday, [...d.intervals, { start: d.intervals.at(-1)!.end, end: defaultInterval.end }])}>+ Aralık ekle</button>
                  )}
                  <button type="button" className="link-btn xsmall" style={{ marginLeft: 12, color: 'var(--muted)' }} onClick={() => copyToAll(d.weekday)}>Hafta içi ve Cumartesi'ye kopyala</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function InfoForm({ onSaved, submitLabel = 'Kaydet' }: { onSaved?: () => void; submitLabel?: string }) {
  const { bid, detail, reload } = usePanel();
  const b = detail.business;
  const { data: meta } = useApi<{ categories: { id: string; name: string; business_type: string }[] }>('/api/meta');
  const toast = useToast();
  const [f, setF] = useState({
    name: b.name, business_type: b.business_type, description: b.description ?? '', phone: b.phone ?? '', email: b.email ?? '', website: b.website ?? '', instagram: b.instagram ?? '', category_ids: detail.category_ids,
  });
  const s = useSubmit(async () => {
    await api.patch(`/api/panel/${bid}/info`, f);
    await reload();
    toast('İşletme bilgileri kaydedildi.');
    onSaved?.();
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }} noValidate>
      <BusinessInfoFields f={f} setF={setF} fields={s.fields} categories={meta?.categories ?? []} />
      {s.error && !Object.keys(s.fields).length && <Alert tone="error">{s.error}</Alert>}
      <div className="form-actions"><Button type="submit" busy={s.busy}>{submitLabel}</Button></div>
    </form>
  );
}

export function BusinessInfoFields({ f, setF, fields, categories }: { f: any; setF: (v: any) => void; fields: Record<string, string>; categories: { id: string; name: string; business_type: string }[] }) {
  const toggleCat = (id: string) => setF({ ...f, category_ids: f.category_ids.includes(id) ? f.category_ids.filter((x: string) => x !== id) : [...f.category_ids, id] });
  return (
    <div className="form-grid">
      <TextInput className="span-2" label="İşletme adı" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fields.name} maxLength={120} />
      <Select label="İşletme türü" value={f.business_type} onChange={(e) => setF({ ...f, business_type: e.target.value })} error={fields.business_type}>
        {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t]}</option>)}
      </Select>
      <TextInput label="İşletme telefonu" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={fields.phone} placeholder="0212 xxx xx xx" />
      {categories.length > 0 && (
        <div className="span-2 field">
          <span className="field-label">Hizmet kategorileri</span>
          <div className="pill-select">
            {categories.map((c) => (
              <button key={c.id} type="button" aria-pressed={f.category_ids.includes(c.id)} onClick={() => toggleCat(c.id)}>{c.name}</button>
            ))}
          </div>
          <p className="field-hint">İşletmeniz birden fazla kategoride hizmet veriyorsa hepsini seçin.</p>
        </div>
      )}
      <div className="span-2">
        <TextArea label="Kısa açıklama" optional value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} error={fields.description} maxLength={1000} rows={3} placeholder="Müşterilerinize işletmenizi birkaç cümleyle anlatın." />
      </div>
      <TextInput label="E-posta" optional type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={fields.email} />
      <TextInput label="Web sitesi" optional value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} error={fields.website} placeholder="ornek.com" />
      <TextInput label="Instagram" optional value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} error={fields.instagram} placeholder="@kullaniciadi" />
    </div>
  );
}

export function AddressForm({ onSaved, submitLabel = 'Kaydet' }: { onSaved?: () => void; submitLabel?: string }) {
  const { bid, detail, reload } = usePanel();
  const b = detail.business;
  const toast = useToast();
  const [f, setF] = useState({ city: b.city ?? 'İstanbul', district: b.district ?? '', neighborhood: b.neighborhood ?? '', address: b.address ?? '', latitude: b.latitude as number | null, longitude: b.longitude as number | null });
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const s = useSubmit(async () => {
    await api.patch(`/api/panel/${bid}/address`, f);
    await reload();
    toast('Adres kaydedildi.');
    onSaved?.();
  });
  const useGps = () => {
    if (!navigator.geolocation) return setGeoMsg('Tarayıcınız konum desteklemiyor.');
    setGeoMsg('Konum alınıyor… (işletmenizdeyken kullanın)');
    navigator.geolocation.getCurrentPosition(
      (p) => { setF({ ...f, latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) }); setGeoMsg('Konum alındı. Haritadan kontrol edin.'); },
      () => setGeoMsg('Konum izni verilmedi. Koordinatları elle girebilirsiniz.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const map = f.latitude && f.longitude ? `https://www.openstreetmap.org/export/embed.html?bbox=${f.longitude - 0.004},${f.latitude - 0.003},${f.longitude + 0.004},${f.latitude + 0.003}&layer=mapnik&marker=${f.latitude},${f.longitude}` : null;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }} noValidate>
      <div className="form-grid">
        <TextInput label="Ülke" value="Türkiye" disabled />
        <Select label="İl" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} error={fields(s).city}>
          {TR_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <TextInput label="İlçe" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} error={fields(s).district} />
        <TextInput label="Mahalle" optional value={f.neighborhood} onChange={(e) => setF({ ...f, neighborhood: e.target.value })} error={fields(s).neighborhood} />
        <div className="span-2"><TextArea label="Açık adres" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} error={fields(s).address} rows={2} maxLength={300} placeholder="Sokak, bina no, kat" /></div>
      </div>
      <Card>
        <div className="row-between">
          <div>
            <strong>Harita konumu</strong>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {b.location_verified ? <Badge tone="green">Konum doğrulandı</Badge> : <Badge tone="amber">Doğrulama bekliyor</Badge>}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={useGps}>Bulunduğum konumu kullan</Button>
        </div>
        {geoMsg && <p className="field-hint" role="status" style={{ marginTop: 8 }}>{geoMsg}</p>}
        <div className="form-grid" style={{ marginTop: 12 }}>
          <TextInput label="Enlem" inputMode="decimal" value={f.latitude ?? ''} onChange={(e) => setF({ ...f, latitude: e.target.value ? Number(e.target.value) : null })} error={fields(s).latitude} placeholder="41.0082" />
          <TextInput label="Boylam" inputMode="decimal" value={f.longitude ?? ''} onChange={(e) => setF({ ...f, longitude: e.target.value ? Number(e.target.value) : null })} error={fields(s).longitude} placeholder="28.9784" />
        </div>
        {map && <iframe title="Konum önizleme" className="map-frame" style={{ marginTop: 12 }} src={map} loading="lazy" />}
        <p className="field-hint" style={{ marginTop: 8 }}>Konum, platform ekibi tarafından doğrulanır. Konum değiştiğinde doğrulama yenilenir. Koordinatları OpenStreetMap veya harita uygulamanızdan kopyalayabilirsiniz.</p>
      </Card>
      {s.error && !Object.keys(s.fields).length && <Alert tone="error">{s.error}</Alert>}
      <div className="form-actions"><Button type="submit" busy={s.busy}>{submitLabel}</Button></div>
    </form>
  );
}
const fields = (s: { fields: Record<string, string> }) => s.fields;

export function HoursForm({ onSaved, submitLabel = 'Kaydet' }: { onSaved?: () => void; submitLabel?: string }) {
  const { bid, detail, reload } = usePanel();
  const toast = useToast();
  const initial = detail.hours.length ? fromRows(detail.hours) : WEEKDAYS.map((_, weekday) => ({ weekday, intervals: weekday < 6 ? [{ start: '09:00', end: '19:00' }] : [] }));
  const [days, setDays] = useState<DayIntervals>(initial);
  const s = useSubmit(async () => {
    await api.put(`/api/panel/${bid}/hours`, { days: days.filter((d) => d.intervals.length) });
    await reload();
    toast('Çalışma saatleri kaydedildi.');
    onSaved?.();
  });
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>Öğle arası gibi kapalı olduğunuz saatler için aynı güne ikinci bir aralık ekleyin. Çalışanların vardiyaları bu saatlerin dışına taşamaz.</p>
      <WeekEditor value={days} onChange={setDays} />
      {s.error && <Alert tone="error">{s.error}</Alert>}
      <div className="form-actions"><Button busy={s.busy} onClick={() => s.run()}>{submitLabel}</Button></div>
    </div>
  );
}

export function ClosuresManager() {
  const { bid, isManager } = usePanel();
  const { data, loading, reload } = useApi<{ id: string; start_at: string; end_at: string; reason: string | null }[]>(`/api/panel/${bid}/closures`);
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState({ start_date: '', end_date: '', start_time: '', end_time: '', reason: '' });
  const [warn, setWarn] = useState<{ public_reference: string; start_at: string }[] | null>(null);
  const s = useSubmit(async () => {
    const r = await api.post(`/api/panel/${bid}/closures`, { ...f, end_date: f.end_date || f.start_date, start_time: f.start_time || undefined, end_time: f.end_time || undefined, reason: f.reason || null });
    toast('Kapalı zaman eklendi.');
    setWarn(r.affectedAppointments.length ? r.affectedAppointments : null);
    setF({ start_date: '', end_date: '', start_time: '', end_time: '', reason: '' });
    reload();
  });
  const fmt = (iso: string) => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(new Date(iso));
  return (
    <div className="stack">
      {isManager && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
          <div className="form-grid">
            <TextInput label="Başlangıç tarihi" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} error={s.fields.start_date} />
            <TextInput label="Bitiş tarihi" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} hint="Boş bırakılırsa tek gün" />
            <TextInput label="Başlangıç saati" type="time" optional value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} hint="Boşsa tüm gün" />
            <TextInput label="Bitiş saati" type="time" optional value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} />
            <TextInput className="span-2" label="Neden" optional value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Örn. Resmî tatil, tadilat" />
          </div>
          {s.error && <Alert tone="error">{s.error}</Alert>}
          <div className="form-actions"><Button type="submit" variant="secondary" busy={s.busy}><IconPlus size={16} /> Kapalı zaman ekle</Button></div>
        </form>
      )}
      {warn && <Alert tone="warning" title="Bu aralıkta aktif randevular var">{warn.map((w) => `${w.public_reference} (${fmt(w.start_at)})`).join(', ')} — müşterilerle iletişime geçip yeniden planlayın veya iptal edin.</Alert>}
      {loading ? <Spinner /> : !data?.length ? <p className="muted small">Planlanmış kapalı gün yok.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Başlangıç</th><th>Bitiş</th><th>Neden</th><th /></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="nowrap">{fmt(c.start_at)}</td><td className="nowrap">{fmt(c.end_at)}</td><td>{c.reason ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{isManager && <button type="button" className="icon-btn" aria-label="Sil" onClick={async () => { if ((await confirm({ title: 'Kapalı zamanı sil', message: 'Bu aralık yeniden randevuya açılacak.', confirmLabel: 'Sil', tone: 'danger' })).ok) { await api.del(`/api/panel/${bid}/closures/${c.id}`); reload(); } }}><IconTrash size={16} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- İstasyonlar ------------------------------------------------------------
interface Station { id: string; name: string; station_type: string; description: string | null; capacity: number; is_active: boolean; service_ids: string[] }
interface Service { id: string; name: string; description: string | null; category_id: string | null; duration_minutes: number; preparation_minutes: number; cleanup_minutes: number; price_type: string; price_amount: string | null; price_max_amount: string | null; photo_url: string | null; is_active: boolean; employee_ids: string[]; station_ids: string[] }
interface Employee { id: string; display_name: string; title: string | null; description: string | null; photo_url: string | null; is_active: boolean; accepts_bookings: boolean; user_id: string | null; service_ids: string[]; hours: { weekday: number; start: string; end: string }[]; breaks: { weekday: number; start: string; end: string }[]; upcoming_count: number }

export function StationsManager() {
  const { bid, reload: reloadPanel, isManager } = usePanel();
  const st = useApi<Station[]>(`/api/panel/${bid}/stations`);
  const sv = useApi<Service[]>(`/api/panel/${bid}/services`);
  const [edit, setEdit] = useState<Partial<Station> | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const s = useSubmit(async () => {
    if (!edit) return;
    const body = { name: edit.name ?? '', station_type: edit.station_type ?? 'chair', description: edit.description ?? null, capacity: Number(edit.capacity ?? 1), is_active: edit.is_active ?? true, service_ids: edit.service_ids ?? [] };
    if (edit.id) await api.put(`/api/panel/${bid}/stations/${edit.id}`, body);
    else await api.post(`/api/panel/${bid}/stations`, body);
    toast('İstasyon kaydedildi.');
    setEdit(null);
    st.reload();
    reloadPanel();
  });
  if (st.loading) return <Spinner />;
  if (st.error) return <ErrorState error={st.error} onRetry={st.reload} />;
  return (
    <div className="stack">
      <Alert tone="info">
        Koltuk ve istasyonlar <strong>isteğe bağlıdır</strong>. Bir hizmete istasyon bağlarsanız, o hizmet yalnızca bağlı istasyonlardan biri boşsa verilir (örn. tek boya istasyonu). Koltuk sayısı çalışan sayısı yerine geçmez: randevu için hem uygun çalışan hem uygun istasyon gerekir.
      </Alert>
      {isManager && <div><Button onClick={() => setEdit({ station_type: 'chair', capacity: 1, is_active: true, service_ids: [], name: `Koltuk ${(st.data?.length ?? 0) + 1}` })}><IconPlus size={16} /> İstasyon ekle</Button></div>}
      {!st.data?.length ? <EmptyState icon={<IconChair />} title="Henüz istasyon yok">İstasyon tanımlamazsanız kapasite yalnızca çalışanlara göre hesaplanır.</EmptyState> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ad</th><th>Tür</th><th>Kapasite</th><th>Bağlı hizmetler</th><th>Durum</th><th /></tr></thead>
            <tbody>
              {st.data.map((x) => (
                <tr key={x.id}>
                  <td><strong>{x.name}</strong>{x.description && <div className="muted xsmall">{x.description}</div>}</td>
                  <td>{STATION_TYPE_LABEL[x.station_type as keyof typeof STATION_TYPE_LABEL]}</td>
                  <td>{x.capacity}</td>
                  <td className="small">{x.service_ids.length ? sv.data?.filter((s) => x.service_ids.includes(s.id)).map((s) => s.name).join(', ') : <span className="muted">—</span>}</td>
                  <td>{x.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Pasif</Badge>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isManager && <>
                      <button type="button" className="icon-btn" aria-label={`${x.name} düzenle`} onClick={() => setEdit(x)}><IconEdit size={16} /></button>
                      <button type="button" className="icon-btn" aria-label={`${x.name} sil`} onClick={async () => {
                        if (!(await confirm({ title: 'İstasyonu kaldır', message: 'Geçmiş randevularda kullanılan istasyonlar silinmez, pasifleştirilir.', confirmLabel: 'Kaldır', tone: 'danger' })).ok) return;
                        const r = await api.del(`/api/panel/${bid}/stations/${x.id}`);
                        toast(r.deactivated ? 'İstasyon pasifleştirildi.' : 'İstasyon silindi.');
                        st.reload();
                      }}><IconTrash size={16} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'İstasyonu düzenle' : 'Yeni istasyon'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Vazgeç</Button><Button busy={s.busy} onClick={() => s.run()}>Kaydet</Button></>}>
        {edit && (
          <div className="stack">
            <div className="form-grid">
              <TextInput label="Ad" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={s.fields.name} />
              <Select label="Tür" value={edit.station_type} onChange={(e) => setEdit({ ...edit, station_type: e.target.value })}>
                {STATION_TYPES.map((t) => <option key={t} value={t}>{STATION_TYPE_LABEL[t]}</option>)}
              </Select>
              <TextInput label="Aynı anda kaç işlem?" type="number" min={1} max={20} value={edit.capacity ?? 1} onChange={(e) => setEdit({ ...edit, capacity: Number(e.target.value) })} error={s.fields.capacity} hint="Çoğu koltuk için 1." />
              <TextInput label="Açıklama" optional value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </div>
            <div className="field">
              <span className="field-label">Bu istasyonu gerektiren hizmetler</span>
              {!sv.data?.length ? <p className="field-hint">Önce hizmet ekleyin; hizmet düzenleme ekranından da bağlantı kurabilirsiniz.</p> : (
                <div className="pill-select">
                  {sv.data.map((x) => (
                    <button key={x.id} type="button" aria-pressed={(edit.service_ids ?? []).includes(x.id)} onClick={() => setEdit({ ...edit, service_ids: (edit.service_ids ?? []).includes(x.id) ? edit.service_ids!.filter((i) => i !== x.id) : [...(edit.service_ids ?? []), x.id] })}>{x.name}</button>
                  ))}
                </div>
              )}
            </div>
            <Switch label="Aktif" checked={edit.is_active ?? true} onChange={(v) => setEdit({ ...edit, is_active: v })} />
            {s.error && !Object.keys(s.fields).length && <Alert tone="error">{s.error}</Alert>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// --- Hizmetler --------------------------------------------------------------
export function ServicesManager() {
  const { bid, reload: reloadPanel, isManager, detail } = usePanel();
  const sv = useApi<Service[]>(`/api/panel/${bid}/services`);
  const emps = useApi<Employee[]>(`/api/panel/${bid}/employees`);
  const sts = useApi<Station[]>(`/api/panel/${bid}/stations`);
  const tpl = useApi<{ id: string; name: string; default_duration_minutes: number; category_id: string; category: string }[]>(`/api/panel/${bid}/service-templates`);
  const [edit, setEdit] = useState<Partial<Service> | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const s = useSubmit(async () => {
    if (!edit) return;
    const body = {
      name: edit.name ?? '', description: edit.description || null, category_id: edit.category_id ?? null,
      duration_minutes: Number(edit.duration_minutes), preparation_minutes: Number(edit.preparation_minutes ?? 0), cleanup_minutes: Number(edit.cleanup_minutes ?? 0),
      price_type: edit.price_type ?? 'fixed', price_amount: edit.price_amount === '' || edit.price_amount == null ? null : Number(edit.price_amount),
      price_max_amount: edit.price_max_amount === '' || edit.price_max_amount == null ? null : Number(edit.price_max_amount),
      is_active: edit.is_active ?? true, employee_ids: edit.employee_ids ?? [], station_ids: edit.station_ids ?? [], photo_url: edit.photo_url ?? null,
    };
    if (edit.id) await api.put(`/api/panel/${bid}/services/${edit.id}`, body);
    else await api.post(`/api/panel/${bid}/services`, body);
    toast(edit.id ? 'Hizmet güncellendi. Mevcut randevuların fiyatı değişmez.' : 'Hizmet eklendi.');
    setEdit(null);
    sv.reload();
    reloadPanel();
  });
  const activeEmps = emps.data?.filter((e) => e.is_active) ?? [];
  const newFrom = (t?: { name: string; default_duration_minutes: number; category_id: string }) =>
    setEdit({ name: t?.name ?? '', duration_minutes: t?.default_duration_minutes ?? 30, preparation_minutes: 0, cleanup_minutes: 0, price_type: 'fixed', price_amount: '', category_id: t?.category_id ?? detail.category_ids[0] ?? null, is_active: true, employee_ids: activeEmps.map((e) => e.id), station_ids: [] });
  const existingNames = new Set(sv.data?.map((x) => x.name));
  if (sv.loading) return <Spinner />;
  if (sv.error) return <ErrorState error={sv.error} onRetry={sv.reload} />;
  const toggle = (k: 'employee_ids' | 'station_ids', id: string) => {
    const cur = edit?.[k] ?? [];
    setEdit({ ...edit, [k]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  return (
    <div className="stack">
      {isManager && <div className="row"><Button onClick={() => newFrom()}><IconPlus size={16} /> Yeni hizmet</Button></div>}
      {isManager && tpl.data && tpl.data.some((t) => !existingNames.has(t.name)) && (
        <Card>
          <strong className="small">Hızlı ekle — hazır hizmet önerileri</strong>
          <p className="field-hint">Seçtiğinizde süre önerisi dolu gelir; fiyatı siz belirlersiniz.</p>
          <div className="pill-select" style={{ marginTop: 10 }}>
            {tpl.data.filter((t) => !existingNames.has(t.name)).map((t) => (
              <button key={t.id} type="button" aria-pressed={false} onClick={() => newFrom(t)}>+ {t.name}</button>
            ))}
          </div>
        </Card>
      )}
      {!sv.data?.length ? <EmptyState icon={<IconTag />} title="Henüz hizmet yok">Müşterilerin randevu alabilmesi için en az bir hizmet ve bu hizmeti veren bir çalışan gerekir.</EmptyState> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Hizmet</th><th>Süre</th><th>Fiyat</th><th>Çalışanlar</th><th>Durum</th><th /></tr></thead>
            <tbody>
              {sv.data.map((x) => (
                <tr key={x.id} style={{ opacity: x.is_active ? 1 : 0.6 }}>
                  <td><strong>{x.name}</strong>{x.station_ids.length > 0 && <div className="muted xsmall">İstasyon: {sts.data?.filter((s) => x.station_ids.includes(s.id)).map((s) => s.name).join(', ')}</div>}</td>
                  <td className="nowrap">{formatDuration(x.duration_minutes)}{(x.preparation_minutes > 0 || x.cleanup_minutes > 0) && <div className="muted xsmall">+{x.preparation_minutes} hazırlık / +{x.cleanup_minutes} temizlik</div>}</td>
                  <td className="nowrap">{formatPrice(x)}</td>
                  <td className="small">{x.employee_ids.length ? `${x.employee_ids.length} çalışan` : <Badge tone="amber">Atanmamış</Badge>}</td>
                  <td>{x.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Pasif</Badge>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isManager && <>
                      <button type="button" className="icon-btn" aria-label={`${x.name} düzenle`} onClick={() => setEdit({ ...x })}><IconEdit size={16} /></button>
                      <button type="button" className="icon-btn" aria-label={`${x.name} sil`} onClick={async () => {
                        if (!(await confirm({ title: 'Hizmeti kaldır', message: 'Geçmiş randevularda kullanılan hizmetler silinmez; pasifleştirilir ve yeni randevuya kapanır.', confirmLabel: 'Kaldır', tone: 'danger' })).ok) return;
                        const r = await api.del(`/api/panel/${bid}/services/${x.id}`);
                        toast(r.deactivated ? 'Hizmet pasifleştirildi.' : 'Hizmet silindi.');
                        sv.reload();
                        reloadPanel();
                      }}><IconTrash size={16} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal size="lg" open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Hizmeti düzenle' : 'Yeni hizmet'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Vazgeç</Button><Button busy={s.busy} onClick={() => s.run()}>Kaydet</Button></>}>
        {edit && (
          <div className="stack">
            {edit.id && <Alert tone="info">Fiyat veya süre değişikliği yalnızca yeni randevuları etkiler; mevcut randevular oluşturuldukları andaki bilgileri korur.</Alert>}
            <div className="form-grid">
              <TextInput className="span-2" label="Hizmet adı" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={s.fields.name} />
              <TextInput label="Süre (dakika)" type="number" min={5} max={600} step={5} value={edit.duration_minutes ?? ''} onChange={(e) => setEdit({ ...edit, duration_minutes: Number(e.target.value) })} error={s.fields.duration_minutes} />
              <Select label="Fiyat türü" value={edit.price_type} onChange={(e) => setEdit({ ...edit, price_type: e.target.value })}>
                {PRICE_TYPES.map((t) => <option key={t} value={t}>{PRICE_TYPE_LABEL[t]}</option>)}
              </Select>
              {edit.price_type !== 'consultation' && (
                <TextInput label={edit.price_type === 'range' ? 'En düşük fiyat (TL)' : edit.price_type === 'starting_from' ? 'Başlangıç fiyatı (TL)' : 'Fiyat (TL)'} type="number" min={0} step="0.01" inputMode="decimal" value={edit.price_amount ?? ''} onChange={(e) => setEdit({ ...edit, price_amount: e.target.value })} error={s.fields.price_amount} />
              )}
              {edit.price_type === 'range' && <TextInput label="En yüksek fiyat (TL)" type="number" min={0} step="0.01" value={edit.price_max_amount ?? ''} onChange={(e) => setEdit({ ...edit, price_max_amount: e.target.value })} error={s.fields.price_max_amount} />}
              <TextInput label="Hazırlık süresi (dk)" type="number" min={0} max={120} value={edit.preparation_minutes ?? 0} onChange={(e) => setEdit({ ...edit, preparation_minutes: Number(e.target.value) })} hint="Randevudan önce çalışanın meşgul olacağı süre" />
              <TextInput label="Temizlik / işlem sonrası (dk)" type="number" min={0} max={120} value={edit.cleanup_minutes ?? 0} onChange={(e) => setEdit({ ...edit, cleanup_minutes: Number(e.target.value) })} hint="Randevudan sonra yeni randevu verilmeyecek süre" />
              <div className="span-2"><TextArea label="Açıklama" optional rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={500} /></div>
            </div>
            <div className="field">
              <span className="field-label">Bu hizmeti verebilen çalışanlar</span>
              {!activeEmps.length ? <p className="field-hint">Henüz çalışan yok. Çalışan ekledikten sonra hizmeti atayabilirsiniz.</p> : (
                <div className="pill-select">{activeEmps.map((e) => <button key={e.id} type="button" aria-pressed={(edit.employee_ids ?? []).includes(e.id)} onClick={() => toggle('employee_ids', e.id)}>{e.display_name}</button>)}</div>
              )}
              {s.fields.employee_ids && <p className="field-error">{s.fields.employee_ids}</p>}
            </div>
            {(sts.data?.length ?? 0) > 0 && (
              <div className="field">
                <span className="field-label">Gerekli istasyon (isteğe bağlı)</span>
                <div className="pill-select">{sts.data!.filter((x) => x.is_active).map((x) => <button key={x.id} type="button" aria-pressed={(edit.station_ids ?? []).includes(x.id)} onClick={() => toggle('station_ids', x.id)}>{x.name}</button>)}</div>
                <p className="field-hint">Seçilirse hizmet yalnızca bu istasyonlardan biri boşken verilir.</p>
              </div>
            )}
            <Switch label="Aktif (online randevuya açık)" checked={edit.is_active ?? true} onChange={(v) => setEdit({ ...edit, is_active: v })} />
            {s.error && !Object.keys(s.fields).length && <Alert tone="error">{s.error}</Alert>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// --- Çalışanlar -------------------------------------------------------------
function TimeOffList({ employeeId }: { employeeId: string }) {
  const { bid } = usePanel();
  const { data, reload } = useApi<{ id: string; start_at: string; end_at: string; reason: string | null }[]>(`/api/panel/${bid}/employees/${employeeId}/time-off`);
  const [f, setF] = useState({ start_date: '', end_date: '', start_time: '', end_time: '', reason: '' });
  const [warn, setWarn] = useState<string | null>(null);
  const s = useSubmit(async () => {
    const r = await api.post(`/api/panel/${bid}/employees/${employeeId}/time-off`, { ...f, end_date: f.end_date || f.start_date, start_time: f.start_time || undefined, end_time: f.end_time || undefined, reason: f.reason || null });
    setWarn(r.affectedAppointments.length ? `Bu aralıkta ${r.affectedAppointments.length} aktif randevu var: ${r.affectedAppointments.map((a: { public_reference: string }) => a.public_reference).join(', ')}. Randevular sayfasından yeniden planlayın.` : null);
    setF({ start_date: '', end_date: '', start_time: '', end_time: '', reason: '' });
    reload();
  });
  const fmt = (iso: string) => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(new Date(iso));
  return (
    <div className="stack-sm">
      <div className="form-grid">
        <TextInput label="İzin başlangıcı" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} error={s.fields.start_date} />
        <TextInput label="İzin bitişi" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} hint="Boşsa tek gün" />
        <TextInput label="Başlangıç saati" type="time" optional value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} hint="Boşsa tüm gün" />
        <TextInput label="Bitiş saati" type="time" optional value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} />
      </div>
      <TextInput label="Not" optional value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Yıllık izin, doktor…" />
      {s.error && <Alert tone="error">{s.error}</Alert>}
      {warn && <Alert tone="warning">{warn}</Alert>}
      <div><Button size="sm" variant="secondary" busy={s.busy} onClick={() => s.run()} disabled={!f.start_date}>İzin ekle</Button></div>
      {data && data.length > 0 && (
        <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {data.map((t) => (
            <li key={t.id} className="row-between small" style={{ padding: '8px 12px', background: 'var(--bg)', borderRadius: 10 }}>
              <span>{fmt(t.start_at)} → {fmt(t.end_at)} {t.reason && <span className="muted">· {t.reason}</span>}</span>
              <button type="button" className="icon-btn" aria-label="İzni sil" onClick={async () => { await api.del(`/api/panel/${bid}/employees/${employeeId}/time-off/${t.id}`); reload(); }}><IconTrash size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EmployeesManager() {
  const { bid, reload: reloadPanel, isManager, detail } = usePanel();
  const emps = useApi<Employee[]>(`/api/panel/${bid}/employees`);
  const sv = useApi<Service[]>(`/api/panel/${bid}/services`);
  const [edit, setEdit] = useState<(Partial<Employee> & { hoursEd: DayIntervals; breaksEd: DayIntervals }) | null>(null);
  const [affected, setAffected] = useState<{ public_reference: string; start_at: string }[] | null>(null);
  const toast = useToast();
  const businessDefault = detail.hours.length ? fromRows(detail.hours) : WEEKDAYS.map((_, weekday) => ({ weekday, intervals: weekday < 6 ? [{ start: '09:00', end: '19:00' }] : [] }));
  const open = (e?: Employee) =>
    setEdit(
      e
        ? { ...e, hoursEd: fromRows(e.hours), breaksEd: fromRows(e.breaks) }
        : { display_name: '', title: '', is_active: true, accepts_bookings: true, service_ids: sv.data?.filter((s) => s.is_active).map((s) => s.id) ?? [], hoursEd: businessDefault.map((d) => ({ ...d, intervals: d.intervals.length ? [{ start: d.intervals[0].start, end: d.intervals.at(-1)!.end }] : [] })), breaksEd: WEEKDAYS.map((_, weekday) => ({ weekday, intervals: [] })) },
    );
  const s = useSubmit(async () => {
    if (!edit) return;
    const body = {
      display_name: edit.display_name ?? '', title: edit.title || null, description: edit.description || null, photo_url: edit.photo_url ?? null,
      is_active: edit.is_active ?? true, accepts_bookings: edit.accepts_bookings ?? true, service_ids: edit.service_ids ?? [],
      hours: edit.hoursEd.filter((d) => d.intervals.length), breaks: edit.breaksEd.filter((d) => d.intervals.length),
    };
    if (edit.id) {
      const r = await api.put(`/api/panel/${bid}/employees/${edit.id}`, body);
      if (r.futureAppointments?.length) setAffected(r.futureAppointments);
    } else await api.post(`/api/panel/${bid}/employees`, body);
    toast('Çalışan kaydedildi.');
    setEdit(null);
    emps.reload();
    reloadPanel();
  });
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadPhoto = async (file: File) => {
    setPhotoBusy(true);
    try {
      const r = await api.upload<{ url: string }>(`/api/panel/${bid}/uploads?purpose=employee`, file);
      setEdit((x) => (x ? { ...x, photo_url: r.url } : x));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPhotoBusy(false);
    }
  };
  if (emps.loading) return <Spinner />;
  if (emps.error) return <ErrorState error={emps.error} onRetry={emps.reload} />;
  const limit = Number(detail.plan.feature_limits.max_employees ?? 2);
  const activeCount = emps.data?.filter((e) => e.is_active).length ?? 0;
  return (
    <div className="stack">
      {isManager && (
        <div className="row">
          <Button onClick={() => open()} disabled={activeCount >= limit}><IconPlus size={16} /> Çalışan ekle</Button>
          <span className="muted small">{detail.plan.name} paketi: {activeCount}/{limit} aktif çalışan</span>
        </div>
      )}
      {affected && (
        <Alert tone="warning" title="Yeniden planlanması gereken randevular">
          Bu çalışanın {affected.length} gelecek randevusu var: {affected.map((a) => a.public_reference).join(', ')}. Randevular sayfasından başka çalışana taşıyabilir, yeni saat önerebilir veya iptal edebilirsiniz. Geçmiş randevular korunur.
        </Alert>
      )}
      {!emps.data?.length ? <EmptyState icon={<IconUsers />} title="Henüz çalışan yok">Randevu alınabilmesi için vardiyası ve hizmeti tanımlı en az bir çalışan gerekir. Kendinizi de çalışan olarak ekleyebilirsiniz.</EmptyState> : (
        <div className="grid-auto">
          {emps.data.map((e) => (
            <Card key={e.id} className="stack-sm">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                {e.photo_url ? <img src={e.photo_url} alt="" className="avatar" style={{ width: 48, height: 48, objectFit: 'cover' }} /> : <span className="avatar" style={{ width: 48, height: 48 }}>{e.display_name.charAt(0)}</span>}
                <div style={{ minWidth: 0 }}>
                  <strong className="ellipsis" style={{ display: 'block' }}>{e.display_name}</strong>
                  <span className="muted small">{e.title ?? 'Çalışan'}</span>
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {!e.is_active ? <Badge>Pasif</Badge> : e.accepts_bookings ? <Badge tone="green">Randevu alıyor</Badge> : <Badge tone="amber">Randevuya kapalı</Badge>}
                {e.user_id && <Badge tone="beige">Hesap bağlı</Badge>}
                {e.hours.length === 0 && e.is_active && <Badge tone="red">Vardiya yok</Badge>}
              </div>
              <div className="muted small">{e.service_ids.length} hizmet · {new Set(e.hours.map((h) => h.weekday)).size} gün · {e.upcoming_count} yaklaşan randevu</div>
              {isManager && <Button size="sm" variant="secondary" onClick={() => open(e)}><IconEdit size={15} /> Düzenle</Button>}
            </Card>
          ))}
        </div>
      )}
      <Modal size="lg" open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Çalışanı düzenle' : 'Yeni çalışan'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Vazgeç</Button><Button busy={s.busy} onClick={() => s.run()}>Kaydet</Button></>}>
        {edit && (
          <div className="stack-lg">
            <div className="stack">
              <div className="upload-box">
                <div className="upload-preview" style={{ borderRadius: '50%' }}>{edit.photo_url ? <img src={edit.photo_url} alt="" /> : <span className="avatar" style={{ width: '100%', height: '100%', fontSize: '1.6rem' }}>{(edit.display_name || '?').charAt(0)}</span>}</div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
                <Button variant="secondary" size="sm" busy={photoBusy} onClick={() => fileRef.current?.click()}><IconImage size={16} /> Fotoğraf yükle</Button>
                {edit.photo_url && <Button variant="ghost" size="sm" onClick={() => setEdit({ ...edit, photo_url: null })}>Kaldır</Button>}
              </div>
              <div className="form-grid">
                <TextInput label="Görünen ad" value={edit.display_name ?? ''} onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} error={s.fields.display_name} />
                <TextInput label="Unvan" optional value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Kıdemli berber, renk uzmanı…" />
                <div className="span-2"><TextArea label="Mesleki açıklama" optional rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={500} /></div>
              </div>
              <Switch label="Aktif" description="Pasifleştirilen çalışanın geçmiş randevuları korunur." checked={edit.is_active ?? true} onChange={(v) => setEdit({ ...edit, is_active: v })} />
              <Switch label="Online randevu alabilir" checked={edit.accepts_bookings ?? true} onChange={(v) => setEdit({ ...edit, accepts_bookings: v })} />
            </div>
            <div className="field">
              <span className="field-label">Yapabildiği hizmetler</span>
              {!sv.data?.length ? <p className="field-hint">Henüz hizmet yok; hizmet ekledikten sonra atayabilirsiniz.</p> : (
                <div className="pill-select">
                  {sv.data.filter((x) => x.is_active).map((x) => (
                    <button key={x.id} type="button" aria-pressed={(edit.service_ids ?? []).includes(x.id)} onClick={() => setEdit({ ...edit, service_ids: (edit.service_ids ?? []).includes(x.id) ? edit.service_ids!.filter((i) => i !== x.id) : [...(edit.service_ids ?? []), x.id] })}>{x.name}</button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="small" style={{ fontWeight: 650 }}>Vardiya saatleri</h3>
              <WeekEditor value={edit.hoursEd} onChange={(v) => setEdit({ ...edit, hoursEd: v })} emptyLabel="Çalışmıyor" />
            </div>
            <div>
              <h3 className="small" style={{ fontWeight: 650 }}>Molalar</h3>
              <WeekEditor value={edit.breaksEd} onChange={(v) => setEdit({ ...edit, breaksEd: v })} defaultInterval={{ start: '13:00', end: '14:00' }} emptyLabel="Mola yok" />
            </div>
            {edit.id && (
              <div>
                <h3 className="small" style={{ fontWeight: 650 }}>İzinler ve tatiller</h3>
                <TimeOffList employeeId={edit.id} />
              </div>
            )}
            {s.error && <Alert tone="error">{s.error}</Alert>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// --- Randevu tercihleri ------------------------------------------------------
export function SettingsForm({ onSaved, submitLabel = 'Kaydet' }: { onSaved?: () => void; submitLabel?: string }) {
  const { bid, detail, reload } = usePanel();
  const b = detail.business;
  const toast = useToast();
  const [f, setF] = useState({
    auto_confirm: b.auto_confirm, booking_window_days: b.booking_window_days, min_notice_minutes: b.min_notice_minutes, cancel_min_hours: b.cancel_min_hours,
    slot_interval_minutes: b.slot_interval_minutes, allow_employee_choice: b.allow_employee_choice, accept_new_customers: b.accept_new_customers,
    online_booking_enabled: b.online_booking_enabled, pending_expiry_minutes: b.pending_expiry_minutes, cancellation_policy: b.cancellation_policy ?? '', publication_status: b.publication_status,
  });
  const s = useSubmit(async () => {
    await api.put(`/api/panel/${bid}/settings`, { ...f, cancellation_policy: f.cancellation_policy || null });
    await reload();
    toast('Randevu tercihleri kaydedildi.');
    onSaved?.();
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
      <Card>
        <Switch label="Online randevu açık" description="Kapatırsanız müşteriler profilinizi görür ama online randevu alamaz." checked={f.online_booking_enabled} onChange={(v) => setF({ ...f, online_booking_enabled: v })} />
        <Switch label="Randevuları otomatik onayla" description="Kapalıysa her talebi siz onaylarsınız; onaylanmayan talepler süre sonunda düşer." checked={f.auto_confirm} onChange={(v) => setF({ ...f, auto_confirm: v })} />
        <Switch label="Müşteri çalışan seçebilsin" checked={f.allow_employee_choice} onChange={(v) => setF({ ...f, allow_employee_choice: v })} />
        <Switch label="Yeni müşteri kabul et" description="Kapalıysa yalnızca daha önce gelen müşteriler online randevu alabilir." checked={f.accept_new_customers} onChange={(v) => setF({ ...f, accept_new_customers: v })} />
        {b.verification_status === 'approved' && <Switch label="Profil yayında" description="Gizlerseniz aramalarda görünmezsiniz." checked={f.publication_status === 'published'} onChange={(v) => setF({ ...f, publication_status: v ? 'published' : 'hidden' })} />}
      </Card>
      <div className="form-grid">
        <Select label="Randevular kaç gün önceden alınabilir?" value={f.booking_window_days} onChange={(e) => setF({ ...f, booking_window_days: Number(e.target.value) })}>
          {[7, 14, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} gün</option>)}
        </Select>
        <Select label="En erken randevu" value={f.min_notice_minutes} onChange={(e) => setF({ ...f, min_notice_minutes: Number(e.target.value) })}>
          {[[0, 'Hemen'], [30, '30 dk sonra'], [60, '1 saat sonra'], [120, '2 saat sonra'], [240, '4 saat sonra'], [1440, '1 gün sonra']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select label="Ücretsiz iptal için asgari süre" value={f.cancel_min_hours} onChange={(e) => setF({ ...f, cancel_min_hours: Number(e.target.value) })}>
          {[0, 1, 2, 3, 6, 12, 24, 48].map((h) => <option key={h} value={h}>{h === 0 ? 'Başlangıca kadar' : `${h} saat önce`}</option>)}
        </Select>
        <Select label="Randevu saat aralıkları" value={f.slot_interval_minutes} onChange={(e) => setF({ ...f, slot_interval_minutes: Number(e.target.value) })} hint="Başlangıç saatleri bu adımlarla gösterilir (örn. 10:00, 10:15…)">
          {[5, 10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} dakikada bir</option>)}
        </Select>
        {!f.auto_confirm && (
          <Select label="Onay bekleme süresi" value={f.pending_expiry_minutes} onChange={(e) => setF({ ...f, pending_expiry_minutes: Number(e.target.value) })} hint="Bu süre içinde onaylanmayan talepler otomatik düşer ve saat yeniden açılır.">
            {[30, 60, 120, 240, 720, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} dk` : `${m / 60} saat`}</option>)}
          </Select>
        )}
        <div className="span-2"><TextArea label="İptal politikası metni" optional rows={3} maxLength={1000} value={f.cancellation_policy} onChange={(e) => setF({ ...f, cancellation_policy: e.target.value })} placeholder="Randevunuzu en geç 3 saat öncesine kadar ücretsiz iptal edebilirsiniz." hint="Randevu sırasında müşteriye gösterilir." /></div>
      </div>
      <Checkbox label="İşletme panelinden kendi müşterilerim için manuel randevu ekleyebilirim" checked disabled description="Telefonla veya salonda alınan randevuları takvimden ekleyebilirsiniz; bu özellik her zaman açıktır." onChange={() => {}} />
      {s.error && <Alert tone="error">{s.error}</Alert>}
      <div className="form-actions"><Button type="submit" busy={s.busy}>{submitLabel}</Button></div>
    </form>
  );
}

// --- Görseller --------------------------------------------------------------
export function BrandingManager() {
  const { bid, detail, reload } = usePanel();
  const b = detail.business;
  const toast = useToast();
  const photos = useApi<{ id: string; url: string; caption: string | null }[]>(`/api/panel/${bid}/photos`);
  const [busy, setBusy] = useState<string | null>(null);
  const refs = { logo: useRef<HTMLInputElement>(null), cover: useRef<HTMLInputElement>(null), gallery: useRef<HTMLInputElement>(null) };
  const upload = async (purpose: 'logo' | 'cover' | 'gallery', file: File) => {
    if (file.size > 5 * 1024 * 1024) return toast('Dosya en fazla 5 MB olabilir.', 'error');
    setBusy(purpose);
    try {
      await api.upload(`/api/panel/${bid}/uploads?purpose=${purpose}`, file);
      toast('Görsel yüklendi.');
      if (purpose === 'gallery') photos.reload();
      else await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {}, []);
  const input = (purpose: 'logo' | 'cover' | 'gallery') => (
    <input ref={refs[purpose]} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(purpose, f); }} />
  );
  return (
    <div className="stack">
      <div className="grid-2">
        <div className="field">
          <span className="field-label">Logo / profil fotoğrafı</span>
          <div className="upload-box">
            <div className="upload-preview"><BusinessVisual name={b.name} type={b.business_type} url={b.logo_url} /></div>
            {input('logo')}
            <div className="stack-sm">
              <Button size="sm" variant="secondary" busy={busy === 'logo'} onClick={() => refs.logo.current?.click()}>Yükle</Button>
              {b.logo_url && <Button size="sm" variant="ghost" onClick={async () => { await api.del(`/api/panel/${bid}/branding/logo`); reload(); }}>Kaldır</Button>}
            </div>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Kapak görseli</span>
          <div className="upload-box">
            <div className="upload-preview wide"><BusinessVisual name={b.name} type={b.business_type} url={b.cover_url} /></div>
            {input('cover')}
            <div className="stack-sm">
              <Button size="sm" variant="secondary" busy={busy === 'cover'} onClick={() => refs.cover.current?.click()}>Yükle</Button>
              {b.cover_url && <Button size="sm" variant="ghost" onClick={async () => { await api.del(`/api/panel/${bid}/branding/cover`); reload(); }}>Kaldır</Button>}
            </div>
          </div>
        </div>
      </div>
      <p className="field-hint">JPG, PNG veya WEBP; en fazla 5 MB. Fotoğraf yüklemezseniz zarif bir otomatik görsel kullanılır.</p>
      <div className="field">
        <div className="row-between">
          <span className="field-label">Fotoğraf galerisi</span>
          {input('gallery')}
          <Button size="sm" variant="secondary" busy={busy === 'gallery'} onClick={() => refs.gallery.current?.click()}><IconPlus size={15} /> Fotoğraf ekle</Button>
        </div>
        {!photos.data?.length ? <p className="field-hint">Salonunuzdan ve işlerinizden fotoğraflar ekleyin.</p> : (
          <div className="gallery">
            {photos.data.map((p) => (
              <div key={p.id} style={{ position: 'relative' }}>
                <img src={p.url} alt={p.caption ?? ''} />
                <button type="button" className="icon-btn" style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(255,255,255,.9)' }} aria-label="Fotoğrafı sil" onClick={async () => { await api.del(`/api/panel/${bid}/photos/${p.id}`); photos.reload(); }}><IconTrash size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
