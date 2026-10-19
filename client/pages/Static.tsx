import type { ReactNode } from 'react';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useAuth } from '../lib/auth.tsx';
import { Alert, ButtonLink, Card, EmptyState } from '../ui/index.tsx';
import { IconCalendar, IconChart, IconCheck, IconChair, IconShield, IconUsers } from '../ui/icons.tsx';
import { formatTL } from '../../shared/format.ts';
import { LEGAL_DOC_VERSION } from '../../shared/constants.ts';

const LegalNotice = () => (
  <div className="notice-box" style={{ marginBottom: 24 }}>
    <strong>Önemli:</strong> Bu metin taslaktır ve platformun teknik işleyişini yansıtacak şekilde hazırlanmıştır. Yayına almadan önce veri sorumlusu bilgileri (unvan, adres, MERSİS, KEP), VERBİS kaydı ve sektöre özgü yükümlülükler bir hukuk uzmanı tarafından incelenip tamamlanmalıdır. Sürüm: {LEGAL_DOC_VERSION}
  </div>
);

function Legal({ title, children }: { title: string; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="container section-sm">
      <article className="legal">
        <h1>{title}</h1>
        <LegalNotice />
        {children}
      </article>
    </div>
  );
}

export function PrivacyPolicy() {
  return (
    <Legal title="Gizlilik politikası">
      <p>KOLTUK, berber, kuaför ve güzellik salonlarıyla müşterileri buluşturan bir online randevu platformudur. Bu politika, platformu kullanırken hangi verilerin neden işlendiğini açıklar.</p>
      <h2>Topladığımız veriler</h2>
      <ul>
        <li><strong>Hesap verileri:</strong> ad soyad, e-posta, (isteğe bağlı) telefon, şifrenin geri döndürülemez özeti.</li>
        <li><strong>Randevu verileri:</strong> seçilen işletme, hizmet, çalışan, tarih/saat, işletmeye bıraktığınız not, randevu durumu ve oluşturma anındaki fiyat bilgisi.</li>
        <li><strong>Değerlendirmeler:</strong> tamamlanan randevular için bıraktığınız puan ve yorum.</li>
        <li><strong>Güvenlik kayıtları:</strong> oturum bilgisi, IP adresi ve önemli işlemlerin denetim kayıtları.</li>
        <li><strong>Konum:</strong> yalnızca izin verdiğinizde, yakındaki işletmeleri listelemek için anlık olarak kullanılır; sunucuda saklanmaz.</li>
      </ul>
      <h2>Verilerin kimlerle paylaşıldığı</h2>
      <p>Randevu bilgileriniz (ad, telefon, randevu detayları) yalnızca randevu aldığınız işletmeyle paylaşılır. İşletme çalışanları yalnızca kendi randevularını görür; telefon numaranızı yalnızca işletme sahibi ve yöneticileri görebilir. Yapılandırıldığında e-posta ve SMS gönderimi için hizmet sağlayıcılar kullanılır.</p>
      <h2>Saklama süresi</h2>
      <p>Hesabınızı sildiğinizde kişisel bilgileriniz bekleme süresinin sonunda anonimleştirilir. Randevu kayıtları, işletmelerin yasal yükümlülükleri için kimliğinizden ayrılmış olarak saklanabilir.</p>
      <h2>Haklarınız</h2>
      <p>"Hesap ve gizlilik" sayfasından verilerinizi indirebilir, KVKK kapsamındaki başvurularınızı iletebilir ve hesabınızı silebilirsiniz.</p>
    </Legal>
  );
}

export function KvkkNotice() {
  return (
    <Legal title="KVKK aydınlatma metni">
      <p>6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca, veri sorumlusu sıfatıyla [Şirket unvanı — doldurulacak] tarafından kişisel verileriniz aşağıda açıklanan kapsamda işlenmektedir.</p>
      <h2>İşleme amaçları</h2>
      <ul>
        <li>Üyelik oluşturulması ve hesabın güvenliğinin sağlanması,</li>
        <li>Randevuların oluşturulması, yönetilmesi ve ilgili işletmeye iletilmesi,</li>
        <li>Randevu onayı, değişikliği, iptali ve hatırlatma bildirimlerinin gönderilmesi,</li>
        <li>Değerlendirme ve şikâyet süreçlerinin yürütülmesi,</li>
        <li>Hukuki yükümlülüklerin yerine getirilmesi ve olası uyuşmazlıklarda delil olarak kullanılması.</li>
      </ul>
      <h2>Hukuki sebepler</h2>
      <p>Verileriniz KVKK m.5/2 kapsamında sözleşmenin kurulması ve ifası, hukuki yükümlülük ve meşru menfaat hukuki sebeplerine dayanılarak işlenir. Pazarlama amaçlı ticari elektronik iletiler yalnızca ayrıca verdiğiniz onay ile gönderilir ve bu onayı istediğiniz zaman geri alabilirsiniz.</p>
      <h2>Aktarım</h2>
      <p>Randevu bilgileriniz, randevunun gerçekleştirilmesi amacıyla randevu aldığınız işletmeye aktarılır. Yurt dışında yerleşik hizmet sağlayıcı kullanılması halinde KVKK m.9 kapsamındaki şartlar ayrıca değerlendirilmelidir.</p>
      <h2>Haklarınız (KVKK m.11)</h2>
      <p>Verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, düzeltilmesini veya silinmesini isteme, itiraz etme ve zararın giderilmesini talep etme haklarına sahipsiniz. Başvurularınızı hesabınızdaki "Hesap ve gizlilik" bölümünden iletebilirsiniz.</p>
    </Legal>
  );
}

