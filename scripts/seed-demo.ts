// YALNIZCA GELİŞTİRME / DEMO ortamı için örnek veriler.
// Tüm işletmeler "is_demo = true" olarak işaretlenir ve arayüzde "Örnek işletme" etiketiyle gösterilir.
// Gerçek bir işletmeyi veya kişiyi temsil etmez.
import { config } from '../server/config.ts';
import { sql, closeDb } from '../server/db.ts';
import { hashPassword } from '../server/security.ts';
import { createAppointment } from '../server/booking.ts';
import { addDaysLocal, localDateOf, zonedToUtc } from '../shared/time.ts';
import { LEGAL_DOC_VERSION } from '../shared/constants.ts';

if (config.isProduction && process.env.ALLOW_DEMO_SEED !== '1') {
  console.error('Üretim ortamında demo verisi yüklenemez.');
  process.exit(1);
}

const TZ = 'Europe/Istanbul';
const PASSWORD = 'Demo1234';

type Svc = { name: string; cat: string; dur: number; price: number | null; type?: 'fixed' | 'starting_from' | 'range' | 'consultation'; max?: number; prep?: number; clean?: number; station?: string };
type Emp = { name: string; title: string; services: string[] | 'all'; days: number[]; start: string; end: string; brk?: [string, string] };
type Biz = {
  name: string; type: 'barber' | 'hair_salon' | 'beauty'; cat: string; city: string; district: string; neighborhood: string; address: string;
  lat: number; lng: number; description: string; hours: { days: number[]; start: string; end: string }[]; auto: boolean;
  stations: { name: string; type: string; capacity?: number; services: string[] }[]; services: Svc[]; employees: Emp[];
};

