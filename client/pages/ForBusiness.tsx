import { useEffect, useState } from 'react';
import { Link } from '../lib/router.tsx';
import { useApi, useDocumentTitle } from '../lib/hooks.ts';
import { useAuth } from '../lib/auth.tsx';
import { ButtonLink, Skeleton, cx } from '../ui/index.tsx';
import { BoostMeter, BrowserFrame, PhoneFrame, VideoBand } from '../components/Media.tsx';
import { IconCalendar, IconCheck, IconChart, IconShield, IconUsers, IconBell, IconTag } from '../ui/icons.tsx';
import { formatTL } from '../../shared/format.ts';

interface PlansResponse {
  plans: { code: string; name: string; tagline: string | null; description: string | null; price_amount: string; features: string[]; is_featured: boolean; feature_limits?: { boost?: number } }[];
  trialDays: number;
  founding: { price: number; maxMonths: number; slotsLeft: number; slots: number; planCode: string };
  onlinePayments: boolean;
}

/** Hero sağı: gerçek işletme paneli kaydı + telefonda randevu kaydı */
function ProductShowcase() {
  return (
    <div className="fb-showcase">
      <BrowserFrame src="/media/isletme-paneli.mp4" poster="/media/isletme-paneli.jpg" label="İşletme paneli: genel bakış, çalışan takvimi, randevu detayı ve raporlar" />
      <div className="fb-showcase-phone">
        <PhoneFrame src="/media/randevu-telefon.mp4" poster="/media/randevu-telefon.jpg" label="Müşterinin telefondan randevu alması" />
      </div>
      <div className="fb-toast" aria-hidden>
        <IconBell size={16} />
        <span><strong>Yeni randevu</strong> · Kadın saç kesimi + fön</span>
      </div>
    </div>
  );
}

function Calculator() {
  const [price, setPrice] = useState(400);
  const [perWeek, setPerWeek] = useState(5);
  const monthly = Math.round(price * perWeek * 4.3);
  const fee = 1000;
  const net = monthly - fee;
  const breakEven = Math.ceil(fee / Math.max(price, 1));
  return (
    <div className="calc">
      <div className="calc-inputs">
        <label className="calc-field" htmlFor="calc-price">
          <span>Ortalama hizmet fiyatın</span>
          <strong className="mono">{formatTL(price)}</strong>
          <input id="calc-price" type="range" min={150} max={2500} step={50} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </label>
        <label className="calc-field" htmlFor="calc-week">
          <span>Online gelen ek randevu (haftada)</span>
          <strong className="mono">{perWeek} randevu</strong>
          <input id="calc-week" type="range" min={1} max={30} step={1} value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))} />
        </label>
      </div>
      <div className="calc-result" aria-live="polite">
        <div className="calc-row"><span>Ek aylık gelir</span><strong className="mono">{formatTL(monthly)}</strong></div>
        <div className="calc-row"><span>Profesyonel paket</span><strong className="mono">− {formatTL(fee)}</strong></div>
        <div className="calc-row calc-net"><span>Sana kalan</span><strong className="mono">{net >= 0 ? formatTL(net) : `− ${formatTL(-net)}`}</strong></div>
        <p>Ayda <strong>{breakEven} ek randevu</strong> paketi çıkarır. Sonrası kâr.</p>
      </div>
    </div>
  );
}

