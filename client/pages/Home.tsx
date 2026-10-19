import { useEffect, useState } from 'react';
import { Link, navigate } from '../lib/router.tsx';
import { useApi, useDocumentTitle } from '../lib/hooks.ts';
import { qs } from '../lib/api.ts';
import { BusinessCard } from '../components/BusinessCard.tsx';
import { SearchPanel } from '../components/SearchPanel.tsx';
import { BusinessVisual } from '../ui/brand.tsx';
import { Button, ButtonLink, Skeleton } from '../ui/index.tsx';
import { IconCalendar, IconCheck, IconCheckCircle, IconChevronRight, IconComb, IconInfo, IconNavigation, IconScissors, IconSparkle } from '../ui/icons.tsx';
import type { BizListItem } from '../types.ts';

interface HomeData {
  nearby: BizListItem[];
  soonest: BizListItem[];
  featured: BizListItem[];
  popularServices: string[];
  realBusinessCount: number;
}
interface Meta {
  serviceSuggestions: { name: string; business_type: string }[];
}

function HeroVisual() {
  const days = [
    ['Sal', '14'],
    ['Çar', '15'],
    ['Per', '16'],
    ['Cum', '17'],
    ['Cmt', '18'],
  ];
  return (
    <div className="hero-visual" aria-hidden>
      <div className="hero-back" />
      <div className="hero-card">
        <div className="hero-card-head">
          <BusinessVisual name="Moda" type="barber" />
          <div>
            <strong>Saç ve sakal</strong>
            <div className="muted small">45 dk · Herhangi bir çalışan</div>
          </div>
        </div>
        <div className="hero-days">
          {days.map(([d, n], i) => (
            <div key={n} className={`hero-day ${i === 1 ? 'active' : ''}`}>
              {d}
              <strong>{n}</strong>
            </div>
          ))}
        </div>
        <div className="hero-slots">
          {['10:00', '10:15', '11:30', '12:00', '14:45', '15:00', '16:30', '17:15'].map((t, i) => (
            <div key={t} className={`hero-slot ${i === 5 ? 'selected' : ''} ${i === 1 || i === 3 ? 'off' : ''}`}>
              {t}
            </div>
          ))}
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted small">Çarşamba, 15:00</span>
          <span className="btn btn-primary btn-sm">Randevuyu onayla</span>
        </div>
      </div>
      <div className="hero-chip" style={{ left: -18, bottom: 34 }}>
        <IconCheckCircle size={18} /> Randevu onaylandı
      </div>
      <div className="hero-chip" style={{ right: -10, top: -14 }}>
        <IconCalendar size={18} /> Gerçek zamanlı müsaitlik
      </div>
    </div>
  );
}

function CardsRow({ items, loading, empty }: { items?: BizListItem[]; loading: boolean; empty: React.ReactNode }) {
  if (loading)
    return (
      <div className="grid-auto">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card" style={{ overflow: 'hidden' }}>
            <Skeleton h={170} r={0} />
            <div style={{ padding: 18 }} className="stack-sm">
              <Skeleton h={18} w="70%" />
              <Skeleton h={14} w="50%" />
              <Skeleton h={14} w="90%" />
            </div>
          </div>
        ))}
      </div>
    );
  if (!items?.length) return <div className="card card-pad muted">{empty}</div>;
  return (
    <div className="grid-auto">
      {items.map((b) => (
        <BusinessCard key={b.id} b={b} />
      ))}
    </div>
  );
}

