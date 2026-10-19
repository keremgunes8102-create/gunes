import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, randomInt } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt ile şifre özeti: scrypt$N$r$p$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Zamanlama saldırılarını azaltmak için var olmayan kullanıcılarda da aynı maliyetli işlemi yapar */
let dummyHash: string | null = null;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= await hashPassword('koltuk-dummy-password-1');
  await verifyPassword(password, dummyHash);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** İnsan tarafından okunabilir randevu numarası: KLT-7KX4-Q2 (karışabilen karakterler hariç) */
export function publicReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n: number) => Array.from({ length: n }, () => alphabet[randomInt(0, alphabet.length)]).join('');
  return `KLT-${pick(4)}-${pick(4)}`;
}

// ---------------------------------------------------------------------------
// Hız sınırlama (süreç içi, kayan pencere). Çok sunuculu dağıtımda Redis vb. ile değiştirilmelidir.
// ---------------------------------------------------------------------------
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    const retry = Math.ceil((windowMs - (now - arr[0])) / 1000);
    throw new HttpError(429, 'rate_limited', `Çok fazla deneme yaptınız. Lütfen ${retry} saniye sonra tekrar deneyin.`);
  }
  arr.push(now);
  buckets.set(key, arr);
}

export function resetRateLimits() {
  buckets.clear();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    if (arr.every((t) => now - t > 3_600_000)) buckets.delete(k);
  }
}, 600_000).unref();
