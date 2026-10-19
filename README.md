# KOLTUK — Berber, kuaför ve güzellik randevu platformu

> Tarzına uygun yer, sana uygun saat.

Gerçek kayıt/giriş, işletme kurulum sihirbazı, çalışan + koltuk/istasyon yönetimi, gerçek zamanlı müsaitlik motoru, çakışmaya karşı veritabanı korumalı randevu oluşturma, onay/iptal/saat değişikliği, bildirimler, yorumlar, işletme paneli ve platform yönetici paneli içeren çalışan bir uygulamadır. Arayüz tamamen Türkçedir, mobil önceliklidir.

---

## 1. Hızlı başlangıç

Gereksinimler: **Node.js 20+**, **PostgreSQL 14+** (yerelde 16 ile test edildi).

```bash
npm install
cp .env.example .env            # DATABASE_URL ve APP_URL'yi düzenleyin
createdb koltuk                 # veya psql ile oluşturun
npm run db:migrate              # şemayı kurar
npm run db:seed                 # (isteğe bağlı) demo verisi — yalnızca geliştirme
npm run build                   # istemci paketini derler + tip kontrolü
npm start                       # http://localhost:3000
```

Geliştirme modunda (otomatik yeniden derleme): `npm run dev`

### Demo hesapları (`npm run db:seed` sonrası, şifre: `Demo1234`)

| Rol | E-posta |
|---|---|
| Platform yöneticisi | admin@koltuk.demo |
| İşletme sahibi (Örnek Berber Moda) | isletme@koltuk.demo |
| Çalışan (aynı işletme, sınırlı yetki) | calisan@koltuk.demo |
| Müşteri | musteri@koltuk.demo |

Demo verisi 8 örnek işletme (3 berber, 3 kuaför, 2 güzellik salonu) içerir; hepsi `is_demo` işaretlidir ve arayüzde **"Örnek işletme"** etiketiyle gösterilir. Üretimde demo verisi yüklenmez (`ALLOW_DEMO_SEED=1` olmadan betik reddeder). Üretimde ilk yöneticiyi oluşturmak için:

```bash
ADMIN_PASSWORD='en-az-12-karakter' npm run create-admin -- yonetici@alanadi.com "Ad Soyad"
```

### Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | İstemci izleme + sunucu (tsx watch) |
| `npm run build` | İstemciyi `public/assets`'e derler, ardından `tsc --noEmit` |
| `npm start` | Üretim sunucusu |
| `npm run db:migrate` / `db:seed` / `db:reset` | Migration / demo verisi / şemayı sıfırla + demo |
| `npm run jobs` | Zamanlanmış görevleri ayrı süreçte çalıştırır (`-- --once` cron için) |
| `npm test` | Birim + API entegrasyon testleri (ayrı `koltuk_test` veritabanında) |
| `npm run test:e2e` | Gerçek tarayıcıda uçtan uca duman testi (çalışan sunucu + demo verisi gerekir) |
| `npm run lint` | Katı TypeScript kontrolü + statik güvenlik kontrolleri |

Testler için: `createdb koltuk_test` (veya `TEST_DATABASE_URL` verin). E2E için `npx playwright install chromium`.

---

## 2. Teknoloji seçimi ve gerekçesi

| Katman | Seçim |
|---|---|
| Arayüz | **React 19 + TypeScript**, tek sayfa uygulama, esbuild ile paketleme, el yazımı tasarım sistemi (CSS değişkenleri) |
| Sunucu | **Node.js + TypeScript** (bağımlılıksız HTTP katmanı, kendi yönlendiricisi), doğrulama **Zod** |
| Veritabanı | **PostgreSQL** — `postgres` (postgres.js) istemcisi, saf SQL migration'lar |
| Kimlik doğrulama | Sunucu tarafı oturum (HttpOnly çerez, veritabanında SHA‑256 özetli token), şifreler **scrypt** ile |
| Test | `node:test` (birim + API), Playwright (uçtan uca) |

