import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// .env dosyasını (varsa) yükle — harici bağımlılık olmadan basit ayrıştırıcı.
function loadDotEnv() {
  const file = resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const key = m[1];
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

if (isProduction && !env.DATABASE_URL) {
  throw new Error('DATABASE_URL üretim ortamında zorunludur.');
}

export const config = {
  isProduction,
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  databaseUrl: env.DATABASE_URL ?? 'postgres://koltuk:koltuk_dev@127.0.0.1:5432/koltuk',
  /** Uygulamanın dışarıdan erişilen adresi; e-posta bağlantıları ve Origin kontrolü için. */
  appUrl: (env.APP_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT ?? 3000}`).replace(/\/$/, ''),
  sessionDays: Number(env.SESSION_DAYS ?? 30),
  uploadDir: resolve(env.UPLOAD_DIR ?? 'data/uploads'),
  trustProxy: env.TRUST_PROXY === '1',
  email: {
    provider: env.EMAIL_PROVIDER ?? '', // 'resend' destekli; boşsa yapılandırılmamış
    apiKey: env.EMAIL_API_KEY ?? '',
    from: env.EMAIL_FROM ?? '',
  },
  sms: {
    provider: env.SMS_PROVIDER ?? '', // 'netgsm' destekli; boşsa yapılandırılmamış
    username: env.SMS_USERNAME ?? '',
    password: env.SMS_PASSWORD ?? '',
    header: env.SMS_HEADER ?? '',
  },
  /** Geliştirmede doğrulama kodunu ekranda göstermeye izin verir. Üretimde her zaman kapalıdır. */
  devShowCodes: (!isProduction || env.DEMO_MODE === '1') && env.DEV_SHOW_CODES !== '0',
  /** Herkese açık demo kurulumu: doğrulama kodları ekranda gösterilir, üst bilgide demo uyarısı çıkar. */
  demoMode: env.DEMO_MODE === '1',
};

export const emailConfigured = () => Boolean(config.email.provider && config.email.apiKey && config.email.from);
export const smsConfigured = () =>
  Boolean(config.sms.provider && config.sms.username && config.sms.password && config.sms.header);
