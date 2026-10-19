import { useEffect, useState } from 'react';
import { api, newKey, qs } from '../lib/api.ts';
import { useApi, useSubmit } from '../lib/hooks.ts';
import { useSearchParams } from '../lib/router.tsx';
import { StatusBadge } from '../ui/brand.tsx';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, Select, Skeleton, Spinner, TextArea, TextInput, cx, useConfirm, useToast } from '../ui/index.tsx';
import { IconCalendar, IconPlus, IconSearch } from '../ui/icons.tsx';
import { formatDate, formatDateTime, formatDuration, formatTime } from '../../shared/format.ts';
import { APPOINTMENT_STATUS_LABEL } from '../../shared/constants.ts';
import { usePanel } from './context.tsx';
import { priceText } from '../pages/Account.tsx';
import type { Appointment } from '../types.ts';

const tz = 'Europe/Istanbul';
export const todayIn = (zone = tz) => new Date().toLocaleDateString('sv-SE', { timeZone: zone });

interface Svc { id: string; name: string; is_active: boolean; employee_ids: string[]; duration_minutes: number }
interface Emp { id: string; display_name: string; is_active: boolean; accepts_bookings: boolean }

/** Panelden boş saat seçici (manuel randevu, saat değiştirme, öneri) */
function SlotPicker({ serviceIds, employeeId, setEmployeeId, value, onChange, exclude, employees }: { serviceIds: string[]; employeeId: string; setEmployeeId: (v: string) => void; value: string | null; onChange: (v: string | null) => void; exclude?: string; employees: Emp[] }) {
  const { bid } = usePanel();
  const [date, setDate] = useState(todayIn());
  const slots = useApi<{ slots: { time: string; startAt: string; employeeIds: string[] }[]; eligibleEmployeeIds: string[] }>(
    serviceIds.length ? `/api/panel/${bid}/slots${qs({ services: serviceIds.join(','), date, employee: employeeId, exclude })}` : null,
  );
  useEffect(() => onChange(null), [date, employeeId, serviceIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const eligible = employees.filter((e) => !slots.data || slots.data.eligibleEmployeeIds.includes(e.id));
  return (
    <div className="stack-sm">
      <div className="form-grid">
        <TextInput label="Tarih" type="date" min={todayIn()} value={date} onChange={(e) => setDate(e.target.value)} />
        <Select label="Çalışan" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Fark etmez (uygun olan)</option>
          {eligible.map((e) => <option key={e.id} value={e.id}>{e.display_name}</option>)}
        </Select>
      </div>
      {!serviceIds.length ? <p className="field-hint">Önce hizmet seçin.</p> : slots.loading ? (
        <div className="slot-grid">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h={44} r={12} />)}</div>
      ) : slots.error ? <Alert tone="error">{slots.error.message}</Alert> : !slots.data?.slots.length ? (
        <p className="muted small">Bu gün için uygun saat yok.</p>
      ) : (
        <div className="slot-grid">
          {slots.data.slots.map((s) => (
            <button key={s.startAt} type="button" className={cx('slot', value === s.startAt && 'selected')} aria-pressed={value === s.startAt} onClick={() => onChange(s.startAt)}>{s.time}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ManualAppointmentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { bid } = usePanel();
  const sv = useApi<Svc[]>(open ? `/api/panel/${bid}/services` : null);
  const em = useApi<Emp[]>(open ? `/api/panel/${bid}/employees` : null);
  const toast = useToast();
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [startAt, setStartAt] = useState<string | null>(null);
  const [cust, setCust] = useState({ customer_name: '', customer_phone: '', customer_note: '' });
  const [key, setKey] = useState(newKey);
  const s = useSubmit(async () => {
    const r = await api.post(`/api/panel/${bid}/appointments`, { service_ids: serviceIds, employee_id: employeeId || null, start_at: startAt, ...cust, customer_phone: cust.customer_phone || null, customer_note: cust.customer_note || null, idempotency_key: key });
    toast(`Randevu eklendi (${r.public_reference}).`);
    setServiceIds([]); setStartAt(null); setCust({ customer_name: '', customer_phone: '', customer_note: '' }); setKey(newKey());
    onCreated();
    onClose();
  });
  const activeSvcs = sv.data?.filter((x) => x.is_active && x.employee_ids.length) ?? [];
  return (
    <Modal size="lg" open={open} onClose={onClose} title="Manuel randevu ekle" footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button busy={s.busy} disabled={!startAt || !cust.customer_name} onClick={() => s.run()}>Randevuyu ekle</Button></>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Telefonla veya salonda alınan randevular için. Manuel randevular doğrudan onaylı başlar ve çakışma kontrolünden geçer.</p>
        <div className="form-grid">
          <TextInput label="Müşteri adı" value={cust.customer_name} onChange={(e) => setCust({ ...cust, customer_name: e.target.value })} error={s.fields.customer_name} />
          <TextInput label="Telefon" optional type="tel" value={cust.customer_phone} onChange={(e) => setCust({ ...cust, customer_phone: e.target.value })} error={s.fields.customer_phone} />
        </div>
        <div className="field">
          <span className="field-label">Hizmetler</span>
          {sv.loading ? <Spinner /> : (
            <div className="pill-select">
              {activeSvcs.map((x) => <button key={x.id} type="button" aria-pressed={serviceIds.includes(x.id)} onClick={() => setServiceIds(serviceIds.includes(x.id) ? serviceIds.filter((i) => i !== x.id) : [...serviceIds, x.id])}>{x.name} · {formatDuration(x.duration_minutes)}</button>)}
            </div>
          )}
        </div>
        <SlotPicker serviceIds={serviceIds} employeeId={employeeId} setEmployeeId={setEmployeeId} value={startAt} onChange={setStartAt} employees={(em.data ?? []).filter((e) => e.is_active)} />
        <TextArea label="Not" optional rows={2} value={cust.customer_note} onChange={(e) => setCust({ ...cust, customer_note: e.target.value })} />
        {s.error && !Object.keys(s.fields).length && <Alert tone="error">{s.error}</Alert>}
      </div>
    </Modal>
  );
}

function MoveModal({ appt, mode, onClose, onDone }: { appt: Appointment; mode: 'reschedule' | 'propose'; onClose: () => void; onDone: () => void }) {
  const { bid } = usePanel();
  const em = useApi<Emp[]>(`/api/panel/${bid}/employees`);
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [startAt, setStartAt] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const serviceIds = appt.services.map((s) => s.service_id).filter(Boolean) as string[];
  const s = useSubmit(async () => {
    if (mode === 'reschedule') {
      await api.post(`/api/panel/${bid}/appointments/${appt.id}/reschedule`, { start_at: startAt, employee_id: employeeId || null });
      toast('Randevu taşındı; müşteri bilgilendirildi.');
    } else {
      // Öneri için çalışan zorunlu: seçilmediyse mevcut çalışan
      await api.post(`/api/panel/${bid}/appointments/${appt.id}/propose`, { start_at: startAt, employee_id: employeeId || appt.employee_id, note: note || null });
      toast('Yeni saat önerisi müşteriye gönderildi.');
    }
    onDone();
    onClose();
  });
  return (
    <Modal size="lg" open onClose={onClose} title={mode === 'reschedule' ? 'Saati değiştir' : 'Müşteriye yeni saat öner'} footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button busy={s.busy} disabled={!startAt} onClick={() => s.run()}>{mode === 'reschedule' ? 'Taşı' : 'Öneriyi gönder'}</Button></>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          {mode === 'reschedule' ? 'Randevu doğrudan yeni saate taşınır ve müşteri bilgilendirilir. Fiyat değişmez.' : 'Müşteri öneriyi kabul ederse randevu taşınır. Kabul anında müsaitlik tekrar kontrol edilir.'}
        </p>
        <SlotPicker serviceIds={serviceIds} employeeId={employeeId} setEmployeeId={setEmployeeId} value={startAt} onChange={setStartAt} exclude={appt.id} employees={(em.data ?? []).filter((e) => e.is_active && e.accepts_bookings)} />
        {mode === 'propose' && <TextInput label="Not" optional value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Örn. Sabah saatlerimiz doldu" />}
        {s.error && <Alert tone="error">{s.error}</Alert>}
      </div>
    </Modal>
  );
}

export function AppointmentModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { bid, isManager, detail } = usePanel();
  const { data: a, loading, error, reload } = useApi<Appointment & { events: { event_type: string; from_status: string | null; to_status: string | null; note: string | null; created_at: string; actor: string | null }[] }>(`/api/panel/${bid}/appointments/${id}`);
  const confirm = useConfirm();
  const toast = useToast();
  const [move, setMove] = useState<'reschedule' | 'propose' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const zone = detail.business.timezone;
  const act = async (action: string, opts: { title: string; message: string; label: string; danger?: boolean; reason?: boolean }) => {
    const r = await confirm({ title: opts.title, message: opts.message, confirmLabel: opts.label, tone: opts.danger ? 'danger' : 'primary', reason: opts.reason ? { label: 'Gerekçe (müşteriye iletilir)', placeholder: 'İsteğe bağlı' } : undefined });
    if (!r.ok) return;
    try {
      await api.post(`/api/panel/${bid}/appointments/${id}/status`, { action, reason: r.reason || null });
      toast('Randevu güncellendi.');
      reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const started = a ? new Date(a.start_at).getTime() <= Date.now() : false;
  const active = a && ['pending', 'confirmed'].includes(a.status);
  return (
    <Modal size="lg" open onClose={onClose} title={a ? `Randevu ${a.public_reference}` : 'Randevu'}>
      {loading ? <Spinner /> : error || !a ? <ErrorState error={error} /> : (
        <div className="stack">
          <div className="row"><StatusBadge status={a.status} />{a.source === 'manual' && <Badge tone="beige">Manuel</Badge>}{a.open_proposal && <Badge tone="amber">Saat önerisi bekliyor</Badge>}</div>
          <div className="grid-2">
            <div>
              <div className="summary-row"><span>Müşteri</span><span>{a.customer_name ?? '—'}</span></div>
              {a.customer_phone && <div className="summary-row"><span>Telefon</span><span><a href={`tel:${a.customer_phone}`}>{a.customer_phone}</a></span></div>}
              <div className="summary-row"><span>Tarih</span><span>{formatDate(a.start_at, zone)}</span></div>
              <div className="summary-row"><span>Saat</span><span>{formatTime(a.start_at, zone)} – {formatTime(a.end_at, zone)}</span></div>
            </div>
            <div>
              <div className="summary-row"><span>Hizmet</span><span>{a.services.map((s) => s.name).join(', ')}</span></div>
              <div className="summary-row"><span>Çalışan</span><span>{a.employee_name}</span></div>
              {a.station_name && <div className="summary-row"><span>İstasyon</span><span>{a.station_name}</span></div>}
              <div className="summary-row"><span>Tahmini tutar</span><span>{priceText(a)}</span></div>
            </div>
          </div>
          {a.customer_note && <Alert tone="info" title="Müşteri notu">{a.customer_note}</Alert>}
          {a.cancellation_reason && <Alert tone="warning" title="İptal / ret gerekçesi">{a.cancellation_reason}</Alert>}
          {a.status === 'pending' && a.pending_expires_at && <Alert tone="warning">Bu talep {formatDateTime(a.pending_expires_at, zone)} tarihine kadar onaylanmazsa otomatik düşer.</Alert>}
          <div className="row">
            {a.status === 'pending' && <Button onClick={() => act('confirm', { title: 'Randevuyu onayla', message: 'Müşteriye onay bildirimi gönderilecek.', label: 'Onayla' })}>Onayla</Button>}
            {a.status === 'pending' && <Button variant="secondary" onClick={() => act('reject', { title: 'Talebi reddet', message: 'Saat yeniden müsait olacak.', label: 'Reddet', danger: true, reason: true })}>Reddet</Button>}
            {a.status === 'confirmed' && started && <Button onClick={() => act('complete', { title: 'Tamamlandı olarak işaretle', message: 'Müşteri bu randevu için değerlendirme bırakabilecek.', label: 'Tamamlandı' })}>Tamamlandı</Button>}
            {a.status === 'confirmed' && started && <Button variant="secondary" onClick={() => act('no_show', { title: 'Gelmedi olarak işaretle', message: 'Müşteri randevuya gelmedi.', label: 'Gelmedi', danger: true })}>Gelmedi</Button>}
            {active && isManager && <Button variant="secondary" onClick={() => setMove('reschedule')}>Saati değiştir</Button>}
            {active && isManager && a.customer_user_id && <Button variant="secondary" onClick={() => setMove('propose')}>Yeni saat öner</Button>}
            {active && isManager && <Button variant="ghost" onClick={() => act('cancel_business', { title: 'Randevuyu iptal et', message: 'Müşteri bilgilendirilecek ve saat yeniden açılacak.', label: 'İptal et', danger: true, reason: true })}>İptal et</Button>}
          </div>
          {isManager && (
            <div className="stack-sm">
              <TextArea label="İşletme içi not" optional rows={2} value={note ?? a.business_note ?? ''} onChange={(e) => setNote(e.target.value)} hint="Yalnızca ekibiniz görür." />
              {note !== null && note !== (a.business_note ?? '') && <div><Button size="sm" variant="secondary" onClick={async () => { await api.patch(`/api/panel/${bid}/appointments/${id}/note`, { business_note: note || null }); toast('Not kaydedildi.'); reload(); setNote(null); }}>Notu kaydet</Button></div>}
            </div>
          )}
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>İşlem geçmişi ({a.events.length})</summary>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {a.events.map((e, i) => (
                <li key={i}>{formatDateTime(e.created_at, zone)} — {e.event_type === 'created' ? 'Oluşturuldu' : e.event_type === 'status_change' ? `${APPOINTMENT_STATUS_LABEL[e.from_status as keyof typeof APPOINTMENT_STATUS_LABEL] ?? '—'} → ${APPOINTMENT_STATUS_LABEL[e.to_status as keyof typeof APPOINTMENT_STATUS_LABEL] ?? '—'}` : e.event_type.startsWith('rescheduled') ? 'Saat değiştirildi' : e.event_type === 'proposal_accepted' ? 'Öneri kabul edildi' : e.event_type}{e.actor ? ` (${e.actor})` : ''}{e.note && e.event_type === 'status_change' ? ` — ${e.note}` : ''}</li>
              ))}
            </ul>
          </details>
          {move && <MoveModal appt={a} mode={move} onClose={() => setMove(null)} onDone={() => { reload(); onChanged(); }} />}
        </div>
      )}
    </Modal>
  );
}

export function AppointmentsPage() {
  const { bid, isManager, detail } = usePanel();
  const [params, setParams] = useSearchParams();
  const status = params.get('durum') ?? 'active';
  const [q, setQ] = useState('');
  const ref = params.get('ref');
  const { data, loading, error, reload } = useApi<Appointment[]>(`/api/panel/${bid}/appointments${qs({ status: status === 'all' ? '' : status, ref, q: q.length > 1 ? q : '' })}`);
  const [openId, setOpenId] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (ref && data?.length === 1) setOpenId(data[0].id);
  }, [ref, data]);
  const zone = detail.business.timezone;
  return (
    <div className="stack">
      <PageHeader title="Randevular" actions={isManager && <Button onClick={() => setManual(true)}><IconPlus size={16} /> Manuel randevu</Button>} />
      <div className="row-between">
        <div className="segmented" role="radiogroup" aria-label="Durum">
          {[['active', 'Aktif'], ['pending', 'Onay bekleyen'], ['completed', 'Tamamlanan'], ['cancelled', 'İptal / ret'], ['no_show', 'Gelmedi'], ['all', 'Tümü']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={status === v} className={status === v ? 'active' : ''} onClick={() => setParams({ durum: v, ref: null })}>{l}</button>
          ))}
        </div>
        <div style={{ position: 'relative', width: 260, maxWidth: '100%' }}>
          <input className="input" placeholder="Müşteri adı ara" aria-label="Müşteri adı ara" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 38 }} />
          <IconSearch size={17} style={{ position: 'absolute', left: 12, top: 14, color: 'var(--muted)' }} />
        </div>
      </div>
      {ref && <Alert tone="info">“{ref}” numaralı randevu gösteriliyor. <button type="button" className="link-btn" onClick={() => setParams({ ref: null })}>Filtreyi kaldır</button></Alert>}
      {loading && !data ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon={<IconCalendar />} title="Randevu bulunamadı">Seçili filtrede randevu yok.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Tarih / saat</th><th>Müşteri</th><th>Hizmet</th><th>Çalışan</th><th>Durum</th><th>Tutar</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setOpenId(a.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(a.id)}>
                  <td className="nowrap"><strong>{formatDate(a.start_at, zone, { weekday: 'short', year: undefined })}</strong><div className="muted xsmall">{formatTime(a.start_at, zone)} · {formatDuration(a.duration_snapshot)}</div></td>
                  <td>{a.customer_name}{a.source === 'manual' && <div className="muted xsmall">Manuel</div>}</td>
                  <td className="small">{a.services.map((s) => s.name).join(', ')}</td>
                  <td className="small">{a.employee_name}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td className="small nowrap">{priceText(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <AppointmentModal id={openId} onClose={() => { setOpenId(null); if (ref) setParams({ ref: null }); }} onChanged={reload} />}
      <ManualAppointmentModal open={manual} onClose={() => setManual(false)} onCreated={reload} />
    </div>
  );
}

export function CustomersPage() {
  const { bid, detail } = usePanel();
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi<{ key: string; customer_user_id: string | null; name: string; phone: string | null; completed: number; no_show: number; cancelled: number; total: number; last_visit: string | null; next_visit: string | null; manual: boolean }[]>(`/api/panel/${bid}/customers${qs({ q: q.length > 1 ? q : '' })}`);
  const [hist, setHist] = useState<{ key: string; name: string } | null>(null);
  const history = useApi<Appointment[]>(hist ? `/api/panel/${bid}/customers/history?key=${encodeURIComponent(hist.key)}` : null);
  const zone = detail.business.timezone;
  return (
    <div className="stack">
      <PageHeader title="Müşteriler" description="Yalnızca işletmenizden randevu almış kişiler ve yalnızca sizdeki randevu geçmişleri gösterilir. Bu bilgiler pazarlama amaçlı kullanılamaz." />
      <input className="input" style={{ maxWidth: 320 }} placeholder="Ad veya telefon ara" aria-label="Müşteri ara" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && !data ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? <EmptyState title="Henüz müşteri yok" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Müşteri</th><th>Telefon</th><th>Tamamlanan</th><th>Gelmedi</th><th>İptal</th><th>Son ziyaret</th><th>Sonraki</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.key} className="clickable" onClick={() => setHist({ key: c.key, name: c.name })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setHist({ key: c.key, name: c.name })}>
                  <td><strong>{c.name}</strong>{!c.customer_user_id && <div className="muted xsmall">Manuel kayıt</div>}</td>
                  <td className="nowrap small">{c.phone ?? '—'}</td>
                  <td>{c.completed}</td>
                  <td>{c.no_show > 0 ? <Badge tone="red">{c.no_show}</Badge> : 0}</td>
                  <td>{c.cancelled}</td>
                  <td className="nowrap small">{c.last_visit ? formatDate(c.last_visit, zone, { weekday: undefined }) : '—'}</td>
                  <td className="nowrap small">{c.next_visit ? formatDateTime(c.next_visit, zone) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal size="lg" open={Boolean(hist)} onClose={() => setHist(null)} title={hist?.name ?? ''}>
        {history.loading ? <Spinner /> : (
          <div className="stack-sm">
            {history.data?.map((a) => (
              <Card key={a.id}>
                <div className="row-between"><strong>{formatDateTime(a.start_at, zone)}</strong><StatusBadge status={a.status} /></div>
                <div className="muted small">{a.services.map((s) => s.name).join(', ')} · {a.employee_name} · {priceText(a)}</div>
              </Card>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
