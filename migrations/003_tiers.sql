-- 5 paket ve ücretli öne çıkarma (boost). boost: 0..4; yalnızca ÜCRETLİ ve aktif abonelikte (deneme hariç) sıralamayı etkiler.
INSERT INTO plans (code, name, price_amount, sort_order) VALUES ('starter', 'Başlangıç', 600, 2) ON CONFLICT (code) DO NOTHING;
INSERT INTO plans (code, name, price_amount, sort_order) VALUES ('elite', 'Vitrin', 2900, 5) ON CONFLICT (code) DO NOTHING;

UPDATE plans SET tagline = 'Online randevuya ücretsiz başla', sort_order = 1, is_featured = false,
  description = 'Tek başına çalışan berberler için.',
  feature_limits = '{"max_employees": 2, "max_services": 15, "reports": "basic", "reminders": false, "boost": 0}',
  features = '["2 çalışana kadar", "15 hizmete kadar", "Online randevu ve takvim", "İşletme profili ve yorumlar", "Temel istatistikler"]'
WHERE code = 'free';

UPDATE plans SET name = 'Başlangıç', price_amount = 600, tagline = 'Küçük salonlar için', sort_order = 2, is_featured = false,
  description = '2–4 kişilik salonlar için.',
  feature_limits = '{"max_employees": 4, "max_services": 40, "reports": "basic", "reminders": true, "boost": 1}',
  features = '["4 çalışana kadar", "40 hizmete kadar", "Randevu hatırlatmaları", "Aramalarda Ücretsiz paketin üstünde", "Temel istatistikler"]'
WHERE code = 'starter';

UPDATE plans SET name = 'Profesyonel', price_amount = 1000, tagline = 'Büyüyen salonların tercihi', sort_order = 3, is_featured = true,
  description = '3–10 çalışanlı salonlar için tam randevu yönetimi.',
  feature_limits = '{"max_employees": 10, "max_services": 100, "reports": "detailed", "reminders": true, "boost": 2}',
  features = '["10 çalışana kadar", "100 hizmete kadar", "Randevu hatırlatmaları", "Aramalarda Başlangıç paketinin üstünde", "Ayrıntılı raporlar ve ciro takibi", "Ekip hesapları ve yetkiler"]'
WHERE code = 'pro';

UPDATE plans SET name = 'Premium', price_amount = 1750, tagline = 'Daha çok görünmek isteyenler', sort_order = 4, is_featured = false,
  description = 'Yoğun salonlar ve şubeli işletmeler için.',
  feature_limits = '{"max_employees": 25, "max_services": 300, "reports": "advanced", "reminders": true, "multi_branch": true, "boost": 3}',
  features = '["25 çalışana kadar", "300 hizmete kadar", "Aramalarda Profesyonel paketin üstünde", "“Öne çıkan” rozeti", "Ana sayfa vitrininde yer", "Gelişmiş çalışan raporları"]'
WHERE code = 'premium';

UPDATE plans SET name = 'Vitrin', price_amount = 2900, tagline = 'Bölgende en üstte ol', sort_order = 5, is_featured = false,
  description = 'Bölgesinde en çok görünmek isteyen salonlar için.',
  feature_limits = '{"max_employees": 100, "max_services": 500, "reports": "advanced", "reminders": true, "multi_branch": true, "boost": 4}',
  features = '["100 çalışana kadar", "500 hizmete kadar", "Aramalarda en üst sıra", "Her aramada “Sponsorlu” ilk 2 yerden birine aday", "Ana sayfa vitrininde öncelik", "Öncelikli destek"]'
WHERE code = 'elite';
