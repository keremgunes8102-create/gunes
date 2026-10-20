-- Fiyatlandırma ve PayTR ile işletme aboneliği tahsilatı.
-- Not: Platform yalnızca işletmelerden abonelik ücreti tahsil eder; randevu alan kişilerden ödeme alınmaz.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS tagline text;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS monthly_price numeric(10,2);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS note text;

-- İşletmenin abonelik ödemeleri
CREATE TABLE IF NOT EXISTS payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  plan_id       uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  months        int  NOT NULL CHECK (months IN (1, 3, 6, 12)),
  monthly_price numeric(10,2) NOT NULL,
  amount        numeric(10,2) NOT NULL CHECK (amount > 0),
  currency      text NOT NULL DEFAULT 'TRY',
  founding      boolean NOT NULL DEFAULT false,
  provider      text NOT NULL CHECK (provider IN ('paytr', 'demo', 'manual')),
  merchant_oid  text NOT NULL UNIQUE CHECK (merchant_oid ~ '^[A-Za-z0-9]{6,64}$'),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  failure_reason text,
  provider_total text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  paid_at       timestamptz
);
CREATE INDEX IF NOT EXISTS payments_business ON payments (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status ON payments (status, created_at DESC);

UPDATE plans SET name = 'Ücretsiz', price_amount = 0, tagline = 'Küçük berberler için başlangıç',
  description = 'Online randevuya ücretsiz başlayın.',
  feature_limits = '{"max_employees": 2, "max_services": 15, "reports": "basic", "reminders": false}',
  features = '["2 çalışana kadar", "15 hizmete kadar", "Online randevu ve takvim", "İşletme profili ve yorumlar", "Temel istatistikler"]',
  sort_order = 1, is_featured = false
WHERE code = 'free';

UPDATE plans SET name = 'Profesyonel', price_amount = 1000, tagline = 'Büyüyen salonların tercihi',
  description = '3–10 çalışanlı salonlar için tam randevu yönetimi.',
  feature_limits = '{"max_employees": 10, "max_services": 100, "reports": "detailed", "reminders": true}',
  features = '["10 çalışana kadar", "100 hizmete kadar", "Randevu hatırlatmaları", "Ayrıntılı raporlar ve ciro takibi", "Ekip hesapları ve yetkiler", "Koltuk ve istasyon yönetimi"]',
  sort_order = 2, is_featured = true
WHERE code = 'pro';

UPDATE plans SET name = 'Premium', price_amount = 1750, tagline = 'Büyük salonlar ve zincirler',
  description = 'Çok şubeli ve yoğun işletmeler için.',
  feature_limits = '{"max_employees": 100, "max_services": 500, "reports": "advanced", "reminders": true, "multi_branch": true, "featured": true}',
  features = '["100 çalışana kadar", "500 hizmete kadar", "Birden fazla şube", "Aramalarda öne çıkma", "Gelişmiş çalışan raporları", "Öncelikli destek"]',
  sort_order = 3, is_featured = false
WHERE code = 'premium';