const FAQ: [string, string][] = [
  ['Randevulardan komisyon alıyor musunuz?', 'Hayır. Sabit aylık paket ücreti dışında hiçbir kesinti yok. Kaç randevu alırsanız alın ücret aynı.'],
  ['Müşterilerim KOLTUK’a ödeme yapıyor mu?', 'Hayır. Müşterileriniz randevuyu ücretsiz alır ve hizmet bedelini her zamanki gibi salonda size öder. Platform müşteriden para almaz.'],
  ['Deneme süresinde kart bilgisi gerekiyor mu?', 'Hayır. 30 gün boyunca Profesyonel paketi kartsız ve ücretsiz kullanırsınız.'],
  ['Paket yükseldikçe aramada üste mi çıkıyorum?', 'Evet. “Önerilen” sıralamada üst paketteki işletmeler daha üstte gösterilir: Vitrin > Premium > Profesyonel > Başlangıç > Ücretsiz. Vitrin paketindekiler, müşteri başka bir sıralama seçse bile “Sponsorlu” etiketiyle ilk 2 yere aday olur. Ücretli yerleşimler müşteriye açıkça etiketlenir. Deneme süresi öne çıkarma sağlamaz; puanı çok düşük (3,5 altı) işletmeler öne çıkarılmaz.'],
  ['Deneme bitince ne oluyor?', 'Paket almazsanız işletmeniz Ücretsiz pakete geçer. Randevularınız, müşteri ve hizmet bilgileriniz silinmez.'],
  ['Ödeme nasıl yapılıyor?', 'İşletme panelinizden paketi ve süreyi seçip PayTR güvenli ödeme sayfasında kredi veya banka kartıyla ödersiniz. Paket anında açılır. Kart bilgileriniz bizde saklanmaz.'],
  ['Abonelik otomatik yenilenir mi?', 'Hayır. Seçtiğiniz süre bitmeden size hatırlatma gönderilir. Uzatmak isterseniz tek tıkla yenilersiniz.'],
];

