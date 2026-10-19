import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router.tsx';
import { api, qs } from '../lib/api.ts';
import { useApi, useDocumentTitle, useSubmit } from '../lib/hooks.ts';
import { StatusBadge } from '../ui/brand.tsx';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Modal, PageHeader, Segmented, Select, Spinner, Stat, TextArea, TextInput, useConfirm, useToast } from '../ui/index.tsx';
import { IconChevronLeft, IconChevronRight, IconMessage, IconPlus, IconStarFilled } from '../ui/icons.tsx';
import { formatDate, formatTL, formatTime } from '../../shared/format.ts';
import { addDaysLocal, minutesOfDayOf, timeToMinutes, weekdayOfLocalDate } from '../../shared/time.ts';
import { MEMBER_ROLE_LABEL, WEEKDAYS_SHORT, type MemberRole } from '../../shared/constants.ts';
import { usePanel, RequireManager } from './context.tsx';
import { AppointmentModal, ManualAppointmentModal, todayIn } from './appointments.tsx';
import { BrandingManager, AddressForm, ClosuresManager, EmployeesManager, HoursForm, InfoForm, ServicesManager, SettingsForm, StationsManager } from './forms.tsx';
import type { Appointment } from '../types.ts';

export function Overview() {
  const { bid, detail, isManager, base } = usePanel();
  useDocumentTitle(`${detail.business.name} — panel`);
  const { data, loading, error, reload } = useApi<{ today: string; stats: Record<string, string | number | null>; pending: number; upcoming: Appointment[]; topServices: { name: string; n: number }[]; byEmployee: { name: string; n: number }[] }>(`/api/panel/${bid}/overview`);
  const [open, setOpen] = useState<string | null>(null);
  const zone = detail.business.timezone;
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const s = data.stats;
  const maxEmp = Math.max(1, ...data.byEmployee.map((e) => e.n));
  return (
    <div className="stack-lg">
      <PageHeader title="Genel bakış" description={formatDate(`${data.today}T12:00:00Z`, 'UTC')} actions={<ButtonLink to={`${base}/takvim`} variant="secondary">Takvimi aç</ButtonLink>} />
      {data.pending > 0 && <Alert tone="warning" title={`${data.pending} randevu talebi onay bekliyor`}><Link to={`${base}/randevular?durum=pending`} style={{ fontWeight: 600 }}>Talepleri incele →</Link></Alert>}
      <div className="stats-grid">
        <Stat label="Bugünkü randevular" value={s.today_total} />
        <Stat label="Tamamlanan" value={s.today_completed} />
        <Stat label="İptaller" value={s.today_cancelled} />
        <Stat label="Gelmedi" value={s.today_no_show} />
        {isManager && <Stat label="Günlük tahmini hizmet tutarı" value={formatTL(s.today_estimated as string)} hint="Onaylı + tamamlanan; tahsilat değildir" />}
      </div>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card>
          <h2 className="card-title">Yaklaşan randevular</h2>
          {!data.upcoming.length ? <p className="muted">Yaklaşan randevu yok.</p> : data.upcoming.map((a) => (
            <button key={a.id} type="button" className="list-item" style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(a.id)}>
              <div className="appt-date" style={{ width: 64, flexShrink: 0 }}><span>{new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: zone }).format(new Date(a.start_at))}</span><strong style={{ fontSize: '1.05rem' }}>{formatTime(a.start_at, zone)}</strong></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong className="ellipsis" style={{ display: 'block' }}>{a.customer_name}</strong>
                <span className="muted small ellipsis" style={{ display: 'block' }}>{a.services.map((x) => x.name).join(', ')} · {a.employee_name}</span>
              </div>
              <StatusBadge status={a.status} />
            </button>
          ))}
        </Card>
        <div className="stack">
          <Card>
            <h2 className="card-title">Bugün çalışan bazında</h2>
            {data.byEmployee.map((e) => (
              <div key={e.name} style={{ marginBottom: 10 }}>
                <div className="row-between small"><span>{e.name}</span><strong>{e.n}</strong></div>
                <div className="bar"><span style={{ width: `${(e.n / maxEmp) * 100}%` }} /></div>
              </div>
            ))}
          </Card>
          <Card>
            <h2 className="card-title">En çok seçilen hizmetler (30 gün)</h2>
            {!data.topServices.length ? <p className="muted small">Henüz veri yok.</p> : data.topServices.map((t) => (
              <div key={t.name} className="summary-row"><span>{t.name}</span><span>{t.n}</span></div>
            ))}
          </Card>
        </div>
      </div>
      {open && <AppointmentModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

interface CalData {
  date: string; days: number; timezone: string;
  employees: { id: string; display_name: string; hours: { weekday: number; start: string; end: string }[]; breaks: { weekday: number; start: string; end: string }[] }[];
  appointments: Appointment[];
  timeOff: { employee_id: string; start_at: string; end_at: string; reason: string | null }[];
  closures: { start_at: string; end_at: string }[];
  hours: { weekday: number; start: string; end: string }[];
}

const HOUR_PX = 48;

export function CalendarPage() {
  const { bid, detail, isManager } = usePanel();
  useDocumentTitle('Takvim');
  const zone = detail.business.timezone;
  const [date, setDate] = useState(todayIn(zone));
  const [view, setView] = useState<'day' | 'week' | 'list'>(window.innerWidth < 700 ? 'list' : 'day');
  const { data, loading, error, reload } = useApi<CalData>(`/api/panel/${bid}/calendar${qs({ date, view: view === 'week' ? 'week' : 'day' })}`);
  const [open, setOpen] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const range = useMemo(() => {
    const rows = data?.hours ?? detail.hours;
    const starts = rows.map((h) => timeToMinutes(h.start));
    const ends = rows.map((h) => timeToMinutes(h.end));
    const lo = starts.length ? Math.floor(Math.min(...starts) / 60) : 8;
    const hi = ends.length ? Math.ceil(Math.max(...ends) / 60) : 20;
    return { lo: Math.max(0, lo - 1), hi: Math.min(24, hi + 1) };
  }, [data, detail.hours]);

  const step = view === 'week' ? 7 : 1;
  const shift = (n: number) => setDate(addDaysLocal(date, n * step));
  const label = view === 'week' ? `${formatDate(`${date}T12:00:00Z`, 'UTC', { weekday: undefined, year: undefined })} – ${formatDate(`${addDaysLocal(date, 6)}T12:00:00Z`, 'UTC', { weekday: undefined })}` : formatDate(`${date}T12:00:00Z`, 'UTC');
  const cls = (s: string) => (s.startsWith('cancelled') || s === 'rejected' ? 'cancelled' : s);
  const minuteOf = (iso: string) => minutesOfDayOf(new Date(iso), zone);
  const top = (min: number) => ((min - range.lo * 60) / 60) * HOUR_PX;
  const hoursCount = range.hi - range.lo;

  // Sütunlar: gün görünümünde çalışanlar, hafta görünümünde günler
  const columns: { key: string; label: string; date: string; employeeId: string | null }[] =
    view === 'week'
      ? Array.from({ length: 7 }, (_, i) => {
          const d = addDaysLocal(date, i);
          return { key: d, label: `${WEEKDAYS_SHORT[weekdayOfLocalDate(d)]} ${Number(d.slice(8))}`, date: d, employeeId: null };
        })
      : (data?.employees ?? []).map((e) => ({ key: e.id, label: e.display_name, date, employeeId: e.id }));

  const offBlocks = (col: (typeof columns)[number]) => {
    if (!data) return [];
    const wd = weekdayOfLocalDate(col.date);
    const blocks: [number, number][] = [];
    const dayRows = col.employeeId ? data.employees.find((e) => e.id === col.employeeId)?.hours.filter((h) => h.weekday === wd) ?? [] : data.hours.filter((h) => h.weekday === wd);
    const open = dayRows.map((h) => [timeToMinutes(h.start), timeToMinutes(h.end)] as [number, number]).sort((a, b) => a[0] - b[0]);
    let cur = range.lo * 60;
    for (const [s, e] of open) { if (s > cur) blocks.push([cur, s]); cur = Math.max(cur, e); }
    if (cur < range.hi * 60) blocks.push([cur, range.hi * 60]);
    if (col.employeeId) {
      for (const b of data.employees.find((e) => e.id === col.employeeId)?.breaks.filter((h) => h.weekday === wd) ?? []) blocks.push([timeToMinutes(b.start), timeToMinutes(b.end)]);
      for (const t of data.timeOff.filter((t) => t.employee_id === col.employeeId)) {
        const s = new Date(t.start_at).toLocaleDateString('sv-SE', { timeZone: zone }) < col.date ? range.lo * 60 : minuteOf(t.start_at);
        const e = new Date(t.end_at).toLocaleDateString('sv-SE', { timeZone: zone }) > col.date ? range.hi * 60 : minuteOf(t.end_at);
        if (new Date(t.start_at).toLocaleDateString('sv-SE', { timeZone: zone }) <= col.date && new Date(t.end_at).toLocaleDateString('sv-SE', { timeZone: zone }) >= col.date) blocks.push([s, e]);
      }
    }
    for (const c of data.closures) {
      const sd = new Date(c.start_at).toLocaleDateString('sv-SE', { timeZone: zone });
      const ed = new Date(c.end_at).toLocaleDateString('sv-SE', { timeZone: zone });
      if (sd <= col.date && ed >= col.date) blocks.push([sd < col.date ? range.lo * 60 : minuteOf(c.start_at), ed > col.date ? range.hi * 60 : minuteOf(c.end_at)]);
    }
    return blocks;
  };
  const nowMin = minutesOfDayOf(new Date(), zone);
  const today = todayIn(zone);

  return (
    <div className="stack">
      <PageHeader title="Takvim" actions={isManager && <Button onClick={() => setManual(true)}><IconPlus size={16} /> Manuel randevu</Button>} />
      <div className="cal-toolbar">
        <Button variant="secondary" size="sm" onClick={() => setDate(todayIn(zone))}>Bugün</Button>
        <button type="button" className="icon-btn" aria-label="Önceki" onClick={() => shift(-1)}><IconChevronLeft /></button>
        <button type="button" className="icon-btn" aria-label="Sonraki" onClick={() => shift(1)}><IconChevronRight /></button>
        <strong style={{ textTransform: 'capitalize' }}>{label}</strong>
        <input type="date" className="input" style={{ width: 'auto', minHeight: 38, padding: '6px 10px' }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Tarihe git" />
        <div style={{ marginLeft: 'auto' }}>
          <Segmented label="Görünüm" value={view} onChange={setView} options={[{ value: 'day', label: 'Gün' }, { value: 'week', label: 'Hafta' }, { value: 'list', label: 'Liste' }]} />
        </div>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--green-50)', borderLeft: '3px solid var(--green)' }} /> Onaylı</span>
        <span><i style={{ background: 'var(--amber-50)' }} /> Onay bekliyor</span>
        <span><i style={{ background: '#ececea' }} /> Tamamlandı</span>
        <span><i style={{ background: 'var(--danger-50)' }} /> Gelmedi</span>
        <span><i style={{ background: 'repeating-linear-gradient(135deg,#f4f3ef,#f4f3ef 3px,#e6e5df 3px,#e6e5df 6px)' }} /> Kapalı / mola / izin</span>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Spinner /> : view === 'list' ? (
        !data.appointments.length ? <EmptyState title="Bu gün için randevu yok" /> : (
          <div className="stack-sm" style={{ opacity: loading ? 0.6 : 1 }}>
            {data.appointments.map((a) => (
              <button key={a.id} type="button" className="appt-card" style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => setOpen(a.id)}>
                <div className="appt-date"><strong style={{ fontSize: '1.1rem' }}>{formatTime(a.start_at, zone)}</strong><span>{formatTime(a.end_at, zone)}</span></div>
                <div style={{ minWidth: 0 }}><strong>{a.customer_name}</strong><div className="muted small ellipsis">{a.services.map((s) => s.name).join(', ')} · {a.employee_name}</div></div>
                <StatusBadge status={a.status} />
              </button>
            ))}
          </div>
        )
      ) : !columns.length ? (
        <EmptyState title="Takvimde gösterilecek çalışan yok">Önce çalışan ekleyin.</EmptyState>
      ) : (
        <div className="cal-scroll" style={{ opacity: loading ? 0.6 : 1 }}>
          <div className="cal-grid" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(${view === 'week' ? 110 : 150}px, 1fr))` }}>
            <div className="cal-colhead" />
            {columns.map((c) => <div key={c.key} className="cal-colhead" style={c.date === today && view === 'week' ? { color: 'var(--green)' } : undefined}>{c.label}</div>)}
            <div className="cal-times">
              {Array.from({ length: hoursCount }, (_, i) => <div key={i} className="cal-time">{String(range.lo + i).padStart(2, '0')}:00</div>)}
            </div>
            {columns.map((c) => {
              const appts = data.appointments.filter((a) => (c.employeeId ? a.employee_id === c.employeeId : new Date(a.start_at).toLocaleDateString('sv-SE', { timeZone: zone }) === c.date));
              return (
                <div key={c.key} className="cal-col" style={{ height: hoursCount * HOUR_PX }}>
                  {Array.from({ length: hoursCount }, (_, i) => <div key={i} className="cal-hourline" />)}
                  {offBlocks(c).map(([s, e], i) => <div key={i} className="cal-off" style={{ top: top(s), height: Math.max(0, top(e) - top(s)) }} />)}
                  {c.date === today && nowMin >= range.lo * 60 && nowMin <= range.hi * 60 && <div className="cal-now" style={{ top: top(nowMin) }} />}
                  {appts.map((a) => {
                    const s = minuteOf(a.start_at);
                    const e = minuteOf(a.end_at) || 24 * 60;
                    return (
                      <button key={a.id} type="button" className={`cal-appt ${cls(a.status)}`} style={{ top: top(s) + 1, height: Math.max(22, top(e) - top(s) - 2) }} onClick={() => setOpen(a.id)} title={`${a.customer_name} — ${a.services.map((x) => x.name).join(', ')}`}>
                        <strong>{formatTime(a.start_at, zone)}</strong> {a.customer_name}
                        <div className="muted" style={{ fontSize: '0.72rem' }}>{a.services.map((x) => x.name).join(', ')}{view === 'week' ? ` · ${a.employee_name}` : ''}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {open && <AppointmentModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
      <ManualAppointmentModal open={manual} onClose={() => setManual(false)} onCreated={reload} />
    </div>
  );
}

export function ReviewsPage() {
  const { bid, isManager, detail } = usePanel();
  useDocumentTitle('Yorumlar');
  const { data, loading, error, reload } = useApi<{ id: string; rating: number; comment: string | null; moderation_status: string; business_reply: string | null; created_at: string; author: string; public_reference: string; services: string }[]>(`/api/panel/${bid}/reviews`);
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  const toast = useToast();
  const s = useSubmit(async () => {
    if (!reply) return;
    await api.post(`/api/panel/${bid}/reviews/${reply.id}/reply`, { reply: reply.text });
    toast('Yanıtınız yayınlandı.');
    setReply(null);
    reload();
  });
  return (
    <div className="stack">
      <PageHeader title="Yorumlar" description="Yorumlar yalnızca tamamlanan randevulardan gelir. Uygunsuz bir yorumu platform ekibine bildirebilirsiniz." />
      {loading ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? <EmptyState icon={<IconMessage />} title="Henüz yorum yok" /> : data.map((r) => (
        <Card key={r.id}>
          <div className="row-between">
            <div className="row" style={{ gap: 2, color: '#b8862b' }}>{Array.from({ length: 5 }, (_, i) => <IconStarFilled key={i} size={15} style={{ opacity: i < r.rating ? 1 : 0.2 }} />)}<span className="muted small" style={{ marginLeft: 8, color: 'var(--muted)' }}>{r.author} · {r.services}</span></div>
            <div className="row" style={{ gap: 6 }}>{r.moderation_status === 'hidden' && <Badge tone="amber">Gizlendi</Badge>}<span className="muted xsmall">{formatDate(r.created_at, detail.business.timezone, { weekday: undefined })}</span></div>
          </div>
          {r.comment && <p style={{ margin: '8px 0 0' }}>{r.comment}</p>}
          {r.business_reply && <div className="review-reply"><strong className="small">Yanıtınız</strong><p style={{ margin: '4px 0 0' }}>{r.business_reply}</p></div>}
          {isManager && <Button size="sm" variant="ghost" style={{ marginTop: 8 }} onClick={() => setReply({ id: r.id, text: r.business_reply ?? '' })}>{r.business_reply ? 'Yanıtı düzenle' : 'Yanıtla'}</Button>}
        </Card>
      ))}
      <Modal open={Boolean(reply)} onClose={() => setReply(null)} title="Yoruma yanıt" footer={<><Button variant="ghost" onClick={() => setReply(null)}>Vazgeç</Button><Button busy={s.busy} onClick={() => s.run()}>Yayınla</Button></>}>
        {reply && <TextArea label="Yanıtınız (herkese açık)" rows={4} maxLength={1000} value={reply.text} onChange={(e) => setReply({ ...reply, text: e.target.value })} error={s.fields.reply ?? s.error ?? undefined} />}
      </Modal>
    </div>
  );
}

export function ReportsPage() {
  const { bid } = usePanel();
  useDocumentTitle('Raporlar');
  const today = todayIn();
  const [from, setFrom] = useState(addDaysLocal(today, -29));
  const [to, setTo] = useState(today);
  const { data, loading, error, reload } = useApi<{ daily: { day: string; booked: number; completed: number; cancelled: number; no_show: number; completed_amount: string }[]; totals: Record<string, number | string>; byService: { name: string; n: number; amount: string }[]; byEmployee: { name: string; n: number; completed: number; no_show: number; amount: string }[]; note: string }>(`/api/panel/${bid}/reports${qs({ from, to })}`);
  const maxDay = Math.max(1, ...(data?.daily.map((d) => d.booked + d.completed) ?? [1]));
  const t = data?.totals;
  return (
    <RequireManager>
      <div className="stack">
        <PageHeader title="Raporlar" actions={<div className="row"><TextInput label={<span className="sr-only">Başlangıç</span>} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><TextInput label={<span className="sr-only">Bitiş</span>} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>} />
        {loading && !data ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : data && t && (
          <>
            <Alert tone="info">{data.note}</Alert>
            <div className="stats-grid">
              <Stat label="Toplam randevu" value={t.total} />
              <Stat label="Tamamlanan" value={t.completed} />
              <Stat label="İptal" value={t.cancelled} hint={Number(t.total) ? `%${Math.round((Number(t.cancelled) / Number(t.total)) * 100)}` : undefined} />
              <Stat label="Gelmedi" value={t.no_show} />
              <Stat label="Online" value={t.online} />
              <Stat label="Tamamlanan hizmet tutarı" value={formatTL(t.completed_amount as string)} />
            </div>
            <Card>
              <h2 className="card-title">Günlük randevular</h2>
              {!data.daily.length ? <p className="muted">Bu aralıkta randevu yok.</p> : (
                <>
                  <div className="bar-chart" role="img" aria-label="Günlük randevu sayıları">
                    {data.daily.map((d) => <div key={d.day} className="b" style={{ height: `${((d.booked + d.completed) / maxDay) * 100}%` }} title={`${d.day}: ${d.booked + d.completed} randevu`} />)}
                  </div>
                  <div className="bar-chart-labels">{data.daily.map((d, i) => <span key={d.day}>{i % Math.ceil(data.daily.length / 8) === 0 ? d.day.slice(5).split('-').reverse().join('.') : ''}</span>)}</div>
                </>
              )}
            </Card>
            <div className="grid-2" style={{ alignItems: 'start' }}>
              <Card>
                <h2 className="card-title">Hizmetlere göre</h2>
                {data.byService.map((s) => <div key={s.name} className="summary-row"><span>{s.name}</span><span>{s.n} · {formatTL(s.amount)}</span></div>)}
                {!data.byService.length && <p className="muted small">Veri yok.</p>}
              </Card>
              <Card>
                <h2 className="card-title">Çalışanlara göre</h2>
                <div className="table-wrap" style={{ border: 0 }}>
                  <table className="table">
                    <thead><tr><th>Çalışan</th><th>Randevu</th><th>Tamam.</th><th>Gelmedi</th><th>Tutar</th></tr></thead>
                    <tbody>{data.byEmployee.map((e) => <tr key={e.name}><td>{e.name}</td><td>{e.n}</td><td>{e.completed}</td><td>{e.no_show}</td><td className="nowrap">{formatTL(e.amount)}</td></tr>)}</tbody>
                  </table>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </RequireManager>
  );
}

export function SubscriptionPage() {
  const { bid } = usePanel();
  useDocumentTitle('Paket ve abonelik');
  const { data, loading, error } = useApi<{ current: { name: string; code: string; status: string; started_at: string; feature_limits: Record<string, unknown> } | null; plans: { id: string; code: string; name: string; description: string; price_amount: string; features: string[] }[]; paymentsConfigured: boolean }>(`/api/panel/${bid}/subscription`);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} />;
  return (
    <RequireManager>
      <div className="stack">
        <PageHeader title="Paket ve abonelik" />
        {!data.paymentsConfigured && <Alert tone="warning" title="Ödeme altyapısı yapılandırılmadı">Şu anda online ödeme alınamıyor; paket yükseltme talepleriniz için platform ekibiyle iletişime geçin. Hiçbir ödeme alınmış gibi gösterilmez.</Alert>}
        <Card>
          <div className="row-between">
            <div><span className="muted small">Mevcut paket</span><h2 style={{ margin: 0 }}>{data.current?.name ?? 'Ücretsiz'}</h2></div>
            <Badge tone="green">{data.current?.status === 'active' ? 'Aktif' : data.current?.status ?? 'Aktif'}</Badge>
          </div>
          {data.current && <p className="muted small" style={{ marginBottom: 0 }}>Başlangıç: {formatDate(data.current.started_at, undefined, { weekday: undefined })} · En fazla {String(data.current.feature_limits.max_employees)} çalışan, {String(data.current.feature_limits.max_services)} hizmet</p>}
        </Card>
        <div className="grid-3">
          {data.plans.map((p) => (
            <Card key={p.id} className="stack-sm">
              <div className="row-between"><h3 style={{ margin: 0 }}>{p.name}</h3>{data.current?.code === p.code && <Badge tone="green">Mevcut</Badge>}</div>
              <p className="muted small">{p.description}</p>
              <strong>{Number(p.price_amount) > 0 ? `${formatTL(p.price_amount)} / ay` : p.code === 'free' ? formatTL(0) : 'Fiyat yakında'}</strong>
              <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
              {data.current?.code !== p.code && <Button variant="secondary" size="sm" disabled title="Ödeme altyapısı bağlandığında aktifleşir">Yükselt (yakında)</Button>}
            </Card>
          ))}
        </div>
      </div>
    </RequireManager>
  );
}

export function TeamPage() {
  const { bid, isOwner } = usePanel();
  useDocumentTitle('Ekip ve yetkiler');
  const members = useApi<{ id: string; role: MemberRole; invitation_status: string; invite_email: string | null; full_name: string | null; email: string | null; employee_name: string | null; invite_expires_at: string | null }[]>(`/api/panel/${bid}/members`);
  const emps = useApi<{ id: string; display_name: string; user_id: string | null; is_active: boolean }[]>(`/api/panel/${bid}/employees`);
  const [f, setF] = useState({ email: '', role: 'staff', employee_id: '' });
  const [link, setLink] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const s = useSubmit(async () => {
    const r = await api.post(`/api/panel/${bid}/members/invite`, { ...f, employee_id: f.employee_id || null });
    setLink(`${location.origin}${r.inviteLink}`);
    setF({ email: '', role: 'staff', employee_id: '' });
    members.reload();
  });
  return (
    <RequireManager>
      <div className="stack">
        <PageHeader title="Ekip ve yetkiler" />
        <Card>
          <h2 className="card-title">Roller</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>İşletme sahibi:</strong> tüm yetkiler, ekip yönetimi, başvuru ve paket.</li>
            <li><strong>Yönetici:</strong> randevu, takvim, hizmet, çalışan, saat ve raporlar.</li>
            <li><strong>Çalışan:</strong> yalnızca kendi takvimini ve randevularını görür; tamamlandı / gelmedi işaretler. Müşteri telefonlarını ve ciroyu göremez.</li>
          </ul>
        </Card>
        {isOwner && (
          <Card>
            <h2 className="card-title">Ekibe davet et</h2>
            <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }}>
              <div className="form-grid">
                <TextInput label="E-posta" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={s.fields.email} />
                <Select label="Rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                  <option value="staff">Çalışan</option>
                  <option value="manager">Yönetici</option>
                </Select>
                <Select label="Bağlı çalışan kaydı" optional={f.role !== 'staff'} value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} error={s.fields.employee_id} hint="Çalışan, takvimde bu kaydın randevularını görür.">
                  <option value="">Seçin</option>
                  {emps.data?.filter((e) => e.is_active && !e.user_id).map((e) => <option key={e.id} value={e.id}>{e.display_name}</option>)}
                </Select>
              </div>
              {s.error && !Object.keys(s.fields).length && <Alert tone="error">{s.error}</Alert>}
              <div className="form-actions"><Button type="submit" busy={s.busy}>Davet oluştur</Button></div>
            </form>
            {link && (
              <Alert tone="success" title="Davet bağlantısı oluşturuldu">
                E-posta servisi yapılandırılmadıysa bu bağlantıyı davet ettiğiniz kişiye siz iletin (7 gün geçerli). Davet yalnızca bu e-posta adresiyle doğrulanmış hesapla kabul edilebilir.
                <div className="row" style={{ marginTop: 8 }}>
                  <code className="kbd" style={{ wordBreak: 'break-all' }}>{link}</code>
                  <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(link); toast('Bağlantı kopyalandı.'); }}>Kopyala</Button>
                </div>
              </Alert>
            )}
          </Card>
        )}
        {members.loading ? <Spinner /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Kişi</th><th>Rol</th><th>Çalışan kaydı</th><th>Durum</th><th /></tr></thead>
              <tbody>
                {members.data?.map((m) => (
                  <tr key={m.id}>
                    <td>{m.full_name ? <><strong>{m.full_name}</strong><div className="muted xsmall">{m.email}</div></> : <span className="muted">{m.invite_email}</span>}</td>
                    <td>{MEMBER_ROLE_LABEL[m.role]}</td>
                    <td>{m.employee_name ?? '—'}</td>
                    <td>{m.invitation_status === 'accepted' ? <Badge tone="green">Aktif</Badge> : <Badge tone="amber">Davet bekliyor</Badge>}</td>
                    <td style={{ textAlign: 'right' }}>{isOwner && m.role !== 'owner' && <Button size="sm" variant="ghost" onClick={async () => { if ((await confirm({ title: 'Erişimi kaldır', message: 'Bu kişinin işletme paneline erişimi kaldırılacak.', confirmLabel: 'Kaldır', tone: 'danger' })).ok) { await api.del(`/api/panel/${bid}/members/${m.id}`); members.reload(); } }}>Kaldır</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RequireManager>
  );
}

// Basit sarmalayıcı sayfalar
export const EmployeesPage = () => { useDocumentTitle('Çalışanlar'); return <RequireManager><PageHeader title="Çalışanlar" description="Vardiyalar, molalar, izinler ve hizmet yetkinlikleri." /><EmployeesManager /></RequireManager>; };
export const StationsPage = () => { useDocumentTitle('Koltuklar ve istasyonlar'); return <RequireManager><PageHeader title="Koltuklar ve istasyonlar" /><StationsManager /></RequireManager>; };
export const ServicesPage = () => { useDocumentTitle('Hizmetler ve fiyatlar'); return <RequireManager><PageHeader title="Hizmetler ve fiyatlar" /><ServicesManager /></RequireManager>; };
export const HoursPage = () => {
  useDocumentTitle('Çalışma saatleri');
  return (
    <RequireManager>
      <div className="stack">
        <PageHeader title="Çalışma saatleri" />
        <Card><HoursForm /></Card>
        <Card><h2 className="card-title">Özel tatil ve kapalı günler</h2><ClosuresManager /></Card>
      </div>
    </RequireManager>
  );
};
export const ProfilePanelPage = () => {
  useDocumentTitle('İşletme profili');
  return (
    <RequireManager>
      <div className="stack">
        <PageHeader title="İşletme profili" />
        <Card><h2 className="card-title">Görseller</h2><BrandingManager /></Card>
        <Card><h2 className="card-title">İşletme bilgileri</h2><InfoForm /></Card>
        <Card><h2 className="card-title">Adres ve konum</h2><AddressForm /></Card>
      </div>
    </RequireManager>
  );
};
export const SettingsPage = () => { useDocumentTitle('Randevu ayarları'); return <RequireManager><PageHeader title="Randevu ayarları" /><SettingsForm /></RequireManager>; };