export function Terms() {
  return (
    <Legal title="Kullanım koşulları">
      <h2>Hizmetin kapsamı</h2>
      <p>KOLTUK, müşterilerin işletmelerden online randevu almasını sağlayan bir aracı platformdur. Hizmetin kendisi (saç kesimi, bakım vb.) işletme tarafından sunulur; hizmet kalitesi, fiyat ve tahsilat işletmenin sorumluluğundadır.</p>
      <h2>Randevular ve iptal</h2>
      <p>Her işletme kendi iptal politikasını belirler ve bu politika randevu sırasında gösterilir. Belirtilen süreden sonra platform üzerinden iptal yapılamaz.</p>
      <h2>Fiyatlar</h2>
      <p>Fiyatlar işletmeler tarafından belirlenir. "Başlangıç fiyatı", "fiyat aralığı" veya "danışma sonrası" olarak belirtilen hizmetlerde kesin tutar işletmede netleşir. Platform şu anda online ödeme almamaktadır.</p>
      <h2>Değerlendirmeler</h2>
      <p>Yalnızca tamamlanmış randevular için değerlendirme yapılabilir. Hakaret, kişisel veri veya yanıltıcı içerik barındıran yorumlar kaldırılabilir.</p>
      <h2>İşletmeler</h2>
      <p>İşletmeler, verdikleri bilgilerin doğruluğundan sorumludur. Platform yönetimi, sahte veya kurallara aykırı işletme hesaplarını reddetme veya askıya alma hakkını saklı tutar.</p>
      <p className="muted small">Mesafeli sözleşmeler, ticari elektronik ileti ve aracı hizmet sağlayıcı yükümlülükleri (6563 sayılı Kanun ve ilgili yönetmelikler) yayın öncesinde hukuk danışmanı ile değerlendirilmelidir.</p>
    </Legal>
  );
}

export function CookiePolicy() {
  return (
    <Legal title="Çerez politikası">
      <p>KOLTUK yalnızca hizmetin çalışması için zorunlu olan çerezleri kullanır:</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Çerez</th><th>Amaç</th><th>Süre</th></tr></thead>
          <tbody>
            <tr><td className="mono">koltuk_session</td><td>Oturumunuzu güvenle açık tutar (HttpOnly, SameSite=Lax).</td><td>30 gün</td></tr>
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 16 }}>Ayrıca tarayıcınızın yerel deposunda çerez bildirimini gördüğünüz ve randevu adımlarındaki geçici seçimleriniz tutulur. Reklam, izleme veya analitik çerezi kullanılmamaktadır. İleride analitik araçları eklenirse yalnızca açık rızanızla etkinleştirilecek ve bu sayfa güncellenecektir.</p>
    </Legal>
  );
}

export function About() {
  useDocumentTitle('Hakkımızda');
  return (
    <div className="container container-narrow section">
      <h1>Hakkımızda</h1>
      <p className="hero-lead">KOLTUK; berberleri, kuaförleri ve güzellik salonlarını müşterileriyle tek dokunuşla buluşturmak için tasarlandı.</p>
      <p>Telefonla randevu kovalamak, boş saat sormak ve unutulan randevular hem müşterinin hem işletmenin zamanını alıyor. KOLTUK, gerçek müsaitlik bilgisini gösteren ve çakışmayı imkânsız kılan bir randevu altyapısı sunar.</p>
      <p>Değerlendirmeler yalnızca gerçekten hizmet almış müşterilerden gelir; işletmeler yayına alınmadan önce incelenir.</p>
    </div>
  );
}

