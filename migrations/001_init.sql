-- KOLTUK — ilk şema
-- Tüm zamanlar timestamptz (UTC) olarak saklanır; işletme saatleri işletmenin yerel saat diliminde "time" olarak tutulur.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Ortak: updated_at tetikleyicisi
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Kullanıcılar ve oturumlar
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name             text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  email                 text NOT NULL,
  phone                 text,
  password_hash         text NOT NULL,
  platform_role         text NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user', 'admin')),
  account_status        text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'deletion_requested', 'deleted')),
  email_verified_at     timestamptz,
  phone_verified_at     timestamptz,
  deletion_requested_at timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE UNIQUE INDEX users_phone_unique ON users (phone) WHERE phone IS NOT NULL AND account_status <> 'deleted';
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id           text PRIMARY KEY,               -- SHA-256(token); ham token yalnızca çerezde
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE verification_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('email', 'sms')),
  code_hash   text NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_codes_user ON verification_codes (user_id, channel, created_at DESC);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Rıza ve bilgilendirme kayıtları (KVKK). Pazarlama izni hizmet bildirimlerinden ayrıdır.
CREATE TABLE consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('terms', 'privacy_notice', 'marketing_email', 'marketing_sms', 'cookies_analytics')),
  granted     boolean NOT NULL,
  document_version text NOT NULL,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user ON consents (user_id, consent_type, created_at DESC);

CREATE TABLE notification_preferences (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_service      boolean NOT NULL DEFAULT true,  -- randevu bildirimleri (hizmet amaçlı)
  sms_service        boolean NOT NULL DEFAULT true,
  reminders          boolean NOT NULL DEFAULT true,
  reminder_hours     int NOT NULL DEFAULT 24 CHECK (reminder_hours IN (2, 6, 12, 24, 48)),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- KVKK veri sahibi başvuruları
CREATE TABLE data_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  request_type text NOT NULL CHECK (request_type IN ('access', 'correction', 'deletion', 'objection', 'other')),
  details      text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'rejected')),
  resolution_note text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- Kategoriler
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  business_type text NOT NULL CHECK (business_type IN ('barber', 'hair_salon', 'beauty')),
  sort_order    int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Başlangıç hizmet şablonları (işletme kurulumunda öneri olarak sunulur; fiyat içermez)
CREATE TABLE service_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name           text NOT NULL,
  default_duration_minutes int NOT NULL CHECK (default_duration_minutes BETWEEN 5 AND 600),
  sort_order     int NOT NULL DEFAULT 0,
  UNIQUE (category_id, name)
);

