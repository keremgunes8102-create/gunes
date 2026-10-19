import { z } from 'zod';
import { isValidLocalDate } from '../shared/time.ts';

// Türkçe varsayılan hata mesajları
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'Bu alan zorunludur.' };
      return { message: 'Geçersiz değer.' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: issue.minimum === 1 ? 'Bu alan zorunludur.' : `En az ${issue.minimum} karakter olmalı.` };
      if (issue.type === 'number') return { message: `En az ${issue.minimum} olmalı.` };
      if (issue.type === 'array') return { message: issue.minimum === 1 ? 'En az bir seçim yapın.' : `En az ${issue.minimum} seçim yapın.` };
      return { message: 'Değer çok küçük.' };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `En fazla ${issue.maximum} karakter olabilir.` };
      if (issue.type === 'number') return { message: `En fazla ${issue.maximum} olabilir.` };
      if (issue.type === 'array') return { message: `En fazla ${issue.maximum} seçim yapılabilir.` };
      return { message: 'Değer çok büyük.' };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Geçerli bir e-posta adresi girin.' };
      if (issue.validation === 'url') return { message: 'Geçerli bir adres (https://…) girin.' };
      if (issue.validation === 'uuid') return { message: 'Geçersiz kimlik.' };
      return { message: 'Geçersiz biçim.' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Geçerli bir seçenek seçin.' };
    default:
      return { message: ctx.defaultError };
  }
});

export const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Türkiye cep telefonu: 05xx xxx xx xx -> +905xxxxxxxxx */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let d = digits;
  if (d.startsWith('90') && d.length === 12) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  if (d.length === 10 && /^[2-5]/.test(d)) return `+90${d}`;
  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .min(1)
  .transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçerli bir telefon numarası girin (05xx xxx xx xx).' });
      return z.NEVER;
    }
    return p;
  });

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçerli bir telefon numarası girin.' });
      return z.NEVER;
    }
    return p;
  });

export const emailSchema = z.string().trim().toLowerCase().email().max(200);

export const passwordSchema = z
  .string()
  .min(8, 'Şifre en az 8 karakter olmalı.')
  .max(200)
  .refine((v) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(v) && /\d/.test(v), 'Şifre en az bir harf ve bir rakam içermeli.');

export const uuid = z.string().uuid();
export const localDate = z.string().refine(isValidLocalDate, 'Geçerli bir tarih seçin.');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Saat SS:DD biçiminde olmalı.');

export const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(withProto);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      return u.toString();
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçerli bir web adresi girin.' });
      return z.NEVER;
    }
  });

export const money = z.coerce.number().min(0).max(1_000_000);

export { z };