**Next.js neden kullanılmadı?** Geliştirme ortamında npm paket deposuna erişim kapalıydı; Next.js kurulamadığı için, burada gerçekten çalıştırıp test edebileceğim eşdeğer bir yığın seçildi. Spesifikasyonun istediği tüm kritik mantık (yetkilendirme, müsaitlik, çakışma koruması, fiyat/süre anlık görüntüsü) sunucu ve veritabanı katmanındadır; arayüz katmanı ileride Next.js'e taşınmak istenirse API aynen kullanılabilir. İşletme sayfalarının (`/isletme/:slug`) başlık ve açıklaması paylaşım önizlemesi için sunucuda doldurulur.

**Supabase/RLS yerine:** Erişim kontrolü sunucu katmanında, her korumalı uç noktada yapılır (`requireUser`, `requireAdmin`, `requireMember(rol)`); istemciden gelen işletme kimliği, rol, fiyat veya süreye güvenilmez. İlişkilendirilen her kaydın (çalışan, hizmet, istasyon) aynı işletmeye ait olduğu ayrıca doğrulanır.

---

## 3. Klasör yapısı

```
migrations/001_init.sql   Tüm şema: tablolar, kısıtlar, indeksler, başlangıç kategorileri/şablonlar/paketler
server/
  app.ts                  HTTP katmanı, güvenlik başlıkları (CSP, HSTS…), CSRF, statik dosyalar, hata yönetimi
  auth.ts, security.ts    Oturum, rol/üyelik denetimi, scrypt, hız sınırlama, randevu numarası
  availability.ts         ★ Müsaitlik motoru (saf hesaplama + veritabanından yükleme)
  booking.ts              ★ Randevu oluşturma, durum geçişleri, saat değişikliği, öneriler
  notify.ts               Uygulama içi bildirim + e-posta/SMS kuyruğu ve gönderici
  jobs.ts                 Zamanlanmış görevler (süre aşımı, hatırlatma, gönderim, temizlik, hesap silme)
  users.ts                Anonimleştirme, KVKK veri dökümü
  routes/                 auth, public, me (müşteri), panel (işletme), admin, uploads
shared/                   İstemci+sunucu ortak: sabitler/etiketler, TL/tarih biçimleri, saat dilimi yardımcıları
client/                   React arayüzü (pages, panel, admin, ui, lib)
scripts/                  migrate, seed-demo, create-admin, jobs, build-client, lint
tests/                    engine.test.ts, api.test.ts, e2e/smoke.ts
```

---

## 4. Randevu motoru

**Müsaitlik** (`server/availability.ts`), seçilen yerel gün için şunları sırayla uygular: işletme çalışma saatleri ∩ çalışanın vardiyası (günde birden fazla aralık desteklenir) → haftalık molalar → çalışan izinleri → işletme kapalı günleri → çalışanın mevcut aktif randevuları (hazırlık ve temizlik süreleri dahil) → istasyon kapasitesi → geçmiş saatler, en erken randevu süresi ve randevu penceresi. Başlangıçlar işletmenin seçtiği aralıkla (5–60 dk) ızgaraya hizalanır.

- **Çalışan ≠ koltuk:** Bir başlangıç ancak hizmetin tamamını yapabilen bir çalışan *ve* (hizmet istasyon gerektiriyorsa) kapasitesi dolmamış uygun bir istasyon varsa verilir.
- **Birden fazla hizmet:** Aynı çalışan art arda yapar; süre = Σ süreler + aradaki temizlik/hazırlık. Gerekli istasyonların kesişimi boşsa kullanıcıya açıkça söylenir.
- **"Fark etmez":** O gün en az randevusu olan uygun çalışan atanır.
- **Saat dilimi:** Tüm zamanlar `timestamptz` (UTC) saklanır; hesaplar işletmenin saat diliminde (varsayılan `Europe/Istanbul`) yapılır.

**Oluşturma** (`server/booking.ts`) tek bir transaction içinde: işletme bazlı danışma kilidi (`pg_advisory_xact_lock`) → idempotency kontrolü → süresi dolan talepleri serbest bırak → müsaitliği **sunucuda yeniden hesapla** → fiyat/süre/hizmet adı ve iptal politikasının **anlık görüntüsünü** sakla. Son savunma hattı olarak veritabanında `EXCLUDE USING gist (employee_id WITH =, occupied WITH &&) WHERE status IN ('pending','confirmed')` kısıtı aynı çalışana çakışan iki aktif randevuyu imkânsız kılar. Aynı istemci anahtarıyla tekrarlanan istek ikinci randevu üretmez (`(business_id, idempotency_key)` benzersiz indeksi).

