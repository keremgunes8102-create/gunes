export interface BizListItem {
  id: string;
  name: string;
  slug: string;
  business_type: string;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  logo_url: string | null;
  cover_url: string | null;
  is_demo: boolean;
  allow_employee_choice: boolean;
  online_booking_enabled: boolean;
  rating: string | null;
  review_count: number;
  min_price: string | null;
  distance_km: number | null;
  sample_services: { name: string; price_type: string; price_amount: string | null; price_max_amount: string | null; duration_minutes: number }[] | null;
  next_available: { date: string; time: string; startAt: string } | null;
}

export interface SearchResult {
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  items: BizListItem[];
}

export interface ServiceSnap {
  service_id: string | null;
  name: string;
  duration: number;
  price_type: string;
  price: string | null;
  price_max: string | null;
}

export interface Appointment {
  id: string;
  public_reference: string;
  start_at: string;
  end_at: string;
  status: string;
  price_snapshot: string | null;
  price_max_snapshot: string | null;
  price_type_snapshot: string;
  duration_snapshot: number;
  cancel_min_hours_snapshot?: number;
  customer_note: string | null;
  cancellation_reason: string | null;
  created_at: string;
  business_id?: string;
  business_name?: string;
  business_slug?: string;
  business_phone?: string | null;
  business_address?: string | null;
  business_district?: string | null;
  business_city?: string | null;
  business_is_demo?: boolean;
  timezone?: string;
  employee_name: string;
  employee_id: string;
  services: ServiceSnap[];
  review_id?: string | null;
  // panel alanları
  source?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_user_id?: string | null;
  station_name?: string | null;
  station_id?: string | null;
  business_note?: string | null;
  preparation_minutes?: number;
  cleanup_minutes?: number;
  pending_expires_at?: string | null;
  open_proposal?: { id: string; start_at: string; status: string } | null;
}
