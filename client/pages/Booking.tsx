import { useEffect, useMemo, useState } from 'react';
import { Link, navigate, useSearchParams } from '../lib/router.tsx';
import { api, ApiError, newKey, qs } from '../lib/api.ts';
import { useApi, useDocumentTitle } from '../lib/hooks.ts';
import { useAuth } from '../lib/auth.tsx';
import { MonthCalendar } from '../components/Calendar.tsx';
import { todayLocal } from '../components/SearchPanel.tsx';
import { Alert, Button, ButtonLink, Card, DemoBadge, EmptyState, ErrorState, Skeleton, Spinner, TextArea, cx } from '../ui/index.tsx';
import { IconCalendar, IconCheck, IconChevronLeft, IconClock, IconUser, IconUsers } from '../ui/icons.tsx';
import { formatDate, formatDuration, formatPrice, formatTL } from '../../shared/format.ts';
import { addDaysLocal } from '../../shared/time.ts';

interface Detail {
  business: { id: string; name: string; slug: string; timezone: string; allow_employee_choice: boolean; online_booking_enabled: boolean; auto_confirm: boolean; cancellation_policy: string | null; cancel_min_hours: number; booking_window_days: number; is_demo: boolean; address: string | null; district: string | null; city: string | null };
  services: { id: string; name: string; description: string | null; duration_minutes: number; price_type: string; price_amount: string | null; price_max_amount: string | null; category: string | null; employee_ids: string[] }[];
  employees: { id: string; display_name: string; title: string | null; photo_url: string | null }[];
}
interface Slot { time: string; startAt: string; endAt: string; employeeCount: number }

function totalPrice(services: Detail['services']) {
  if (!services.length) return '—';
  if (services.some((s) => s.price_type === 'consultation')) {
    const known = services.filter((s) => s.price_type !== 'consultation').reduce((a, s) => a + Number(s.price_amount ?? 0), 0);
    return known ? `${formatTL(known)} + danışma sonrası belirlenecek` : 'Danışma sonrası belirlenir';
  }
  const min = services.reduce((a, s) => a + Number(s.price_amount ?? 0), 0);
  const hasRange = services.some((s) => s.price_type === 'range');
  const hasStart = services.some((s) => s.price_type === 'starting_from');
  if (hasRange && !hasStart) {
    const max = services.reduce((a, s) => a + Number(s.price_type === 'range' ? s.price_max_amount : s.price_amount), 0);
    return `${formatTL(min)} – ${formatTL(max)}`;
  }
  return hasStart || hasRange ? `${formatTL(min)}'den başlayan` : formatTL(min);
}