Durumlar: Beklemede, Onaylandı, Tamamlandı, Müşteri iptal etti, İşletme iptal etti, Reddedildi, Gelmedi, Süresi doldu. Geçişler sunucuda tanımlı bir tabloya göre denetlenir; her geçiş `appointment_events` tablosuna ve denetim kaydına yazılır.

---

## 5. Neler çalışıyor

**Müşteri:** kayıt/giriş/çıkış, e-posta ve telefon doğrulama akışı, şifre sıfırlama, profil; ana sayfa (kategoriler, yakındakiler – GPS izniyle, en yakın müsait randevular, öne çıkanlar, popüler hizmetler, nasıl çalışır, SSS); keşfet (tür, il/ilçe, metin, hizmet, fiyat aralığı, puan, tarih, saat, şu an açık, çalışan seçilebilir, mesafe; 6 sıralama; sayfalama); paylaşılabilir işletme sayfası (hizmetler/fiyatlar, çalışanlar, saatler, harita, galeri, gerçek yorumlar, iptal politikası, favori, paylaş, bildir); 5 adımlı randevu akışı (çoklu hizmet, çalışan seçimi, takvimde müsait günler, gerçek boş saatler, özet, giriş sonrası seçimler URL'de korunur, son onayda yeniden kontrol); randevu numarası; randevularım (yaklaşan/geçmiş/iptal), iptal (politika süresi içinde), saat değiştirme, işletmenin önerdiği saati kabul/ret; favoriler; yorum bırakma/düzenleme (yalnızca tamamlanan randevuya, bir kez); bildirimler; bildirim tercihleri ve **hizmet bildirimlerinden ayrı** pazarlama izinleri; KVKK veri dökümü (JSON), veri sahibi başvurusu, bekleme süreli hesap silme.

**İşletme:** 9 adımlı kurulum sihirbazı (hesap → bilgiler → adres + konum → çalışma saatleri + tatiller → istasyonlar → çalışanlar → hizmetler (hazır şablonlarla) → randevu tercihleri → önizleme + başvuru); genel bakış; takvim (gün/hafta/liste, çalışan sütunları, kapalı/mola/izin taraması, anlık saat çizgisi); randevular (onayla, reddet, iptal, tamamlandı, gelmedi, saat değiştir, yeni saat öner, iç not, işlem geçmişi, manuel randevu); müşteriler (yalnızca bu işletmedeki geçmiş); çalışanlar (vardiya, mola, izin, hizmet yetkinliği, pasifleştirme + yeniden planlanacak randevu listesi, fotoğraf); istasyonlar (kapasite, hizmet bağlantısı); hizmetler (sabit/başlangıç/aralık/danışma fiyatı, hazırlık/temizlik süresi, çalışan/istasyon atama); profil (logo, kapak, galeri, bilgiler, adres); yorumlara yanıt; raporlar; ekip davetleri (sahip/yönetici/çalışan rolleri); paket görüntüleme; randevu ayarları.

**Yönetici:** istatistikler + entegrasyon durumu; işletme başvurularını onaylama / gerekçeli ret / ek bilgi isteme / askıya alma / yeniden yayına alma, konum doğrulama, manuel paket atama; kullanıcı askıya alma; şikâyet ve yorum moderasyonu; kategori ve başlangıç hizmet şablonları; paket özellikleri/limitleri; KVKK başvuruları ve anonimleştirme; e-posta/SMS gönderim kayıtları; işlem/güvenlik kayıtları.

**Rol ayrımı:** Çalışan rolü yalnızca kendi randevularını görür, yalnızca kendi randevusunu tamamlandı/gelmedi işaretler, müşteri telefonlarını ve ciroyu göremez. Davet yalnızca davet edilen e-postaya sahip **ve e-postasını doğrulamış** hesapla kabul edilir.

---

## 6. Güvenlik

- Şifreler scrypt (N=16384) ile; var olmayan hesaplarda da eşit maliyetli kontrol (zamanlama sızıntısını azaltır).
- Oturum token'ı yalnızca HttpOnly + SameSite=Lax (+üretimde Secure) çerezde; veritabanında özeti tutulur. Şifre değişiminde diğer oturumlar kapatılır.
- **CSRF:** tüm değişiklik isteklerinde özel başlık + Origin kontrolü + oturuma bağlı CSRF anahtarı.
- **SQL injection:** tüm sorgular parametreli (postgres.js etiketli şablonlar); `sql.unsafe` yalnızca migration'da (lint ile denetlenir).
- **XSS:** React kaçışlaması, `dangerouslySetInnerHTML` yok (lint ile denetlenir), sıkı **CSP**, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`.
- **Hız sınırlama:** giriş (IP ve e-posta bazlı), kayıt, doğrulama, şifre sıfırlama, randevu, yorum, arama, yükleme.
- **Yüklemeler:** yalnızca JPG/PNG/WEBP, ≤5 MB, uzantı değil gerçek dosya imzası kontrolü, rastgele dosya adı, yol geçişi koruması.
- Hata yanıtlarında yığın izi/iç ayrıntı yok; loglara istek gövdesi, şifre, token veya kod yazılmaz.
- Randevu, yorum ve finansal kayıtlar silinmez: hizmet/istasyon kullanılmışsa pasifleştirilir; kullanıcı silindiğinde randevular anonimleştirilerek korunur.
- Önemli işlemler `audit_logs` tablosuna yazılır.

---

## 7. Eksik entegrasyonlar ve bilinen sınırlamalar (açıkça)

| Konu | Durum |
|---|---|
| **E-posta** | Resend için gönderici yazıldı ancak gerçek anahtarla **test edilmedi**. Anahtar yoksa mesajlar kuyruğa alınır ve "Servis yok — gönderilmedi" olarak işaretlenir; asla gönderilmiş gibi gösterilmez. Doğrulama kodu/şifre sıfırlama bağlantısı yalnızca geliştirme modunda ekranda gösterilir. |
| **SMS** | Netgsm için gönderici yazıldı, gerçek hesapla **test edilmedi**. Aynı şeffaflık kuralları geçerli. |
| **Ödeme / kapora / abonelik tahsilatı** | Yok. Paketler ve limitler çalışır; yükseltme "yakında" olarak gösterilir, yönetici paketi manuel atayabilir. Kart verisi hiçbir yerde saklanmaz. Mimari (`subscriptions.external_provider_reference`, randevu fiyat anlık görüntüsü) iyzico/PayTR gibi bir sağlayıcı eklemeye hazırdır. |
| **Harita** | OpenStreetMap gömülü görünüm ve yol tarifi bağlantısı. Haritaya tıklayarak konum seçme yok; konum GPS ("bulunduğum konumu kullan") veya koordinat ile girilir, yönetici doğrular. |
| **Premium – birden fazla şube** | Paket tanımı var; bir hesap 5 işletmeye kadar oluşturup panelde aralarında geçiş yapabilir, ancak şubeleri tek çatı altında birleştiren raporlama yok. |
| **Dosya depolama** | Yerel disk (`UPLOAD_DIR`). Çok sunuculu dağıtımda S3 uyumlu depoya taşınmalı. |
| **Hız sınırlama** | Süreç içi bellek; çok sunuculu dağıtımda Redis vb. gerekir. |
| **İstasyon kapasitesi > 1** | Muhafazakâr hesap: aralıkla çakışan randevu sayısı kapasiteden azsa uygun sayılır (nadiren gerçekte uygun bir saati kapalı gösterebilir, asla fazladan randevu vermez). |
| **ESLint** | Ortamda kurulamadı; yerine `tsc --strict` (kullanılmayan değişken/parametre dahil) + `scripts/lint.mjs` güvenlik kontrolleri. |
| **Hukuki metinler** | Gizlilik, KVKK aydınlatma, kullanım koşulları ve çerez politikası **taslaktır**; veri sorumlusu bilgileri, VERBİS, 6563 sayılı Kanun (aracı hizmet sağlayıcı/ticari ileti), tüketici mevzuatı bir hukukçu tarafından incelenmelidir. |
| **İletişim sayfası** | Gerçek iletişim kanalları eklenmeli. |

---

## 8. Test kapsamı

`npm test` → 36 test (10 motor birim testi + 26 API entegrasyon testi), gerçek PostgreSQL üzerinde. `npm run test:e2e` → gerçek tarayıcıda: keşfet, işletme sayfası, girişsiz seçim → giriş → seçimlerin korunması → randevu onayı → iptal, işletme panelinin tüm bölümleri, yeni hesapla 9 adımlı sihirbaz → başvuru → yönetici onayı → aramada görünme, mobilde yatay taşma kontrolü, sıfır konsol hatası.

| Spesifikasyon senaryosu | Test |
|---|---|
| 1 kayıt/giriş | api: Yeni müşteri kayıt olup giriş yapabiliyor |
| 2–6 işletme oluşturma, profil, onay, hizmet, çalışan/istasyon | api: 2-6 + e2e sihirbaz |
| 7 çalışan yalnız yetkili hizmet | api: 7-11 |
| 8–10 arama, tarih/saat, müsaitlik | api: 7-11, motor testleri |
| 11 çakışan randevu engeli | api: 7-11, motor: 10:00–10:30 / 10:15 |
| 12 eşzamanlı aynı saat | api: 6 eşzamanlı istekten yalnızca 1 başarılı |
| 13 iptal kapasiteyi açar | api: 13 ve 21 |
| 14 izin ve tatil | api: 14, motor testleri |
| 15 fiyat değişince eski fiyat korunur | api: 15 |
| 16–18 yetkisiz erişim | api: 16, 17, 18 + çalışan rolü testi |
| 19–20 yorum kuralları | api: 19-20 |
| 21 iptal politikası | api: 13 ve 21 |
| 22 mobil/tablet/masaüstü | e2e: 390px'te yatay taşma kontrolü, ekran görüntüleri |
| 23 hata ve boş sonuç | api: 23 |
| 24 tekrarlanan bildirim yok | api: 24 |
| 25 istemci manipülasyonu | api: 25 |
| ek: idempotency, CSRF, hız sınırlama, KVKK, yükleme imzası, manuel onay + süre aşımı, öneri kabulü, çoklu hizmet | api |

---

## 9. Dağıtım

1. PostgreSQL 14+ (Neon, Supabase Postgres, RDS, kendi sunucunuz). Kullanıcının `btree_gist` ve `pgcrypto` eklentilerini oluşturabilmesi gerekir (çoğu yönetilen serviste "trusted" eklentilerdir).
2. `.env` / platform ortam değişkenleri: en az `NODE_ENV=production`, `DATABASE_URL`, `APP_URL=https://…`, ters vekil arkasındaysa `TRUST_PROXY=1`.
3. `npm ci && npm run build && npm run db:migrate && npm start` (Render, Railway, Fly.io, bir VPS + systemd/pm2 — uzun süre çalışan Node süreci gerekir).
4. HTTPS zorunludur (çerezler üretimde `Secure`). Önüne nginx/Caddy/Cloudflare koyabilirsiniz.
5. `UPLOAD_DIR` kalıcı bir diske bağlanmalı.
6. Tek sunucuda zamanlanmış görevler web süreci içinde çalışır. Birden fazla sunucuda `RUN_JOBS_IN_PROCESS=0` yapın ve tek bir `npm run jobs` süreci (veya dakikalık cron ile `npm run jobs -- --once`) çalıştırın; görevler ayrıca veritabanı kilidiyle tekilleştirilir.
7. İlk yönetici: `npm run create-admin`.

**Yedekleme ve kurtarma:** Günlük `pg_dump -Fc` (en az 14 gün saklama) + yönetilen servislerde zaman noktasına geri dönüş (PITR); `UPLOAD_DIR` için günlük senkron yedek. Ayda bir yedekten ayrı bir veritabanına geri yükleme denemesi yapın. Geri yükleme: `pg_restore -d koltuk yedek.dump`.