export function Contact() {
  useDocumentTitle('İletişim');
  return (
    <div className="container container-narrow section">
      <h1>İletişim</h1>
      <Alert tone="info">İletişim kanalları (destek e-postası, telefon, adres) yayın öncesinde platform işletmecisi tarafından eklenmelidir.</Alert>
      <p style={{ marginTop: 16 }}>Hesabınızla veya bir randevuyla ilgili sorunlarda, giriş yaptıktan sonra ilgili işletme ya da yorumu "Bildir" seçeneğiyle iletebilirsiniz. Kişisel verilerinizle ilgili talepleriniz için "Hesap ve gizlilik" sayfasını kullanın.</p>
    </div>
  );
}

export function ForBusiness() {
  useDocumentTitle('İşletmeni ekle');
  const { user, memberships } = useAuth();
  const cta = user ? (memberships.length ? `/panel/${memberships[0].business_id}` : '/panel/yeni') : '/isletme-kayit';
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow"><IconChair size={15} /> İşletmeler için</span>
            <h1>Koltukların boş kalmasın.</h1>
            <p className="hero-lead">Online randevu, çalışan ve koltuk bazlı takvim, otomatik hatırlatmalar ve raporlar. Kurulum birkaç dakika sürer.</p>
            <div className="row">
              <ButtonLink to={cta} size="lg">{memberships.length ? 'İşletme paneline git' : 'Ücretsiz başla'}</ButtonLink>
              <ButtonLink to="/isletmeni-ekle#paketler" variant="secondary" size="lg">Paketler</ButtonLink>
            </div>
          </div>
          <div className="stack">
            {[
              [IconCalendar, 'Gerçek zamanlı müsaitlik', 'Çalışma saatleri, vardiyalar, molalar ve mevcut randevular anlık hesaplanır; aynı saate iki randevu verilemez.'],
              [IconUsers, 'Çalışan ve istasyon yönetimi', 'Hangi çalışanın hangi hizmeti yaptığını, boya istasyonu gibi kısıtlı kaynakları ayrı ayrı tanımlayın.'],
              [IconShield, 'Onaylı ve güvenilir', 'İşletmeler incelenerek yayına alınır; yorumlar yalnızca gerçek randevulardan gelir.'],
              [IconChart, 'Raporlar', 'Günlük ve aylık randevu, iptal, gelmedi oranları ve tahmini hizmet tutarları.'],
            ].map(([I, t, d]) => {
              const Icon = I as typeof IconCalendar;
              return (
                <Card key={t as string}>
                  <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                    <span className="empty-icon" style={{ width: 44, height: 44, margin: 0, flexShrink: 0 }}><Icon size={20} /></span>
                    <div><strong>{t as string}</strong><p className="muted small" style={{ margin: 0 }}>{d as string}</p></div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </section>
      <section className="section" id="paketler">
        <div className="container">
          <h2>Paketler</h2>
          <p className="muted">Ödeme altyapısı henüz bağlanmadığı için tüm işletmeler şu an Ücretsiz paketle başlar. Ücretli paketler ödeme entegrasyonu tamamlandığında aktifleşecektir.</p>
          <PlansGrid />
        </div>
      </section>
    </>
  );
}

function PlansGrid() {
  const plans = [
    { name: 'Ücretsiz', price: 0, items: ['İşletme profili', 'Temel hizmet listesi (15 hizmete kadar)', 'Temel randevu yönetimi', '2 çalışana kadar', 'Sınırlı istatistikler'] },
    { name: 'Profesyonel', price: null, items: ['Gelişmiş takvim', 'Ayrıntılı raporlar', '10 çalışana kadar', 'Hatırlatma özellikleri', 'Daha fazla özelleştirme'] },
    { name: 'Premium', price: null, items: ['Gelişmiş işletme analizi', 'Birden fazla şube', 'Gelişmiş çalışan raporları', 'Öne çıkarma seçenekleri', 'Gelişmiş yönetim'] },
  ];
  return (
    <div className="grid-3" style={{ marginTop: 20 }}>
      {plans.map((p, i) => (
        <Card key={p.name} className={i === 1 ? 'stack' : 'stack'}>
          <h3>{p.name}</h3>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{p.price === 0 ? formatTL(0) : <span className="muted" style={{ fontSize: '1rem' }}>Fiyat yakında</span>}</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack-sm">
            {p.items.map((x) => <li key={x} className="row small" style={{ gap: 8, flexWrap: 'nowrap' }}><IconCheck size={16} style={{ color: 'var(--green)', flexShrink: 0 }} /> {x}</li>)}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export function NotFound() {
  useDocumentTitle('Sayfa bulunamadı');
  return (
    <div className="container section">
      <EmptyState title="Sayfa bulunamadı" action={<ButtonLink to="/">Ana sayfaya dön</ButtonLink>}>Aradığınız sayfa taşınmış veya hiç var olmamış olabilir.</EmptyState>
    </div>
  );
}
