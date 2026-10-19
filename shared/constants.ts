// İstemci ve sunucunun paylaştığı sabitler ve Türkçe etiketler.

export const BUSINESS_TYPES = ['barber', 'hair_salon', 'beauty'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  barber: 'Erkek berberi',
  hair_salon: 'Kadın kuaförü',
  beauty: 'Güzellik ve bakım salonu',
};
export const BUSINESS_TYPE_PLURAL: Record<BusinessType, string> = {
  barber: 'Berberler',
  hair_salon: 'Kuaförler',
  beauty: 'Güzellik salonları',
};
export const BUSINESS_TYPE_PATH: Record<BusinessType, string> = {
  barber: '/berberler',
  hair_salon: '/kuaforler',
  beauty: '/guzellik-salonlari',
};

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'completed',
  'cancelled_by_customer',
  'cancelled_by_business',
  'rejected',
  'no_show',
  'expired',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const ACTIVE_STATUSES: AppointmentStatus[] = ['pending', 'confirmed'];

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Onay bekliyor',
  confirmed: 'Onaylandı',
  completed: 'Tamamlandı',
  cancelled_by_customer: 'Müşteri iptal etti',
  cancelled_by_business: 'İşletme iptal etti',
  rejected: 'Reddedildi',
  no_show: 'Gelmedi',
  expired: 'Süresi doldu',
};

export const VERIFICATION_STATUS_LABEL: Record<string, string> = {
  draft: 'Taslak',
  pending_review: 'İnceleme bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  suspended: 'Askıya alındı',
};

export const PRICE_TYPES = ['fixed', 'starting_from', 'range', 'consultation'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];
export const PRICE_TYPE_LABEL: Record<PriceType, string> = {
  fixed: 'Sabit fiyat',
  starting_from: 'Başlangıç fiyatı',
  range: 'Fiyat aralığı',
  consultation: 'Danışma sonrası belirlenir',
};

export const STATION_TYPES = ['chair', 'wash', 'color', 'nail', 'skin', 'makeup', 'other'] as const;
export const STATION_TYPE_LABEL: Record<(typeof STATION_TYPES)[number], string> = {
  chair: 'Koltuk',
  wash: 'Yıkama ünitesi',
  color: 'Boya istasyonu',
  nail: 'Tırnak istasyonu',
  skin: 'Cilt bakım kabini',
  makeup: 'Makyaj masası',
  other: 'Diğer',
};

export const MEMBER_ROLES = ['owner', 'manager', 'staff'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'İşletme sahibi',
  manager: 'Yönetici',
  staff: 'Çalışan',
};

/** 0 = Pazartesi … 6 = Pazar */
export const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
export const WEEKDAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export const DEFAULT_TIMEZONE = 'Europe/Istanbul';
export const LEGAL_DOC_VERSION = '2026-10-v1';

export const TR_CITIES = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya', 'Ardahan', 'Artvin', 'Aydın',
  'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale',
  'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir',
  'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul', 'İzmir', 'Kahramanmaraş',
  'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kilis', 'Kırıkkale', 'Kırklareli', 'Kırşehir', 'Kocaeli',
  'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu',
  'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Şanlıurfa', 'Siirt', 'Sinop', 'Şırnak', 'Sivas', 'Tekirdağ', 'Tokat',
  'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak',
];