export function ForBusiness() {
  useDocumentTitle('İşletmeni ekle');
  const { user, memberships } = useAuth();
  const { data, loading } = useApi<PlansResponse>('/api/plans');
  const cta = user ? (memberships.length ? `/panel/${memberships[0].business_id}/abonelik` : '/panel/yeni') : '/isletme-kayit';
  const ctaLabel = memberships.length ? 'Paketimi yönet' : `${data?.trialDays ?? 30} gün ücretsiz dene`;
  useEffect(() => {
    if (location.hash === '#paketler') document.getElementById('paketler')?.scrollIntoView();
  }, [loading]);
  const founding = data?.founding;

  return (
    <div className="fb-page">
      <section className="fb-hero">
        <div className="container fb-hero-grid">
          <div className="fb-hero-copy">
            <span className="eyebrow"><IconCalendar size={15} /> Berber, kuaför ve güzellik salonları için</span>
            <h1>Salonun gece gündüz randevu alsın.</h1>
            <p className="hero-lead">Telefon trafiğine son. Müşterilerin boş saatleri görüp kendileri randevu alır, sen takvimini tek ekrandan yönetirsin. Komisyon yok, sürpriz kesinti yok.</p>
            <div className="row">
              <ButtonLink to={cta} size="lg">{ctaLabel}</ButtonLink>
              <a href="#paketler" className="btn btn-secondary btn-lg"><span className="btn-label">Fiyatları gör</span></a>
            </div>
            <ul className="fb-hero-points">
              <li><IconCheck size={16} /> Kart bilgisi gerekmez</li>
              <li><IconCheck size={16} /> Kurulum 10 dakika</li>
              <li><IconCheck size={16} /> Müşteriden ücret alınmaz</li>
            </ul>
          </div>
          <ProductShowcase />
        </div>
      </section>

      <section className="section-sm">
        <div className="container fb-values">
          {[
            [IconCalendar, 'Gerçek müsaitlik', 'Vardiya, mola ve dolu saatler düşülür; aynı saate iki randevu verilemez.'],
            [IconUsers, 'Çalışan ve koltuk', 'Kim hangi hizmeti yapıyor, hangi koltuk boş; sistem hepsini birlikte hesaplar.'],
            [IconBell, 'Daha az gelmeyen müşteri', 'Onay ve hatırlatma bildirimleriyle unutulan randevular azalır.'],
            [IconChart, 'Ciro ve raporlar', 'Günlük randevu, iptal, gelmedi oranı ve çalışan bazında tahmini ciro.'],
          ].map(([I, t, d]) => {
            const Icon = I as typeof IconCalendar;
            return (
              <div key={t as string} className="fb-value">
                <span className="fb-value-icon"><Icon size={20} /></span>
                <strong>{t as string}</strong>
                <p>{d as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      <VideoBand src="/media/salon-telefon.mp4" poster="/media/salon-telefon.jpg" label="Salon sahibi telefonundan randevu takvimine bakıyor, arkada müşteri saçına fön çekiliyor">
        <span className="video-band-eyebrow">Salon sahipleri için</span>
        <h2>Sen işine odaklan, randevular kendiliğinden dolsun.</h2>
        <p>Müşterin gece yarısı bile randevu alır. Sen sabah telefonuna bakıp günün planını görürsün; ne çakışma ne kaçan arama.</p>
      </VideoBand>

      <section className="section" aria-labelledby="hesap">
        <div className="container fb-split">
          <div>
            <h2 id="hesap">Kendini kaç randevuda çıkarır?</h2>
            <p className="muted">Kendi fiyatını ve tahminini gir. Hesap sadece online gelen ek randevuları sayar; mevcut müşterilerin dahil değil.</p>
          </div>
          <Calculator />
        </div>
      </section>

      <section className="section fb-pricing" id="paketler" aria-labelledby="paketler-baslik">
        <div className="container">
          <div className="fb-pricing-head">
            <h2 id="paketler-baslik">Sade fiyatlar, komisyon yok</h2>
            <p className="muted">Fiyatlara KDV dahildir. Tüm yeni işletmeler {data?.trialDays ?? 30} gün Profesyonel paketle başlar. Paket yükseldikçe aramalarda daha üstte çıkarsın.</p>
          </div>
          {founding && founding.slotsLeft > 0 && (
            <div className="fb-founding">
              <div>
                <strong>Kurucu işletme fırsatı</strong>
                <span>İlk {founding.slots} işletmeye Profesyonel paket {founding.maxMonths} ay boyunca aylık <b>{formatTL(founding.price)}</b>.</span>
              </div>
              <span className="fb-founding-left">{founding.slotsLeft} yer kaldı</span>
            </div>
          )}
          <div className="fb-plans five">
            {loading || !data
              ? [0, 1, 2, 3, 4].map((i) => <div key={i} className="fb-plan"><Skeleton h={22} w="50%" /><Skeleton h={40} w="70%" /><Skeleton h={120} /></div>)
              : data.plans.map((p) => {
                  const price = Number(p.price_amount);
                  return (
                    <article key={p.code} className={cx('fb-plan', p.is_featured && 'featured')}>
                      {p.is_featured && <span className="fb-plan-flag">En çok tercih edilen</span>}
                      <header>
                        <h3>{p.name}</h3>
                        <p>{p.tagline}</p>
                      </header>
                      <div className="fb-plan-price">
                        <strong className="mono">{price > 0 ? formatTL(price) : formatTL(0)}</strong>
                        <span>{price > 0 ? '/ ay' : 'her zaman'}</span>
                      </div>
                      {price > 0 && <p className="fb-plan-note">12 ay alana 2 ay hediye</p>}
                      <BoostMeter level={Number(p.feature_limits?.boost ?? 0)} />
                      <ul>
                        {p.features.map((f) => <li key={f}><IconCheck size={16} /> {f}</li>)}
                      </ul>
                      <ButtonLink to={cta} variant={p.is_featured ? 'primary' : 'secondary'} block>
                        {price > 0 ? (memberships.length ? 'Paketi seç' : 'Ücretsiz dene') : 'Ücretsiz başla'}
                      </ButtonLink>
                    </article>
                  );
                })}
          </div>
          <p className="fb-secure"><IconShield size={16} /> Ödemeler PayTR güvenli ödeme altyapısıyla alınır. Abonelik otomatik yenilenmez. <Link to="/iptal-iade">İptal ve iade koşulları</Link></p>
        </div>
      </section>

      <section className="section" aria-labelledby="adimlar">
        <div className="container">
          <h2 id="adimlar">Üç adımda yayındasın</h2>
          <ol className="fb-steps">
            <li><strong>Hesabını aç</strong><span>İşletme adını, adresini ve çalışma saatlerini gir.</span></li>
            <li><strong>Ekibini ve hizmetlerini ekle</strong><span>Hazır hizmet listesinden seç, fiyat ve süreleri belirle.</span></li>
            <li><strong>Linkini paylaş</strong><span>Onaydan sonra Instagram bio’na ve WhatsApp’a randevu linkini koy, randevular gelsin.</span></li>
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container container-narrow">
          <h2>Sık sorulanlar</h2>
          <div className="faq" style={{ marginTop: 12 }}>
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="fb-final">
            <div>
              <h2>Bu hafta ilk online randevunu al.</h2>
              <p>{data?.trialDays ?? 30} gün boyunca tüm Profesyonel özellikler ücretsiz.</p>
            </div>
            <ButtonLink to={cta} size="lg" variant="secondary"><IconTag size={18} /> {ctaLabel}</ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