export function Booking({ slug }: { slug: string }) {
  const { user, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useApi<Detail>(`/api/businesses/${slug}`);
  const reschedule = params.get('reschedule'); // randevu numarası
  const { data: original } = useApi<{ id: string; services: { service_id: string }[]; employee_id: string; start_at: string }>(reschedule && user ? `/api/me/appointments/${reschedule}` : null, [user?.id]);
  useDocumentTitle(data ? `${data.business.name} — randevu` : 'Randevu');

  const selected = useMemo(() => (params.get('s') ?? '').split(',').filter(Boolean), [params]);
  const employee = params.get('e') ?? '';
  const date = params.get('d');
  const startAt = params.get('t');
  const step = Number(params.get('step') ?? 1);

  // Taşıma modunda hizmetleri orijinal randevudan al
  useEffect(() => {
    if (reschedule && original && !params.get('s')) {
      setParams({ s: original.services.map((s) => s.service_id).join(','), step: '3' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original]);

  const [note, setNote] = useState('');
  const [idemKey] = useState(() => {
    const k = `koltuk_idem_${slug}`;
    try {
      const existing = sessionStorage.getItem(k);
      if (existing) return existing;
      const fresh = newKey();
      sessionStorage.setItem(k, fresh);
      return fresh;
    } catch {
      return newKey();
    }
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const today = todayLocal();
  const [rangeFrom, setRangeFrom] = useState(today);
  const svcParam = selected.join(',');
  const excludeParam = reschedule && original ? original.id : undefined;
  const avail = useApi<{ days: { date: string; slots: number }[]; durationMinutes: number; stationProblem: boolean }>(
    data && selected.length && step >= 3 ? `/api/businesses/${slug}/availability${qs({ services: svcParam, employee: employee === 'any' ? '' : employee, from: rangeFrom, days: 42, exclude: excludeParam })}` : null,
  );
  const slots = useApi<{ slots: Slot[]; durationMinutes: number }>(
    data && selected.length && date && step >= 4 ? `/api/businesses/${slug}/slots${qs({ services: svcParam, employee: employee === 'any' ? '' : employee, date, exclude: excludeParam })}` : null,
  );

  if (loading || authLoading) return <Spinner />;
  if (error || !data) return <div className="container section"><ErrorState error={error} onRetry={reload} /></div>;
  const b = data.business;
  if (!b.online_booking_enabled) {
    return (
      <div className="container section">
        <EmptyState title="Online randevu kapalı" action={<ButtonLink to={`/isletme/${slug}`} variant="secondary">İşletme sayfasına dön</ButtonLink>}>
          Bu işletme şu anda online randevu kabul etmiyor.
        </EmptyState>
      </div>
    );
  }
  const chosen = selected.map((id) => data.services.find((s) => s.id === id)).filter(Boolean) as Detail['services'];
  const eligibleEmployees = data.employees.filter((e) => chosen.every((s) => s.employee_ids.includes(e.id)));
  const canChooseEmployee = b.allow_employee_choice && eligibleEmployees.length > 1;
  const duration = slots.data?.durationMinutes ?? avail.data?.durationMinutes ?? chosen.reduce((a, s) => a + s.duration_minutes, 0);
  const availableMap = Object.fromEntries((avail.data?.days ?? []).map((d) => [d.date, d.slots]));
  const maxDate = addDaysLocal(today, b.booking_window_days);

  const go = (next: Record<string, string | null>) => setParams(next, false);
  const toggleService = (id: string) => {
    const has = selected.includes(id);
    const next = has ? selected.filter((x) => x !== id) : [...selected, id].slice(0, 5);
    setParams({ s: next.join(','), d: null, t: null, e: null }, true);
  };
  const steps = ['Hizmet', 'Çalışan', 'Tarih', 'Saat', 'Onay'];
  const currentUrl = `/randevu/${slug}${location.search}`;

  const submit = async () => {
    if (!startAt) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (reschedule) {
        await api.post(`/api/me/appointments/${reschedule}/reschedule`, { start_at: startAt, employee_id: employee && employee !== 'any' ? employee : null });
        navigate(`/hesabim/randevular/${reschedule}?moved=1`);
        return;
      }
      const r = await api.post<{ public_reference: string }>('/api/me/appointments', {
        business_id: b.id,
        service_ids: selected,
        employee_id: employee && employee !== 'any' ? employee : null,
        start_at: startAt,
        customer_note: note || null,
        idempotency_key: idemKey,
      });
      try {
        sessionStorage.removeItem(`koltuk_idem_${slug}`);
      } catch {
        /* yok say */
      }
      navigate(`/randevu-onay/${r.public_reference}`);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'slot_unavailable') {
        setSubmitError(err.message);
        go({ step: '4', t: null });
        slots.reload();
        avail.reload();
      } else setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const slotGroups = (() => {
    const list = slots.data?.slots ?? [];
    return [
      ['Sabah', list.filter((s) => s.time < '12:00')],
      ['Öğleden sonra', list.filter((s) => s.time >= '12:00' && s.time < '17:00')],
      ['Akşam', list.filter((s) => s.time >= '17:00')],
    ] as const;
  })();
  const chosenSlot = slots.data?.slots.find((s) => s.startAt === startAt);
  const employeeName = employee && employee !== 'any' ? data.employees.find((e) => e.id === employee)?.display_name : 'Fark etmez (uygun çalışan)';

  return (
    <div className="container section-sm">
      <Link to={`/isletme/${slug}`} className="back-link">← {b.name}</Link>
      <div className="row" style={{ marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>{reschedule ? 'Randevu saatini değiştir' : 'Randevu al'}</h1>
        {b.is_demo && <DemoBadge />}
      </div>
      <p className="muted">{b.name} · {[b.district, b.city].filter(Boolean).join(', ')}</p>
      <div className="progress" aria-label={`Adım ${Math.min(step, 5)} / 5`}>
        {steps.map((s, i) => (
          <span key={s} className={i < step ? 'done' : ''} title={s} />
        ))}
      </div>

      <div className="booking-layout">
        <div>
          {submitError && step !== 5 && <div style={{ marginBottom: 16 }}><Alert tone="error">{submitError}</Alert></div>}

          {step === 1 && (
            <section aria-labelledby="st1">
              <div className="step-title">
                <h2 id="st1" style={{ margin: 0 }}>Hizmet seçin</h2>
                <small>En fazla 5 hizmet</small>
              </div>
              <div className="option-list">
                {data.services.filter((s) => s.employee_ids.length > 0).map((s) => {
                  const on = selected.includes(s.id);
                  return (
                    <button key={s.id} type="button" className={cx('service-select', on && 'selected')} onClick={() => toggleService(s.id)} aria-pressed={on} disabled={!!reschedule}>
                      <span className="tick">{on && <IconCheck size={14} />}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ display: 'block' }}>{s.name}</strong>
                        <span className="muted small">{formatDuration(s.duration_minutes)}{s.description ? ` · ${s.description}` : ''}</span>
                      </span>
                      <span className="nowrap" style={{ fontWeight: 600 }}>{formatPrice(s)}</span>
                    </button>
                  );
                })}
              </div>
              {selected.length > 1 && (
                <p className="muted small" style={{ marginTop: 12 }}>Birden fazla hizmet aynı çalışan tarafından art arda yapılır; toplam süre ve uygun saatler buna göre hesaplanır.</p>
              )}
              <div className="form-actions">
                <Button disabled={!selected.length} onClick={() => go({ step: canChooseEmployee ? '2' : '3', e: canChooseEmployee ? employee || null : 'any' })} size="lg">
                  Devam et
                </Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="st2">
              <div className="step-title"><h2 id="st2" style={{ margin: 0 }}>Çalışan seçin</h2></div>
              {eligibleEmployees.length === 0 ? (
                <Alert tone="warning">Seçtiğiniz hizmetlerin tamamını yapabilen bir çalışan yok. Lütfen hizmetleri ayrı randevularla alın.</Alert>
              ) : (
                <div className="option-list">
                  <button type="button" className={cx('employee-option', (employee === 'any' || !employee) && 'selected')} onClick={() => go({ e: 'any', step: '3', d: null, t: null })}>
                    <span className="avatar"><IconUsers size={18} /></span>
                    <span><strong>Fark etmez</strong><br /><span className="muted small">Seçtiğiniz saatte uygun olan çalışan atanır</span></span>
                  </button>
                  {(b.allow_employee_choice ? eligibleEmployees : []).map((e) => (
                    <button key={e.id} type="button" className={cx('employee-option', employee === e.id && 'selected')} onClick={() => go({ e: e.id, step: '3', d: null, t: null })}>
                      {e.photo_url ? <img src={e.photo_url} alt="" className="avatar" style={{ objectFit: 'cover' }} /> : <span className="avatar">{e.display_name.charAt(0)}</span>}
                      <span><strong>{e.display_name}</strong>{e.title && <><br /><span className="muted small">{e.title}</span></>}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                <Button variant="ghost" onClick={() => go({ step: '1' })}><IconChevronLeft size={16} /> Geri</Button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section aria-labelledby="st3">
              <div className="step-title"><h2 id="st3" style={{ margin: 0 }}>Tarih seçin</h2></div>
              <Card>
                {avail.data?.stationProblem ? (
                  <Alert tone="warning">Seçtiğiniz hizmetler aynı istasyonda yapılamıyor. Lütfen ayrı randevular oluşturun.</Alert>
                ) : avail.error ? (
                  <ErrorState error={avail.error} onRetry={avail.reload} />
                ) : (
                  <>
                    <MonthCalendar value={date} today={today} maxDate={maxDate} available={availableMap} onChange={(d) => go({ d, t: null, step: '4' })} onMonthChange={setRangeFrom} />
                    <p className="muted xsmall" style={{ marginTop: 10, marginBottom: 0 }} aria-live="polite">
                      {avail.loading ? 'Müsaitlik hesaplanıyor…' : avail.data && avail.data.days.every((d) => d.slots === 0) ? 'Bu dönemde boş saat bulunmuyor. Sonraki aya bakabilirsiniz.' : 'Yeşil noktalı günlerde boş saat var.'}
                    </p>
                  </>
                )}
              </Card>
              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                <Button variant="ghost" onClick={() => go({ step: canChooseEmployee ? '2' : '1' })}><IconChevronLeft size={16} /> Geri</Button>
              </div>
            </section>
          )}

          {step === 4 && date && (
            <section aria-labelledby="st4">
              <div className="step-title">
                <h2 id="st4" style={{ margin: 0 }}>Saat seçin</h2>
                <small>{formatDate(`${date}T12:00:00Z`, 'UTC')}</small>
              </div>
              {slots.loading ? (
                <div className="slot-grid">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} h={44} r={12} />)}</div>
              ) : slots.error ? (
                <ErrorState error={slots.error} onRetry={slots.reload} />
              ) : !slots.data?.slots.length ? (
                <EmptyState icon={<IconCalendar />} title="Bu gün için boş saat kalmadı" action={<Button variant="secondary" onClick={() => go({ step: '3', d: null })}>Başka gün seç</Button>} />
              ) : (
                slotGroups.map(([label, list]) =>
                  list.length ? (
                    <div key={label}>
                      <div className="slot-section-label">{label}</div>
                      <div className="slot-grid">
                        {list.map((s) => (
                          <button key={s.startAt} type="button" className={cx('slot', startAt === s.startAt && 'selected')} aria-pressed={startAt === s.startAt} onClick={() => { setSubmitError(null); go({ t: s.startAt, step: '5' }); }}>
                            {s.time}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null,
                )
              )}
              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                <Button variant="ghost" onClick={() => go({ step: '3' })}><IconChevronLeft size={16} /> Tarihi değiştir</Button>
              </div>
            </section>
          )}

          {step === 5 && startAt && (
            <section aria-labelledby="st5" className="stack">
              <div className="step-title"><h2 id="st5" style={{ margin: 0 }}>Randevu özeti</h2></div>
              <Card>
                <div className="summary-row"><span>İşletme</span><span>{b.name}</span></div>
                <div className="summary-row"><span>Hizmet</span><span>{chosen.map((s) => s.name).join(', ')}</span></div>
                <div className="summary-row"><span>Çalışan</span><span>{employeeName}</span></div>
                <div className="summary-row"><span>Tarih</span><span>{formatDate(startAt, b.timezone)}</span></div>
                <div className="summary-row"><span>Saat</span><span>{chosenSlot ? `${chosenSlot.time} – ${new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: b.timezone }).format(new Date(chosenSlot.endAt))}` : new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: b.timezone }).format(new Date(startAt))}</span></div>
                <div className="summary-row"><span>Tahmini süre</span><span>{formatDuration(duration)}</span></div>
                <div className="summary-total"><span>Tutar</span><span>{totalPrice(chosen)}</span></div>
                <p className="muted xsmall" style={{ marginBottom: 0, marginTop: 8 }}>Ödeme işletmede yapılır. KOLTUK üzerinden ödeme alınmaz.</p>
              </Card>
              <Card>
                <h3 className="small" style={{ fontWeight: 650 }}>İptal koşulları</h3>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  {b.cancellation_policy && <>{b.cancellation_policy}<br /></>}
                  Platform üzerinden iptal ve saat değişikliği başlangıçtan en az <strong>{b.cancel_min_hours} saat</strong> öncesine kadar "Randevularım" sayfasından yapılabilir.
                </p>
              </Card>
              {!reschedule && <TextArea label="İşletmeye not" optional value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="Örn. Saçım uzun, ek süre gerekebilir." />}
              {!b.auto_confirm && !reschedule && <Alert tone="info">Bu işletme randevuları kendisi onaylar. Talebiniz onaylandığında bildirim alırsınız.</Alert>}
              {submitError && <Alert tone="error">{submitError}</Alert>}
              {user ? (
                <Button size="lg" block busy={submitting} onClick={submit}>
                  {reschedule ? 'Yeni saati onayla' : b.auto_confirm ? 'Randevuyu onayla' : 'Randevu talebi gönder'}
                </Button>
              ) : (
                <div className="stack-sm">
                  <Alert tone="info">Randevuyu tamamlamak için giriş yapın veya ücretsiz üye olun. Seçimleriniz korunur.</Alert>
                  <div className="grid-2">
                    <ButtonLink to={`/giris?next=${encodeURIComponent(currentUrl)}`} size="lg" block>Giriş yap</ButtonLink>
                    <ButtonLink to={`/uye-ol?next=${encodeURIComponent(currentUrl)}`} variant="secondary" size="lg" block>Üye ol</ButtonLink>
                  </div>
                </div>
              )}
              <Button variant="ghost" onClick={() => go({ step: '4' })}><IconChevronLeft size={16} /> Saati değiştir</Button>
            </section>
          )}
        </div>

        <aside>
          <Card className="summary-card">
            <h3 className="card-title">Seçimleriniz</h3>
            {chosen.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Henüz hizmet seçmediniz.</p>
            ) : (
              <>
                {chosen.map((s) => (
                  <div key={s.id} className="summary-row"><span>{s.name}</span><span>{formatPrice(s)}</span></div>
                ))}
                <div className="summary-row"><span className="row" style={{ gap: 6 }}><IconClock size={15} /> Süre</span><span>{formatDuration(duration)}</span></div>
                {step >= 3 && <div className="summary-row"><span className="row" style={{ gap: 6 }}><IconUser size={15} /> Çalışan</span><span>{employeeName}</span></div>}
                {date && <div className="summary-row"><span className="row" style={{ gap: 6 }}><IconCalendar size={15} /> Tarih</span><span>{formatDate(`${date}T12:00:00Z`, 'UTC', { weekday: 'short' })}</span></div>}
                {chosenSlot && <div className="summary-row"><span>Saat</span><span>{chosenSlot.time}</span></div>}
                <div className="summary-total"><span>Toplam</span><span style={{ textAlign: 'right' }}>{totalPrice(chosen)}</span></div>
              </>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

export function BookingSuccess({ reference }: { reference: string }) {
  const { data, loading, error } = useApi<{ public_reference: string; status: string; start_at: string; timezone: string; business_name: string; business_slug: string; employee_name: string; services: { name: string }[]; business_address: string | null; business_district: string | null; business_city: string | null }>(`/api/me/appointments/${reference}`);
  useDocumentTitle('Randevu oluşturuldu');
  if (loading) return <Spinner />;
  if (error || !data) return <div className="container section"><ErrorState error={error} /></div>;
  const pending = data.status === 'pending';
  return (
    <div className="container container-narrow section" style={{ textAlign: 'center' }}>
      <div className="success-mark"><IconCheck size={36} /></div>
      <h1>{pending ? 'Randevu talebiniz alındı' : 'Randevunuz oluşturuldu'}</h1>
      <p className="muted">{pending ? 'İşletme talebinizi onayladığında bildirim alacaksınız.' : 'Randevu bilgileriniz hesabınıza kaydedildi.'}</p>
      <div style={{ margin: '20px 0' }}>
        <div className="muted small" style={{ marginBottom: 6 }}>Randevu numarası</div>
        <span className="ref-code">{data.public_reference}</span>
      </div>
      <Card className="stack-sm" padded>
        <div className="summary-row"><span>İşletme</span><span>{data.business_name}</span></div>
        <div className="summary-row"><span>Hizmet</span><span>{data.services.map((s) => s.name).join(', ')}</span></div>
        <div className="summary-row"><span>Çalışan</span><span>{data.employee_name}</span></div>
        <div className="summary-row"><span>Zaman</span><span>{formatDate(data.start_at, data.timezone)} · {new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: data.timezone }).format(new Date(data.start_at))}</span></div>
        <div className="summary-row"><span>Adres</span><span>{[data.business_address, data.business_district, data.business_city].filter(Boolean).join(', ')}</span></div>
      </Card>
      <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
        <ButtonLink to={`/hesabim/randevular/${data.public_reference}`}>Randevu detayı</ButtonLink>
        <ButtonLink to="/kesfet" variant="secondary">Keşfetmeye devam et</ButtonLink>
      </div>
    </div>
  );
}
