// Tarayıcı üzerinden uçtan uca duman testi (çalışan sunucu + demo verisi gerektirir).
// Kullanım: npm run db:reset && npm start (ayrı terminal) && npm run test:e2e
// Ortam: BASE_URL (varsayılan http://localhost:3000), SHOTS_DIR (ekran görüntüleri için isteğe bağlı)
import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR;
const errors: string[] = [];

async function shot(p: Page, name: string) {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function login(p: Page, email: string) {
  await p.goto(`${BASE}/giris`);
  await p.getByLabel('E-posta').fill(email);
  await p.getByLabel('Şifre').fill('Demo1234');
  await p.getByRole('button', { name: 'Giriş yap' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && errors.push(`console: ${m.text()}`));
  await p.addInitScript(() => { try { localStorage.setItem('koltuk_cookie_notice_v1', '1'); } catch { /* about:blank */ } });

  // 1) Keşfet ve filtre
  await p.goto(`${BASE}/kesfet?type=barber`);
  await p.getByText('işletme bulundu').waitFor();
  const cards = await p.locator('.biz-card').count();
  assert.ok(cards >= 3, 'berber kartları görünmeli');
  await shot(p, 'kesfet');

  // 2) İşletme detayı
  await p.goto(`${BASE}/isletme/ornek-berber-moda`);
  await p.getByRole('heading', { name: 'Örnek Berber Moda' }).waitFor();
  await shot(p, 'isletme');

  // 3) Randevu akışı: giriş yapmadan seçim -> giriş -> seçimler korunur -> onay
  await p.goto(`${BASE}/randevu/ornek-berber-moda`);
  await p.getByRole('button', { name: /Saç kesimi/ }).click();
  await p.getByRole('button', { name: 'Devam et' }).click();
  const anyEmp = p.getByRole('button', { name: /Fark etmez/ });
  if (await anyEmp.isVisible().catch(() => false)) await anyEmp.click();
  await p.locator('.calendar-day.available').nth(2).click();
  await p.locator('.slot').first().click();
  await p.getByRole('heading', { name: 'Randevu özeti' }).waitFor();
  await shot(p, 'randevu-ozet');
  await p.getByRole('link', { name: 'Giriş yap' }).last().click();
  await p.getByLabel('E-posta').fill('musteri@koltuk.demo');
  await p.getByLabel('Şifre').fill('Demo1234');
  await p.getByRole('button', { name: 'Giriş yap' }).click();
  await p.getByRole('heading', { name: 'Randevu özeti' }).waitFor();
  await p.getByRole('button', { name: /Randevuyu onayla/ }).click();
  await p.waitForURL(/\/randevu-onay\//);
  const ref = (await p.locator('.ref-code').textContent())!.trim();
  assert.match(ref, /^KLT-/);
  await shot(p, 'randevu-onay');

  // 4) Randevularım ve iptal
  await p.goto(`${BASE}/hesabim/randevular/${ref}`);
  await p.getByRole('button', { name: 'Randevuyu iptal et' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'İptal et' }).click();
  await p.getByText('Müşteri iptal etti').first().waitFor();
  await shot(p, 'randevu-detay');
  await p.goto(`${BASE}/hesabim/gizlilik`);
  await p.getByRole('heading', { name: 'Hesap ve gizlilik' }).waitFor();

  // 5) İşletme paneli
  await p.context().clearCookies();
  await login(p, 'isletme@koltuk.demo');
  await p.goto(`${BASE}/panel`);
  await p.getByRole('heading', { name: 'Genel bakış' }).waitFor();
  await shot(p, 'panel-genel');
  await p.getByRole('link', { name: 'Takvim' }).first().click();
  await p.getByRole('heading', { name: 'Takvim' }).waitFor();
  await p.getByRole('radio', { name: 'Hafta' }).click();
  await p.waitForTimeout(500);
  await shot(p, 'panel-takvim');
  for (const [link, heading] of [
    ['Randevular', 'Randevular'], ['Müşteriler', 'Müşteriler'], ['Çalışanlar', 'Çalışanlar'], ['Hizmetler ve fiyatlar', 'Hizmetler ve fiyatlar'],
    ['Çalışma saatleri', 'Çalışma saatleri'], ['İşletme profili', 'İşletme profili'], ['Raporlar', 'Raporlar'], ['Randevu ayarları', 'Randevu ayarları'], ['Ekip ve yetkiler', 'Ekip ve yetkiler'],
  ] as const) {
    await p.locator('.sidebar').getByRole('link', { name: link, exact: true }).click();
    await p.getByRole('heading', { name: heading, exact: true }).first().waitFor();
  }
  await shot(p, 'panel-ekip');

  // 6) Yeni işletme kurulum sihirbazı (yeni hesapla)
  await p.context().clearCookies();
  const email = `sihirbaz${Date.now()}@ornek.test`;
  const bizName = `Sihirbaz Berber ${String(Date.now()).slice(-5)}`;
  await p.goto(`${BASE}/isletme-kayit`);
  await p.getByLabel('Ad soyad').fill('Sihirbaz Test');
  await p.getByRole('textbox', { name: 'E-posta' }).fill(email);
  await p.getByLabel(/Cep telefonu/).fill(`0532${String(Date.now()).slice(-7)}`);
  await p.getByLabel('Şifre', { exact: true }).fill('Sifre1234');
  await p.getByLabel(/aydınlatma metnini/).check();
  await p.getByLabel(/Kullanım koşullarını/).check();
  await p.getByRole('button', { name: /Hesabı oluştur/ }).click();
  await p.waitForURL(/\/panel\/yeni/);
  await p.getByLabel('İşletme adı').fill(bizName);
  await p.getByLabel('İşletme telefonu').fill('0216 555 44 33');
  await p.getByRole('button', { name: 'Kaydet ve devam et' }).click();
  await p.waitForURL(/kurulum\?adim=3/);
  await p.getByLabel('İlçe').fill('Kadıköy');
  await p.getByLabel('Açık adres').fill('Test Sokak No 5');
  await p.getByRole('button', { name: 'Kaydet ve devam et' }).click();
  await p.getByRole('heading', { name: 'Çalışma saatleri' }).waitFor();
  await p.getByRole('button', { name: 'Kaydet ve devam et' }).click();
  await p.getByRole('heading', { name: 'Koltuk ve istasyonlar' }).waitFor();
  await shot(p, 'sihirbaz-istasyon');
  await p.getByRole('button', { name: 'Devam et →' }).click();
  await p.getByRole('heading', { name: 'Çalışanlar', exact: true }).waitFor();
  await p.getByRole('button', { name: 'Çalışan ekle' }).click();
  await p.getByLabel('Görünen ad').fill('Usta Bir');
  await p.getByRole('dialog').getByRole('button', { name: 'Kaydet' }).click();
  await p.getByText('Usta Bir').waitFor();
  await p.getByRole('button', { name: 'Devam et →' }).click();
  await p.getByRole('heading', { name: 'Hizmetler', exact: true }).waitFor();
  await p.getByRole('button', { name: '+ Saç kesimi' }).click();
  await p.getByLabel('Fiyat (TL)').fill('450');
  await p.getByRole('dialog').getByRole('button', { name: 'Kaydet' }).click();
  await p.locator('table').getByText('Saç kesimi').waitFor();
  await shot(p, 'sihirbaz-hizmet');
  await p.getByRole('button', { name: 'Devam et →' }).click();
  await p.getByRole('heading', { name: 'Randevu tercihleri' }).waitFor();
  await p.getByRole('button', { name: 'Kaydet ve devam et' }).click();
  await p.getByRole('heading', { name: 'Önizleme ve başvuru' }).waitFor();
  await p.getByRole('button', { name: 'Başvuruyu gönder' }).click();
  await p.getByText('Başvurunuz inceleniyor').first().waitFor();

  // 7) Yönetici onayı
  await p.context().clearCookies();
  await login(p, 'admin@koltuk.demo');
  await p.goto(`${BASE}/yonetim/basvurular`);
  await p.getByText(bizName).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Onayla' }).click();
  await p.getByText('Karar kaydedildi').waitFor();
  await p.keyboard.press('Escape');
  await shot(p, 'yonetim-isletmeler');
  await p.goto(`${BASE}/yonetim`);
  await p.getByRole('heading', { name: 'Genel bakış' }).waitFor();
  await shot(p, 'yonetim-genel');
  await p.goto(`${BASE}/kesfet?q=${encodeURIComponent(bizName)}`);
  await p.getByRole('link', { name: bizName }).waitFor();

  // 8) Mobil görünüm
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  m.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  await m.addInitScript(() => { try { localStorage.setItem('koltuk_cookie_notice_v1', '1'); } catch { /* about:blank */ } });
  for (const path of ['/', '/kesfet', '/isletme/ornek-kuafor-nisantasi', '/randevu/ornek-kuafor-nisantasi?s=x']) {
    await m.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${path} mobilde yatay taşma: ${overflow}px`);
  }
  await m.goto(`${BASE}/isletme/ornek-kuafor-nisantasi`, { waitUntil: 'networkidle' });
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/mobil-isletme.png`, fullPage: false });
  await m.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/mobil-anasayfa.png`, fullPage: false });

  await browser.close();
  assert.deepEqual(errors, [], `Tarayıcı hataları:\n${errors.join('\n')}`);
  console.log('E2E duman testi başarılı ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
