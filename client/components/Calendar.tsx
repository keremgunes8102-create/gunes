import { useMemo, useState } from 'react';
import { addDaysLocal, weekdayOfLocalDate } from '../../shared/time.ts';
import { WEEKDAYS_SHORT } from '../../shared/constants.ts';
import { IconChevronLeft, IconChevronRight } from '../ui/icons.tsx';
import { cx } from '../ui/index.tsx';

const monthName = (ym: string) => new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));

/** Ay takvimi. available: tarih -> boş saat sayısı. Yüklenmemiş günler (undefined) seçilebilir kalır. */
export function MonthCalendar({ value, onChange, today, available, maxDate, onMonthChange }: { value: string | null; onChange: (d: string) => void; today: string; available: Record<string, number>; maxDate?: string; onMonthChange?: (firstDay: string) => void }) {
  const [month, setMonth] = useState((value ?? today).slice(0, 7));
  const cells = useMemo(() => {
    const first = `${month}-01`;
    const lead = weekdayOfLocalDate(first);
    const out: (string | null)[] = Array(lead).fill(null);
    let d = first;
    while (d.slice(0, 7) === month) {
      out.push(d);
      d = addDaysLocal(d, 1);
    }
    return out;
  }, [month]);
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
    setMonth(dt);
    onMonthChange?.(`${dt}-01` < today ? today : `${dt}-01`);
  };
  const canPrev = month > today.slice(0, 7);
  const canNext = !maxDate || month < maxDate.slice(0, 7);
  return (
    <div className="calendar">
      <div className="calendar-head">
        <button type="button" className="icon-btn" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Önceki ay">
          <IconChevronLeft />
        </button>
        <strong style={{ textTransform: 'capitalize' }} aria-live="polite">{monthName(month)}</strong>
        <button type="button" className="icon-btn" onClick={() => shift(1)} disabled={!canNext} aria-label="Sonraki ay">
          <IconChevronRight />
        </button>
      </div>
      <div className="calendar-grid" role="grid">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="calendar-dow" role="columnheader">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const past = d < today;
          const beyond = maxDate ? d > maxDate : false;
          const count = available[d];
          const none = count === 0;
          const disabled = past || beyond || none;
          const label = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
          return (
            <button
              key={d}
              type="button"
              className={cx('calendar-day', count > 0 && 'available', value === d && 'selected', d === today && 'today')}
              disabled={disabled}
              onClick={() => onChange(d)}
              aria-pressed={value === d}
              aria-label={`${label}${count > 0 ? `, ${count} boş saat` : none ? ', boş saat yok' : ''}`}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
