import { PRICE_TYPE_LABEL, type PriceType, DEFAULT_TIMEZONE } from './constants.ts';

const tl = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2, minimumFractionDigits: 0 });

export function formatTL(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  return tl.format(Number(amount));
}

export function formatPrice(p: {
  price_type: PriceType | string;
  price_amount: number | string | null;
  price_max_amount?: number | string | null;
}): string {
  switch (p.price_type) {
    case 'fixed':
      return formatTL(p.price_amount);
    case 'starting_from':
      return `${formatTL(p.price_amount)}'den başlayan`;
    case 'range':
      return `${formatTL(p.price_amount)} – ${formatTL(p.price_max_amount)}`;
    case 'consultation':
      return PRICE_TYPE_LABEL.consultation;
    default:
      return formatTL(p.price_amount);
  }
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

export function formatDate(iso: string | Date, tz = DEFAULT_TIMEZONE, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: tz, ...opts }).format(
    new Date(iso),
  );
}

export function formatShortDate(iso: string | Date, tz = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }).format(new Date(iso));
}

export function formatTime(iso: string | Date, tz = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
}

export function formatDateTime(iso: string | Date, tz = DEFAULT_TIMEZONE): string {
  return `${formatDate(iso, tz, { weekday: undefined })} ${formatTime(iso, tz)}`;
}

/** Türkçe karakterleri sadeleştirip URL uyumlu kısa ad üretir */
export function slugify(input: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  return input
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Kilometre cinsinden kuş uçuşu mesafe */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function trLower(s: string): string {
  return s.toLocaleLowerCase('tr-TR');
}