const FAQ = [
  ['Randevu almak ücretli mi?', 'Hayır. KOLTUK üzerinden randevu oluşturmak müşteriler için ücretsizdir. Hizmet bedelini işletmeye ödersiniz; fiyatları işletmeler belirler.'],
  ['Randevumu nasıl iptal ederim?', '"Randevularım" sayfasından, işletmenin iptal politikasında belirtilen süre dolmadan tek dokunuşla iptal edebilir veya saatini değiştirebilirsiniz.'],
  ['Randevum ne zaman kesinleşir?', 'Bazı işletmeler randevuları anında onaylar. Bazıları ise talebi inceleyip onaylar; bu durumda onaylandığında size bildirim gönderilir.'],
  ['Gördüğüm boş saatler gerçek mi?', 'Evet. Saatler işletmenin çalışma saatleri, çalışanların vardiyaları, molaları ve mevcut randevular üzerinden anlık hesaplanır. Onay anında tekrar kontrol edilir.'],
  ['İşletmemi nasıl eklerim?', '"İşletmeni ekle" sayfasından ücretsiz hesap açıp adım adım kurulum sihirbazını tamamlayın. Başvurunuz incelendikten sonra yayına alınırsınız.'],
  ['Kişisel verilerim nasıl korunuyor?', 'Randevu bilgileriniz yalnızca randevu aldığınız işletmeyle paylaşılır. Verilerinizi hesabınızdan indirebilir veya hesabınızı silebilirsiniz. Ayrıntılar KVKK aydınlatma metnimizde.'],
];

