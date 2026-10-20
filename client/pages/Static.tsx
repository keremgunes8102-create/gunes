import type { ReactNode } from 'react';
import { useDocumentTitle } from '../lib/hooks.ts';
import { Alert, ButtonLink, EmptyState } from '../ui/index.tsx';
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

export function DistanceSales() {
  return (
    <Legal title="Mesafeli hizmet sözleşmesi (işletme aboneliği)">
      <p>Bu sözleşme, KOLTUK platformunda işletme hesabı açan ve ücretli pakete abone olan işletme ("Abone") ile platform işletmecisi ("Hizmet sağlayıcı") arasındadır.</p>
      <h2>Taraflar</h2>
      <p>Hizmet sağlayıcı: [Unvan, adres, vergi dairesi/no, MERSİS, e-posta, telefon — doldurulacak]. Abone: işletme hesabında kayıtlı işletme ve sahibi.</p>
      <h2>Hizmetin konusu</h2>
      <p>Online randevu, takvim, çalışan ve hizmet yönetimi yazılımına seçilen paket kapsamında süreli erişim. Hizmet tamamen elektronik ortamda sunulur; fiziksel teslimat yoktur.</p>
      <h2>Bedel ve ödeme</h2>
      <p>Paket bedelleri KDV dahil olarak satın alma ekranında gösterilir. Ödeme PayTR güvenli ödeme altyapısıyla kredi veya banka kartından tek seferde alınır. Kart bilgileri KOLTUK sunucularında saklanmaz. Abonelik otomatik yenilenmez; süre bitiminde işletme Ücretsiz pakete geçer.</p>
      <h2>Platform müşterilerden ödeme almaz</h2>
      <p>KOLTUK, randevu alan son kullanıcılardan herhangi bir ücret tahsil etmez ve işletme adına ödeme kabul etmez. Hizmet bedeli işletmede, işletme ile müşteri arasında ödenir.</p>
      <h2>Cayma hakkı</h2>
      <p>Abone, ticari veya mesleki amaçla hareket eden bir işletmedir. Tüketici sıfatıyla işlem yapılması halinde, elektronik ortamda anında ifasına başlanan hizmetlerde cayma hakkına ilişkin istisnalar Mesafeli Sözleşmeler Yönetmeliği çerçevesinde değerlendirilir. İade koşulları "İptal ve iade koşulları" sayfasında açıklanmıştır.</p>
      <h2>Uyuşmazlık</h2>
      <p>[Yetkili mahkeme ve icra daireleri — doldurulacak]</p>
    </Legal>
  );
}

export function RefundPolicy() {
  return (
    <Legal title="İptal ve iade koşulları">
      <ul>
        <li>Yeni işletmeler 30 gün boyunca Profesyonel paketi ücretsiz dener; deneme süresi için kart bilgisi istenmez ve ücret alınmaz.</li>
        <li>Ücretli paketler otomatik yenilenmez. Süre bitiminde hesap kendiliğinden Ücretsiz pakete geçer; işletme verileri silinmez.</li>
        <li>Ödemeden sonraki 14 gün içinde paketi hiç kullanmadıysanız (paket özelliklerinden yararlanmadıysanız) tam iade talep edebilirsiniz.</li>
        <li>Teknik bir arıza nedeniyle hizmet 72 saatten uzun süre kesintiye uğrarsa, kullanılamayan süre kadar ücretsiz uzatma yapılır.</li>
        <li>Mükerrer veya hatalı çekimler tespit edildiğinde 7 iş günü içinde kartınıza iade edilir. İadeler PayTR üzerinden ödemenin yapıldığı karta yapılır; kartınıza yansıma süresi bankanıza bağlıdır.</li>
        <li>İade ve iptal talepleriniz için: [destek e-postası / WhatsApp — doldurulacak].</li>
      </ul>
    </Legal>
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