const businesses: Biz[] = [
  {
    name: 'Örnek Berber Moda', type: 'barber', cat: 'erkek-berberi', city: 'İstanbul', district: 'Kadıköy', neighborhood: 'Caferağa',
    address: 'Örnek Sokak No:1 (demo adres)', lat: 40.9862, lng: 29.0256, auto: true,
    description: 'Klasik ve modern erkek kesimleri, sıcak havlu ile sakal tıraşı. (Örnek işletme — demo içerik)',
    hours: [{ days: [0, 1, 2, 3, 4, 5], start: '09:00', end: '20:00' }, { days: [6], start: '10:00', end: '16:00' }],
    stations: [], services: [
      { name: 'Saç kesimi', cat: 'erkek-berberi', dur: 30, price: 400 },
      { name: 'Saç ve sakal', cat: 'erkek-berberi', dur: 45, price: 550 },
      { name: 'Sakal tıraşı', cat: 'erkek-berberi', dur: 20, price: 200, clean: 5 },
      { name: 'Çocuk saç kesimi', cat: 'erkek-berberi', dur: 25, price: 300 },
      { name: 'Saç bakımı', cat: 'erkek-berberi', dur: 30, price: 350, type: 'starting_from' },
    ],
    employees: [
      { name: 'Mert Usta', title: 'Kıdemli berber', services: 'all', days: [0, 1, 2, 3, 4, 5], start: '09:00', end: '18:00', brk: ['13:00', '13:45'] },
      { name: 'Can', title: 'Berber', services: ['Saç kesimi', 'Saç ve sakal', 'Sakal tıraşı'], days: [1, 2, 3, 4, 5, 6], start: '11:00', end: '20:00', brk: ['15:00', '15:30'] },
    ],
  },
  {
    name: 'Örnek Berber Beşiktaş', type: 'barber', cat: 'erkek-berberi', city: 'İstanbul', district: 'Beşiktaş', neighborhood: 'Sinanpaşa',
    address: 'Örnek Cadde No:12 (demo adres)', lat: 41.0438, lng: 29.0049, auto: false,
    description: 'Randevulu çalışan, sakin bir berber salonu. Talepler işletme onayıyla kesinleşir. (Örnek işletme)',
    hours: [{ days: [0, 1, 2, 3, 4], start: '10:00', end: '21:00' }, { days: [5], start: '09:00', end: '21:00' }],
    stations: [], services: [
      { name: 'Saç kesimi', cat: 'erkek-berberi', dur: 40, price: 500 },
      { name: 'Saç ve sakal', cat: 'erkek-berberi', dur: 60, price: 700 },
      { name: 'Fön ve şekillendirme', cat: 'erkek-berberi', dur: 15, price: 150 },
      { name: 'Saç yıkama', cat: 'erkek-berberi', dur: 10, price: 100 },
    ],
    employees: [{ name: 'Emre', title: 'Berber', services: 'all', days: [0, 1, 2, 3, 4, 5], start: '10:00', end: '21:00', brk: ['14:00', '15:00'] }],
  },
  {
    name: 'Örnek Berber Çankaya', type: 'barber', cat: 'erkek-berberi', city: 'Ankara', district: 'Çankaya', neighborhood: 'Kızılay',
    address: 'Örnek Bulvar No:5 (demo adres)', lat: 39.9208, lng: 32.8541, auto: true,
    description: 'Hızlı ve özenli erkek bakımı. (Örnek işletme — demo içerik)',
    hours: [{ days: [0, 1, 2, 3, 4, 5], start: '08:30', end: '19:30' }],
    stations: [], services: [
      { name: 'Saç kesimi', cat: 'erkek-berberi', dur: 30, price: 350 },
      { name: 'Sakal tıraşı', cat: 'erkek-berberi', dur: 20, price: 180 },
      { name: 'Saç ve sakal', cat: 'erkek-berberi', dur: 45, price: 480 },
    ],
    employees: [
      { name: 'Hakan', title: 'Berber', services: 'all', days: [0, 1, 2, 3, 4], start: '08:30', end: '17:30' },
      { name: 'Yusuf', title: 'Berber', services: 'all', days: [1, 2, 3, 4, 5], start: '10:30', end: '19:30' },
    ],
  },
  {
    name: 'Örnek Kuaför Nişantaşı', type: 'hair_salon', cat: 'kadin-kuaforu', city: 'İstanbul', district: 'Şişli', neighborhood: 'Teşvikiye',
    address: 'Örnek Sokak No:7 (demo adres)', lat: 41.0522, lng: 28.9936, auto: true,
    description: 'Renklendirme, kesim ve özel gün saçları. Boya işlemleri boya istasyonunda yapılır. (Örnek işletme)',
    hours: [{ days: [1, 2, 3, 4, 5], start: '10:00', end: '20:00' }, { days: [6], start: '11:00', end: '18:00' }],
    stations: [
      { name: 'Koltuk 1', type: 'chair', services: ['Kadın saç kesimi', 'Fön', 'Maşa ve şekillendirme'] },
      { name: 'Koltuk 2', type: 'chair', services: ['Kadın saç kesimi', 'Fön', 'Maşa ve şekillendirme'] },
      { name: 'Boya istasyonu', type: 'color', capacity: 1, services: ['Saç boyama', 'Dip boya', 'Balyaj'] },
    ],
    services: [
      { name: 'Kadın saç kesimi', cat: 'kadin-kuaforu', dur: 45, price: 900 },
      { name: 'Fön', cat: 'kadin-kuaforu', dur: 30, price: 450 },
      { name: 'Maşa ve şekillendirme', cat: 'kadin-kuaforu', dur: 45, price: 700, type: 'starting_from' },
      { name: 'Saç boyama', cat: 'kadin-kuaforu', dur: 120, price: 2000, max: 3500, type: 'range', prep: 10, clean: 15 },
      { name: 'Dip boya', cat: 'kadin-kuaforu', dur: 90, price: 1500, prep: 10, clean: 10 },
      { name: 'Balyaj', cat: 'kadin-kuaforu', dur: 180, price: null, type: 'consultation', prep: 10, clean: 15 },
    ],
    employees: [
      { name: 'Selin', title: 'Renk uzmanı', services: 'all', days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '19:00', brk: ['14:00', '14:30'] },
      { name: 'Deniz', title: 'Kuaför', services: ['Kadın saç kesimi', 'Fön', 'Maşa ve şekillendirme'], days: [1, 2, 3, 4, 5], start: '11:00', end: '20:00' },
    ],
  },
  {
    name: 'Örnek Kuaför Bağdat Caddesi', type: 'hair_salon', cat: 'kadin-kuaforu', city: 'İstanbul', district: 'Kadıköy', neighborhood: 'Suadiye',
    address: 'Örnek Cadde No:300 (demo adres)', lat: 40.9612, lng: 29.0835, auto: true,
    description: 'Gelin saçı ve prova randevuları dahil tam hizmet kuaför. (Örnek işletme)',
    hours: [{ days: [0, 1, 2, 3, 4, 5], start: '09:30', end: '19:30' }],
    stations: [], services: [
      { name: 'Kadın saç kesimi', cat: 'kadin-kuaforu', dur: 45, price: 750 },
      { name: 'Fön', cat: 'kadin-kuaforu', dur: 30, price: 400 },
      { name: 'Röfle', cat: 'kadin-kuaforu', dur: 150, price: 2500, type: 'starting_from', clean: 10 },
      { name: 'Gelin saçı', cat: 'kadin-kuaforu', dur: 120, price: 6000, type: 'starting_from' },
      { name: 'Prova', cat: 'kadin-kuaforu', dur: 60, price: 1500 },
      { name: 'Çocuk saç kesimi', cat: 'kadin-kuaforu', dur: 30, price: 350 },
    ],
    employees: [
      { name: 'Ayşe Hanım', title: 'Salon sahibi', services: 'all', days: [0, 1, 2, 3, 4, 5], start: '09:30', end: '19:30', brk: ['13:00', '14:00'] },
      { name: 'Ece', title: 'Kuaför', services: ['Kadın saç kesimi', 'Fön', 'Çocuk saç kesimi'], days: [0, 1, 2, 4, 5], start: '09:30', end: '17:30' },
    ],
  },
  {
    name: 'Örnek Kuaför Karşıyaka', type: 'hair_salon', cat: 'kadin-kuaforu', city: 'İzmir', district: 'Karşıyaka', neighborhood: 'Bostanlı',
    address: 'Örnek Sokak No:22 (demo adres)', lat: 38.4581, lng: 27.0997, auto: true,
    description: 'Sahil kenarında ferah bir kuaför. (Örnek işletme — demo içerik)',
    hours: [{ days: [0, 1, 2, 3, 4, 5], start: '10:00', end: '20:00' }],
    stations: [], services: [
      { name: 'Kadın saç kesimi', cat: 'kadin-kuaforu', dur: 45, price: 600 },
      { name: 'Fön', cat: 'kadin-kuaforu', dur: 30, price: 300 },
      { name: 'Ombre', cat: 'kadin-kuaforu', dur: 180, price: 3000, max: 4500, type: 'range' },
      { name: 'Saç bakım uygulaması', cat: 'kadin-kuaforu', dur: 45, price: 800 },
    ],
    employees: [{ name: 'Burcu', title: 'Kuaför', services: 'all', days: [0, 1, 2, 3, 4, 5], start: '10:00', end: '20:00', brk: ['14:00', '14:45'] }],
  },
  {
    name: 'Örnek Güzellik Stüdyosu Ataşehir', type: 'beauty', cat: 'guzellik-bakim', city: 'İstanbul', district: 'Ataşehir', neighborhood: 'Barbaros',
    address: 'Örnek Plaza Kat 2 (demo adres)', lat: 40.9923, lng: 29.1244, auto: true,
    description: 'Manikür, pedikür, kalıcı oje ve kaş tasarımı. (Örnek işletme)',
    hours: [{ days: [0, 1, 2, 3, 4, 5], start: '10:00', end: '20:00' }],
    stations: [
      { name: 'Tırnak masası 1', type: 'nail', services: ['Manikür', 'Kalıcı oje', 'Pedikür'] },
      { name: 'Tırnak masası 2', type: 'nail', services: ['Manikür', 'Kalıcı oje', 'Pedikür'] },
    ],
    services: [
      { name: 'Manikür', cat: 'guzellik-bakim', dur: 40, price: 450, clean: 5 },
      { name: 'Pedikür', cat: 'guzellik-bakim', dur: 50, price: 550, clean: 10 },
      { name: 'Kalıcı oje', cat: 'guzellik-bakim', dur: 60, price: 650, clean: 5 },
      { name: 'Kaş şekillendirme', cat: 'guzellik-bakim', dur: 20, price: 250 },
    ],
    employees: [
      { name: 'Melis', title: 'Tırnak uzmanı', services: ['Manikür', 'Pedikür', 'Kalıcı oje'], days: [0, 1, 2, 3, 4, 5], start: '10:00', end: '19:00', brk: ['13:30', '14:00'] },
      { name: 'Zeynep', title: 'Güzellik uzmanı', services: 'all', days: [0, 1, 2, 3, 4], start: '11:00', end: '20:00' },
      { name: 'Gizem', title: 'Tırnak uzmanı', services: ['Manikür', 'Kalıcı oje'], days: [3, 4, 5], start: '10:00', end: '18:00' },
    ],
  },
  {
    name: 'Örnek Cilt Bakım Bakırköy', type: 'beauty', cat: 'guzellik-bakim', city: 'İstanbul', district: 'Bakırköy', neighborhood: 'Ataköy',
    address: 'Örnek Sokak No:3 (demo adres)', lat: 40.9819, lng: 28.8547, auto: false,
    description: 'Cilt analizi, cilt bakımı ve makyaj. Randevular işletme onayıyla kesinleşir. (Örnek işletme)',
    hours: [{ days: [1, 2, 3, 4, 5], start: '10:00', end: '19:00' }],
    stations: [{ name: 'Bakım kabini', type: 'skin', services: ['Cilt bakımı'] }],
    services: [
      { name: 'Cilt bakımı', cat: 'guzellik-bakim', dur: 60, price: 1200, prep: 5, clean: 15 },
      { name: 'Makyaj', cat: 'guzellik-bakim', dur: 60, price: 1500, type: 'starting_from' },
      { name: 'Kaş şekillendirme', cat: 'guzellik-bakim', dur: 20, price: 300 },
    ],
    employees: [{ name: 'Nur', title: 'Estetisyen', services: 'all', days: [1, 2, 3, 4, 5], start: '10:00', end: '19:00', brk: ['13:00', '13:30'] }],
  },
];