export function Home() {
  useDocumentTitle('Berber, kuaför ve güzellik randevusu');
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const { data, loading } = useApi<HomeData>(`/api/home${qs({ lat: geo?.lat, lng: geo?.lng })}`, [geo]);
  const { data: meta } = useApi<Meta>('/api/meta');

  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }, []);

  const locate = () => {
    if (!navigator.geolocation) {
      setGeoMsg('Tarayıcınız konum özelliğini desteklemiyor. Şehir seçerek arayabilirsiniz.');
      return;
    }
    setGeoMsg('Konumunuz alınıyor…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeo({ lat: Number(p.coords.latitude.toFixed(4)), lng: Number(p.coords.longitude.toFixed(4)) });
        setGeoMsg(null);
      },
      () => setGeoMsg('Konum izni verilmedi. Sorun değil — şehir ve ilçe seçerek arayabilirsiniz.'),
      { timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const hasDemo = [...(data?.nearby ?? []), ...(data?.soonest ?? [])].some((b) => b.is_demo);
  const popular = data?.popularServices.length ? data.popularServices : ['Saç kesimi', 'Saç ve sakal', 'Fön', 'Saç boyama', 'Manikür', 'Kalıcı oje', 'Kaş şekillendirme', 'Cilt bakımı'];

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">
              <IconCalendar size={15} /> Tarzına uygun yer, sana uygun saat.
            </span>
            <h1>Bir sonraki randevun, birkaç dokunuş uzağında.</h1>
            <p className="hero-lead">Çevrendeki berber ve kuaförleri keşfet. Hizmetleri karşılaştır, sana uygun saati seç ve randevunu kolayca oluştur.</p>
            <SearchPanel suggestions={meta?.serviceSuggestions.map((s) => s.name)} />
            <div className="row" style={{ marginTop: 14 }}>
              <Button variant="ghost" size="sm" onClick={locate}>
                <IconNavigation size={16} /> Yakınımdakileri göster
              </Button>
              {geoMsg && <span className="muted small" role="status">{geoMsg}</span>}
            </div>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section className="section-sm">
        <div className="container">
          <div className="category-cards">
            <Link to="/berberler" className="category-card cc-barber">
              <span className="cc-icon"><IconScissors /></span>
              <div>
                <h3>Erkek berberleri</h3>
                <p className="muted" style={{ margin: 0 }}>Saç kesimi, sakal tıraşı, bakım</p>
              </div>
            </Link>
            <Link to="/kuaforler" className="category-card cc-salon">
              <span className="cc-icon"><IconComb /></span>
              <div>
                <h3>Kadın kuaförleri</h3>
                <p className="muted" style={{ margin: 0 }}>Kesim, fön, boya, balyaj, gelin saçı</p>
              </div>
            </Link>
            <Link to="/guzellik-salonlari" className="category-card cc-beauty">
              <span className="cc-icon"><IconSparkle /></span>
              <div>
                <h3>Güzellik salonları</h3>
                <p className="muted" style={{ margin: 0 }}>Manikür, pedikür, kaş, cilt bakımı</p>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {hasDemo && (
        <div className="container" style={{ marginTop: 16 }}>
          <div className="demo-note">
            <IconInfo size={16} /> Platform yeni açıldı: aşağıdaki listelerde <strong>“Örnek işletme”</strong> etiketli kayıtlar demo amaçlıdır, gerçek işletmeleri temsil etmez.
          </div>
        </div>
      )}

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <h2>{geo ? 'Yakınındaki işletmeler' : 'Keşfetmeye başla'}</h2>
              <p>{geo ? 'Konumuna en yakın işletmeler' : 'Önerilen berber, kuaför ve güzellik salonları'}</p>
            </div>
            <ButtonLink to={`/kesfet${qs({ lat: geo?.lat, lng: geo?.lng })}`} variant="secondary" size="sm">
              Tümünü gör <IconChevronRight size={16} />
            </ButtonLink>
          </div>
          <CardsRow items={data?.nearby} loading={loading} empty="Henüz yayında işletme yok. İlk işletmelerden biri olmak ister misiniz?" />
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="section-head">
            <div>
              <h2>En yakın müsait randevular</h2>
              <p>Bugün ve önümüzdeki günlerde boş saati olanlar</p>
            </div>
            <ButtonLink to="/kesfet?sort=soonest" variant="secondary" size="sm">
              Tümünü gör <IconChevronRight size={16} />
            </ButtonLink>
          </div>
          <CardsRow items={data?.soonest} loading={loading} empty="Yakın tarihte boş saat bulunamadı." />
        </div>
      </section>

      {(loading || (data?.featured.length ?? 0) > 0) && (
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="container">
            <div className="section-head">
              <div>
                <h2>Öne çıkan işletmeler</h2>
                <p>Gerçek randevu sonrası bırakılan değerlendirmelere göre</p>
              </div>
            </div>
            <CardsRow items={data?.featured} loading={loading} empty="" />
          </div>
        </section>
      )}

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <h2>Popüler hizmetler</h2>
          <div className="chips" style={{ marginTop: 16 }}>
            {popular.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => navigate(`/kesfet${qs({ service: s })}`)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="nasil-calisir" style={{ scrollMarginTop: 80 }}>
        <div className="container">
          <div className="section-head">
            <div>
              <h2>Nasıl çalışır?</h2>
              <p>Telefon trafiği yok, bekleme yok.</p>
            </div>
          </div>
          <div className="steps">
            {[
              ['İşletmeni bul', 'Şehrine, hizmete, fiyata ve puana göre filtrele; yakınındaki salonları karşılaştır.'],
              ['Hizmeti seç', 'Fiyatları ve süreleri önceden gör. İstersen belirli bir çalışanı seç.'],
              ['Saatini ayarla', 'Gerçekten boş olan saatler arasından sana uyanı seç.'],
              ['Randevuna git', 'Onay ve hatırlatma bildirimlerini al; gerekirse kolayca iptal et veya değiştir.'],
            ].map(([t, d], i) => (
              <div key={t} className="step">
                <div className="step-num">{i + 1}</div>
                <h3>{t}</h3>
                <p className="muted" style={{ margin: 0 }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="for-business">
            <div>
              <h2 style={{ color: '#fff' }}>İşletmeni KOLTUK'a taşı</h2>
              <p>Randevularını tek takvimde yönet, boş koltukları doldur, müşterilerine 7/24 online randevu imkânı sun.</p>
              <ul>
                {['Çalışan ve koltuk bazlı akıllı takvim', 'Çakışmayı imkânsız kılan randevu motoru', 'Otomatik ya da manuel onay seçeneği', 'Günlük ve aylık raporlar'].map((x) => (
                  <li key={x}><IconCheck size={18} /> {x}</li>
                ))}
              </ul>
              <div className="row">
                <ButtonLink to="/isletmeni-ekle" variant="secondary">İşletmeni ücretsiz ekle</ButtonLink>
              </div>
            </div>
            <div className="fb-panel" aria-hidden>
              {[
                ['09:30', 'Saç kesimi · Mert U.'],
                ['10:15', ''],
                ['11:00', 'Saç ve sakal · Can'],
                ['12:30', 'Çocuk saç kesimi · Mert U.'],
                ['14:00', ''],
              ].map(([t, a]) => (
                <div key={t} className="fb-row">
                  <span>{t}</span>
                  {a ? <div className="fb-appt">{a}</div> : <div style={{ color: 'rgba(255,255,255,.35)' }}>Müsait</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container container-narrow">
          <h2>Sıkça sorulan sorular</h2>
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
    </>
  );
}