-- ---------------------------------------------------------------------------
-- İşletmeler
-- ---------------------------------------------------------------------------
CREATE TABLE businesses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  slug                  text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  business_type         text NOT NULL CHECK (business_type IN ('barber', 'hair_salon', 'beauty')),
  description           text,
  phone                 text,
  email                 text,
  website               text,
  instagram             text,
  country               text NOT NULL DEFAULT 'Türkiye',
  city                  text,
  district              text,
  neighborhood          text,
  address               text,
  latitude              double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude             double precision CHECK (longitude BETWEEN -180 AND 180),
  location_verified     boolean NOT NULL DEFAULT false,
  timezone              text NOT NULL DEFAULT 'Europe/Istanbul',
  logo_url              text,
  cover_url             text,
  verification_status   text NOT NULL DEFAULT 'draft'
                        CHECK (verification_status IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended')),
  verification_note     text,               -- red / ek bilgi / askı gerekçesi
  submitted_at          timestamptz,
  approved_at           timestamptz,
  publication_status    text NOT NULL DEFAULT 'published' CHECK (publication_status IN ('published', 'hidden')),
  setup_step            int NOT NULL DEFAULT 2,
  is_demo               boolean NOT NULL DEFAULT false,
  -- Randevu tercihleri
  cancellation_policy   text,
  auto_confirm          boolean NOT NULL DEFAULT true,
  booking_window_days   int NOT NULL DEFAULT 30 CHECK (booking_window_days BETWEEN 1 AND 365),
  min_notice_minutes    int NOT NULL DEFAULT 60 CHECK (min_notice_minutes BETWEEN 0 AND 10080),
  cancel_min_hours      int NOT NULL DEFAULT 3 CHECK (cancel_min_hours BETWEEN 0 AND 168),
  slot_interval_minutes int NOT NULL DEFAULT 15 CHECK (slot_interval_minutes IN (5, 10, 15, 20, 30, 60)),
  allow_employee_choice boolean NOT NULL DEFAULT true,
  accept_new_customers  boolean NOT NULL DEFAULT true,
  online_booking_enabled boolean NOT NULL DEFAULT true,
  pending_expiry_minutes int NOT NULL DEFAULT 120 CHECK (pending_expiry_minutes BETWEEN 10 AND 2880),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX businesses_listing ON businesses (verification_status, publication_status, business_type);
CREATE INDEX businesses_city ON businesses (lower(city), lower(district));
CREATE INDEX businesses_owner ON businesses (owner_user_id);
CREATE TRIGGER businesses_updated BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE business_categories (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  PRIMARY KEY (business_id, category_id)
);

CREATE TABLE business_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES users(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  invitation_status text NOT NULL DEFAULT 'accepted' CHECK (invitation_status IN ('pending', 'accepted', 'revoked')),
  invite_email      text,
  invite_token_hash text UNIQUE,
  invite_expires_at timestamptz,
  employee_id       uuid,  -- staff üyesinin bağlı olduğu çalışan kaydı
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_members_unique ON business_members (business_id, user_id) WHERE user_id IS NOT NULL AND invitation_status = 'accepted';
CREATE INDEX business_members_user ON business_members (user_id) WHERE invitation_status = 'accepted';

-- Bir günde birden fazla çalışma aralığı: aynı weekday için birden fazla satır. Satır yoksa o gün kapalıdır.
CREATE TABLE business_hours (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Pazartesi
  opening_time time NOT NULL,
  closing_time time NOT NULL,
  CHECK (closing_time > opening_time)
);
CREATE INDEX business_hours_b ON business_hours (business_id, weekday);

CREATE TABLE business_closures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX business_closures_b ON business_closures (business_id, start_at);

CREATE TABLE business_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  url         text NOT NULL,
  caption     text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Çalışanlar ve istasyonlar
-- ---------------------------------------------------------------------------
CREATE TABLE employees (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  title            text,
  description      text,
  photo_url        text,
  is_active        boolean NOT NULL DEFAULT true,
  accepts_bookings boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);
CREATE INDEX employees_b ON employees (business_id);

ALTER TABLE business_members ADD CONSTRAINT business_members_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;

CREATE TABLE employee_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX employee_hours_e ON employee_hours (employee_id, weekday);

-- Haftalık tekrar eden molalar
CREATE TABLE employee_breaks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX employee_breaks_e ON employee_breaks (employee_id, weekday);

-- İzin, tatil ve tek seferlik kapatılan zamanlar
CREATE TABLE employee_time_off (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX employee_time_off_e ON employee_time_off (employee_id, start_at);

CREATE TABLE stations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         text NOT NULL,
  station_type text NOT NULL DEFAULT 'chair' CHECK (station_type IN ('chair', 'wash', 'color', 'nail', 'skin', 'makeup', 'other')),
  description  text,
  capacity     int NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 20),
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stations_b ON stations (business_id);

-- ---------------------------------------------------------------------------
-- Hizmetler
-- ---------------------------------------------------------------------------
CREATE TABLE services (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id         uuid REFERENCES categories(id) ON DELETE SET NULL,
  name                text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  description         text,
  duration_minutes    int NOT NULL CHECK (duration_minutes BETWEEN 5 AND 600),
  preparation_minutes int NOT NULL DEFAULT 0 CHECK (preparation_minutes BETWEEN 0 AND 120),
  cleanup_minutes     int NOT NULL DEFAULT 0 CHECK (cleanup_minutes BETWEEN 0 AND 120),
  price_type          text NOT NULL DEFAULT 'fixed' CHECK (price_type IN ('fixed', 'starting_from', 'range', 'consultation')),
  price_amount        numeric(10,2) CHECK (price_amount >= 0),
  price_max_amount    numeric(10,2) CHECK (price_max_amount >= 0),
  currency            text NOT NULL DEFAULT 'TRY',
  photo_url           text,
  is_active           boolean NOT NULL DEFAULT true,
  sort_order          int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (price_type = 'consultation' OR price_amount IS NOT NULL),
  CHECK (price_type <> 'range' OR (price_max_amount IS NOT NULL AND price_max_amount >= price_amount))
);
CREATE INDEX services_b ON services (business_id, is_active);
CREATE TRIGGER services_updated BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE employee_services (
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  service_id  uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, service_id)
);
CREATE INDEX employee_services_s ON employee_services (service_id);

-- Bir hizmet için station_services kaydı varsa o hizmet bu istasyonlardan birini gerektirir.
CREATE TABLE station_services (
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (station_id, service_id)
);
CREATE INDEX station_services_s ON station_services (service_id);

-- ---------------------------------------------------------------------------
-- Randevular
-- ---------------------------------------------------------------------------
CREATE TABLE appointments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference    text NOT NULL UNIQUE,
  business_id         uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  customer_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_name       text,      -- manuel (salonda/telefonla) eklenen müşteriler için
  customer_phone      text,
  employee_id         uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  station_id          uuid REFERENCES stations(id) ON DELETE RESTRICT,
  start_at            timestamptz NOT NULL,
  end_at              timestamptz NOT NULL,
  preparation_minutes int NOT NULL DEFAULT 0,
  cleanup_minutes     int NOT NULL DEFAULT 0,
  -- Çalışan/istasyonun gerçekten meşgul olduğu aralık (hazırlık + işlem + temizlik)
  occupied            tstzrange NOT NULL,
  status              text NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled_by_customer',
                                                     'cancelled_by_business', 'rejected', 'no_show', 'expired')),
  source              text NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'manual')),
  price_snapshot      numeric(10,2),
  price_max_snapshot  numeric(10,2),
  price_type_snapshot text NOT NULL,
  currency            text NOT NULL DEFAULT 'TRY',
  duration_snapshot   int NOT NULL,
  cancel_min_hours_snapshot int NOT NULL,
  cancellation_policy_snapshot text,
  customer_note       text,
  business_note       text,
  cancellation_reason text,
  pending_expires_at  timestamptz,
  idempotency_key     text,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CHECK (customer_user_id IS NOT NULL OR customer_name IS NOT NULL),
  -- Aynı çalışan için aktif (beklemede/onaylı) randevular çakışamaz. Veritabanı düzeyinde son savunma hattı.
  CONSTRAINT appointments_no_employee_overlap EXCLUDE USING gist (
    employee_id WITH =, occupied WITH &&
  ) WHERE (status IN ('pending', 'confirmed'))
);
CREATE UNIQUE INDEX appointments_idempotency ON appointments (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX appointments_business_time ON appointments (business_id, start_at);
CREATE INDEX appointments_customer ON appointments (customer_user_id, start_at DESC);
CREATE INDEX appointments_station ON appointments USING gist (station_id, occupied) WHERE status IN ('pending', 'confirmed');
CREATE INDEX appointments_pending ON appointments (pending_expires_at) WHERE status = 'pending';
CREATE TRIGGER appointments_updated BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE appointment_services (
  appointment_id      uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id          uuid REFERENCES services(id) ON DELETE SET NULL,
  position            int NOT NULL,
  name_snapshot       text NOT NULL,
  duration_snapshot   int NOT NULL,
  price_type_snapshot text NOT NULL,
  price_snapshot      numeric(10,2),
  price_max_snapshot  numeric(10,2),
  PRIMARY KEY (appointment_id, position)
);

-- Randevu durum geçmişi
CREATE TABLE appointment_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type     text NOT NULL,
  from_status    text,
  to_status      text,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_events_a ON appointment_events (appointment_id, created_at);

-- İşletmenin müşteriye önerdiği yeni saat
CREATE TABLE appointment_proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id   uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  proposed_start_at timestamptz NOT NULL,
  proposed_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'superseded', 'failed')),
  note             text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  responded_at     timestamptz
);
CREATE UNIQUE INDEX appointment_proposals_open ON appointment_proposals (appointment_id) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- Favoriler ve yorumlar
-- ---------------------------------------------------------------------------
CREATE TABLE favorites (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);

