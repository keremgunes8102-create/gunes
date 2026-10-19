import { useState } from 'react';
import { navigate } from '../lib/router.tsx';
import { qs } from '../lib/api.ts';
import { Button } from '../ui/index.tsx';
import { IconSearch } from '../ui/icons.tsx';
import { BUSINESS_TYPE_LABEL, BUSINESS_TYPES, TR_CITIES } from '../../shared/constants.ts';

export function todayLocal() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
}

export function SearchPanel({ initial = {}, suggestions = [] }: { initial?: Record<string, string>; suggestions?: string[] }) {
  const [city, setCity] = useState(initial.city ?? '');
  const [type, setType] = useState(initial.type ?? '');
  const [service, setService] = useState(initial.service ?? '');
  const [date, setDate] = useState(initial.date ?? '');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/kesfet${qs({ city, type, service, date })}`);
  };
  return (
    <form className="search-panel" onSubmit={submit} role="search" aria-label="Randevu ara">
      <div className="sp-field">
        <label htmlFor="sp-city">Şehir</label>
        <select id="sp-city" value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">Tüm şehirler</option>
          {TR_CITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="sp-field">
        <label htmlFor="sp-type">İşletme türü</label>
        <select id="sp-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Hepsi</option>
          {BUSINESS_TYPES.map((t) => (
            <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t]}</option>
          ))}
        </select>
      </div>
      <div className="sp-field">
        <label htmlFor="sp-service">Hizmet</label>
        <input id="sp-service" list="sp-service-list" placeholder="Saç kesimi, manikür…" value={service} onChange={(e) => setService(e.target.value)} autoComplete="off" />
        <datalist id="sp-service-list">
          {[...new Set(suggestions)].map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div className="sp-field">
        <label htmlFor="sp-date">Tarih</label>
        <input id="sp-date" type="date" min={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Button type="submit" size="lg">
        <IconSearch size={18} /> Ara
      </Button>
    </form>
  );
}