async function upsertUser(email: string, name: string, phone: string | null, role: 'user' | 'admin' = 'user') {
  const hash = await hashPassword(PASSWORD);
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (full_name, email, phone, password_hash, platform_role, email_verified_at)
    VALUES (${name}, ${email}, ${phone}, ${hash}, ${role}, now())
    ON CONFLICT (lower(email)) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`;
  await sql`INSERT INTO notification_preferences (user_id) VALUES (${u.id}) ON CONFLICT DO NOTHING`;
  for (const t of ['terms', 'privacy_notice']) {
    await sql`INSERT INTO consents (user_id, consent_type, granted, document_version) VALUES (${u.id}, ${t}, true, ${LEGAL_DOC_VERSION})`;
  }
  return u.id;
}

async function main() {
  const [existing] = await sql`SELECT 1 FROM businesses WHERE is_demo LIMIT 1`;
  if (existing) {
    console.log('Demo verisi zaten yüklü. Sıfırlamak için: npm run db:reset');
    return;
  }
  const admin = await upsertUser('admin@koltuk.demo', 'Demo Yönetici', null, 'admin');
  const owner = await upsertUser('isletme@koltuk.demo', 'Demo İşletme Sahibi', '+905550000001');
  const customer = await upsertUser('musteri@koltuk.demo', 'Demo Müşteri', '+905550000002');
  const staffUser = await upsertUser('calisan@koltuk.demo', 'Demo Çalışan', '+905550000003');
  const extraCustomers = [
    await upsertUser('ornek.musteri1@koltuk.demo', 'Ali Örnek', null),
    await upsertUser('ornek.musteri2@koltuk.demo', 'Elif Örnek', null),
    await upsertUser('ornek.musteri3@koltuk.demo', 'Kerem Örnek', null),
  ];
  void admin;

  const cats = Object.fromEntries((await sql<{ slug: string; id: string }[]>`SELECT slug, id FROM categories`).map((c) => [c.slug, c.id]));
  const [premium] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = 'pro'`;
  const today = localDateOf(new Date(), TZ);
  let first = true;
  const reviewTexts = [
    [5, 'Demo yorum: Zamanında başladı, çok memnun kaldım.'],
    [4, 'Demo yorum: Güler yüzlü hizmet, biraz beklemem gerekti.'],
    [5, 'Demo yorum: Randevu sistemi çok pratik.'],
  ] as const;

  for (const [bi, b] of businesses.entries()) {
    const slug = b.name.toLowerCase().replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/[^a-z0-9]+/g, '-');
    const ownerId = first ? owner : await upsertUser(`ornek.isletme${bi}@koltuk.demo`, `Örnek Sahip ${bi}`, null);
    const [biz] = await sql<{ id: string }[]>`
      INSERT INTO businesses (owner_user_id, name, slug, business_type, description, phone, email, city, district, neighborhood, address,
        latitude, longitude, location_verified, verification_status, approved_at, submitted_at, is_demo, auto_confirm, setup_step,
        cancellation_policy, cancel_min_hours, min_notice_minutes)
      VALUES (${ownerId}, ${b.name}, ${slug}, ${b.type}, ${b.description}, ${`+90555000${String(100 + bi).padStart(4, '0')}`},
        ${`ornek${bi}@koltuk.demo`}, ${b.city}, ${b.district}, ${b.neighborhood}, ${b.address}, ${b.lat}, ${b.lng}, true,
        'approved', now(), now(), true, ${b.auto}, 10,
        'Randevunuzu başlangıçtan en az 3 saat önce ücretsiz iptal edebilirsiniz. Daha geç iptaller için lütfen işletmeyi arayın.', 3, 30)
      RETURNING id`;
    await sql`INSERT INTO business_members (business_id, user_id, role) VALUES (${biz.id}, ${ownerId}, 'owner')`;
    await sql`INSERT INTO business_categories (business_id, category_id) VALUES (${biz.id}, ${cats[b.cat]})`;
    await sql`INSERT INTO subscriptions (business_id, plan_id, status, external_provider_reference) VALUES (${biz.id}, ${premium.id}, 'active', 'demo')`;
    for (const h of b.hours) for (const d of h.days) {
      await sql`INSERT INTO business_hours (business_id, weekday, opening_time, closing_time) VALUES (${biz.id}, ${d}, ${h.start}, ${h.end})`;
    }
    const svcIds: Record<string, string> = {};
    for (const [i, s] of b.services.entries()) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO services (business_id, category_id, name, duration_minutes, preparation_minutes, cleanup_minutes, price_type, price_amount, price_max_amount, sort_order)
        VALUES (${biz.id}, ${cats[s.cat]}, ${s.name}, ${s.dur}, ${s.prep ?? 0}, ${s.clean ?? 0}, ${s.type ?? 'fixed'}, ${s.price}, ${s.max ?? null}, ${i}) RETURNING id`;
      svcIds[s.name] = row.id;
    }
    for (const [i, st] of b.stations.entries()) {
      const [row] = await sql<{ id: string }[]>`INSERT INTO stations (business_id, name, station_type, capacity, sort_order) VALUES (${biz.id}, ${st.name}, ${st.type}, ${st.capacity ?? 1}, ${i}) RETURNING id`;
      for (const sn of st.services) await sql`INSERT INTO station_services (station_id, service_id) VALUES (${row.id}, ${svcIds[sn]})`;
    }
    const empIds: string[] = [];
    for (const [i, e] of b.employees.entries()) {
      const [row] = await sql<{ id: string }[]>`INSERT INTO employees (business_id, display_name, title, sort_order) VALUES (${biz.id}, ${e.name}, ${e.title}, ${i}) RETURNING id`;
      empIds.push(row.id);
      const names = e.services === 'all' ? Object.keys(svcIds) : e.services;
      for (const n of names) await sql`INSERT INTO employee_services (employee_id, service_id) VALUES (${row.id}, ${svcIds[n]})`;
      for (const d of e.days) {
        await sql`INSERT INTO employee_hours (employee_id, weekday, start_time, end_time) VALUES (${row.id}, ${d}, ${e.start}, ${e.end})`;
        if (e.brk) await sql`INSERT INTO employee_breaks (employee_id, weekday, start_time, end_time) VALUES (${row.id}, ${d}, ${e.brk[0]}, ${e.brk[1]})`;
      }
    }
    if (first) {
      // Demo çalışan hesabı ilk işletmenin ikinci çalışanına bağlı
      await sql`UPDATE employees SET user_id = ${staffUser} WHERE id = ${empIds[1]}`;
      await sql`INSERT INTO business_members (business_id, user_id, role, employee_id) VALUES (${biz.id}, ${staffUser}, 'staff', ${empIds[1]})`;
    }

    // Geçmiş (tamamlanmış) randevular ve bunlara bağlı demo yorumlar
    const firstService = Object.values(svcIds)[0];
    let made = 0;
    for (let back = 2; back <= 20 && made < 3; back++) {
      const d = addDaysLocal(today, -back);
      for (const hour of [11, 12, 15, 16]) {
        if (made >= 3) break;
        const start = zonedToUtc(d, hour * 60, TZ);
        try {
          const cust = extraCustomers[made % extraCustomers.length];
          const a = await createAppointment({
            businessId: biz.id, serviceIds: [firstService], employeeId: null, startAt: start, idempotencyKey: null, customerNote: null,
            actorUserId: ownerId, source: 'manual', customerUserId: cust, forceConfirmed: true,
          });
          await sql`UPDATE appointments SET status = 'completed', source = 'online' WHERE id = ${a.id}`;
          const [rating, text] = reviewTexts[(bi + made) % reviewTexts.length];
          await sql`INSERT INTO reviews (appointment_id, customer_user_id, business_id, rating, comment) VALUES (${a.id}, ${cust}, ${biz.id}, ${rating}, ${text})`;
          made++;
          break;
        } catch {
          /* o gün/saat uygun değilse sonrakini dene */
        }
      }
    }

    // Gelecek randevular (demo müşteri hesabı için)
    if (bi < 3) {
      let booked = false;
      for (let fwd = 1; fwd < 10 && !booked; fwd++) {
        const d = addDaysLocal(today, fwd);
        for (const hour of [16, 11, 17]) {
          try {
            await createAppointment({
              businessId: biz.id, serviceIds: [firstService], employeeId: null, startAt: zonedToUtc(d, hour * 60, TZ), idempotencyKey: null,
              customerNote: 'Demo randevu', actorUserId: customer, source: 'online', customerUserId: customer,
            });
            booked = true;
            break;
          } catch {
            /* uygun değil, sonraki saat/gün */
          }
        }
      }
    }
    first = false;
  }
  console.log('Demo verisi yüklendi.');
  console.log(`Giriş bilgileri (şifre hepsi için: ${PASSWORD}):`);
  console.log('  Yönetici: admin@koltuk.demo');
  console.log('  İşletme sahibi: isletme@koltuk.demo');
  console.log('  Çalışan: calisan@koltuk.demo');
  console.log('  Müşteri: musteri@koltuk.demo');
}

main()
  .then(closeDb)
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