CREATE TABLE reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id    uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  customer_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  business_id       uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rating            smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment           text CHECK (comment IS NULL OR char_length(comment) <= 1500),
  moderation_status text NOT NULL DEFAULT 'published' CHECK (moderation_status IN ('published', 'hidden', 'removed')),
  business_reply    text,
  business_reply_at timestamptz,
  edited_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_business ON reviews (business_id, created_at DESC) WHERE moderation_status = 'published';
CREATE TRIGGER reviews_updated BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Şikâyetler (yorum, işletme veya kullanıcı hakkında)
CREATE TABLE reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_type   text NOT NULL CHECK (target_type IN ('review', 'business')),
  target_id     uuid NOT NULL,
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE INDEX reports_status ON reports (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Bildirimler
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  link       text,
  dedupe_key text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

-- E-posta / SMS gönderim kuyruğu. Servis yapılandırılmamışsa durum 'skipped_unconfigured' olur; asla 'sent' olarak işaretlenmez.
CREATE TABLE outbound_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  channel      text NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient    text NOT NULL,
  subject      text,
  body         text NOT NULL,
  dedupe_key   text UNIQUE,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped_unconfigured', 'skipped_preference')),
  attempts     int NOT NULL DEFAULT 0,
  last_error   text,
  provider_ref text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE INDEX outbound_queue ON outbound_messages (status, created_at) WHERE status = 'queued';

-- ---------------------------------------------------------------------------
-- Abonelik
-- ---------------------------------------------------------------------------
CREATE TABLE plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  description    text,
  price_amount   numeric(10,2) NOT NULL DEFAULT 0,
  currency       text NOT NULL DEFAULT 'TRY',
  billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'yearly')),
  feature_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  features       jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order     int NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status      text NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'expired')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  external_provider_reference text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_active ON subscriptions (business_id) WHERE status IN ('active', 'trialing', 'past_due');

-- ---------------------------------------------------------------------------
-- Denetim kaydı
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  business_id   uuid REFERENCES businesses(id) ON DELETE SET NULL,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_time ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_business ON audit_logs (business_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Dosya yüklemeleri
-- ---------------------------------------------------------------------------
CREATE TABLE uploads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  file_name   text NOT NULL UNIQUE,
  mime_type   text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes  int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Başlangıç verileri: kategoriler, hizmet şablonları, planlar (demo değil, platform verisi)
-- ---------------------------------------------------------------------------
INSERT INTO categories (slug, name, business_type, sort_order) VALUES
  ('erkek-berberi', 'Erkek berberi', 'barber', 1),
  ('kadin-kuaforu', 'Kadın kuaförü', 'hair_salon', 2),
  ('guzellik-bakim', 'Güzellik ve bakım', 'beauty', 3);

INSERT INTO service_templates (category_id, name, default_duration_minutes, sort_order)
SELECT c.id, t.name, t.d, t.o FROM categories c
JOIN (VALUES
  ('erkek-berberi', 'Saç kesimi', 30, 1), ('erkek-berberi', 'Saç ve sakal', 45, 2), ('erkek-berberi', 'Sakal tıraşı', 20, 3),
  ('erkek-berberi', 'Çocuk saç kesimi', 25, 4), ('erkek-berberi', 'Saç yıkama', 10, 5), ('erkek-berberi', 'Fön ve şekillendirme', 15, 6),
  ('erkek-berberi', 'Saç bakımı', 30, 7),
  ('kadin-kuaforu', 'Kadın saç kesimi', 45, 1), ('kadin-kuaforu', 'Fön', 30, 2), ('kadin-kuaforu', 'Maşa ve şekillendirme', 45, 3),
  ('kadin-kuaforu', 'Saç boyama', 120, 4), ('kadin-kuaforu', 'Dip boya', 90, 5), ('kadin-kuaforu', 'Röfle', 150, 6),
  ('kadin-kuaforu', 'Ombre', 180, 7), ('kadin-kuaforu', 'Balyaj', 210, 8), ('kadin-kuaforu', 'Saç bakım uygulaması', 45, 9),
  ('kadin-kuaforu', 'Gelin saçı', 120, 10), ('kadin-kuaforu', 'Prova', 60, 11), ('kadin-kuaforu', 'Çocuk saç kesimi', 30, 12),
  ('guzellik-bakim', 'Manikür', 40, 1), ('guzellik-bakim', 'Pedikür', 50, 2), ('guzellik-bakim', 'Kalıcı oje', 60, 3),
  ('guzellik-bakim', 'Kaş şekillendirme', 20, 4), ('guzellik-bakim', 'Cilt bakımı', 60, 5), ('guzellik-bakim', 'Makyaj', 60, 6)
) AS t(cat, name, d, o) ON t.cat = c.slug;

INSERT INTO plans (code, name, description, price_amount, billing_period, feature_limits, features, sort_order) VALUES
  ('free', 'Ücretsiz', 'Küçük işletmeler için temel randevu yönetimi', 0, 'monthly',
   '{"max_employees": 2, "max_services": 15, "reports": "basic", "reminders": false}',
   '["İşletme profili", "Temel hizmet listesi", "Temel randevu yönetimi", "Sınırlı istatistikler"]', 1),
  ('pro', 'Profesyonel', 'Büyüyen ekipler için gelişmiş takvim ve raporlar', 0, 'monthly',
   '{"max_employees": 10, "max_services": 100, "reports": "detailed", "reminders": true}',
   '["Gelişmiş takvim", "Ayrıntılı raporlar", "Çalışan yönetimi", "Hatırlatmalar", "Daha fazla özelleştirme"]', 2),
  ('premium', 'Premium', 'Çok şubeli ve yoğun işletmeler için', 0, 'monthly',
   '{"max_employees": 100, "max_services": 500, "reports": "advanced", "reminders": true, "multi_branch": true, "featured": true}',
   '["Gelişmiş işletme analizi", "Birden fazla şube", "Gelişmiş çalışan raporları", "Öne çıkarma seçenekleri", "Gelişmiş yönetim"]', 3);
