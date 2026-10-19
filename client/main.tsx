import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, Redirect, match, useLocation } from './lib/router.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { ConfirmProvider, Spinner, ToastProvider } from './ui/index.tsx';
import { CookieBanner, Footer, Header } from './components/Layout.tsx';
import { Home } from './pages/Home.tsx';
import { Explore } from './pages/Explore.tsx';
import { BusinessDetail } from './pages/BusinessDetail.tsx';
import { Booking, BookingSuccess } from './pages/Booking.tsx';
import { ForgotPassword, Invitation, Login, Register, ResetPassword } from './pages/Auth.tsx';
import { AccountLayout, AppointmentDetailPage, MyAppointments, MyFavorites, MyReviews, NotificationsPage, PrivacyPage, ProfilePage } from './pages/Account.tsx';
import { About, Contact, CookiePolicy, ForBusiness, KvkkNotice, NotFound, PrivacyPolicy, Terms } from './pages/Static.tsx';
import { PanelShell } from './panel/context.tsx';
import { NewBusiness, SetupWizard } from './panel/Wizard.tsx';
import { AppointmentsPage, CustomersPage } from './panel/appointments.tsx';
import {
  CalendarPage, EmployeesPage, HoursPage, Overview, ProfilePanelPage, ReportsPage, ReviewsPage, ServicesPage, SettingsPage, StationsPage, SubscriptionPage, TeamPage,
} from './panel/pages.tsx';
import {
  AdminAudit, AdminBusinesses, AdminCategories, AdminDashboard, AdminDataRequests, AdminMessages, AdminModeration, AdminPlans, AdminShell, AdminUsers,
} from './admin/Admin.tsx';
import './styles.css';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { path, search } = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Redirect to={`/giris?next=${encodeURIComponent(path + (search.toString() ? `?${search}` : ''))}`} />;
  return <>{children}</>;
}

function PanelIndex() {
  const { memberships } = useAuth();
  return <Redirect to={memberships.length ? `/panel/${memberships[0].business_id}` : '/panel/yeni'} />;
}

const PANEL: Record<string, () => ReactNode> = {
  '': () => <Overview />,
  kurulum: () => <SetupWizard />,
  takvim: () => <CalendarPage />,
  randevular: () => <AppointmentsPage />,
  musteriler: () => <CustomersPage />,
  calisanlar: () => <EmployeesPage />,
  istasyonlar: () => <StationsPage />,
  hizmetler: () => <ServicesPage />,
  saatler: () => <HoursPage />,
  profil: () => <ProfilePanelPage />,
  yorumlar: () => <ReviewsPage />,
  raporlar: () => <ReportsPage />,
  bildirimler: () => <NotificationsPage />,
  ekip: () => <TeamPage />,
  abonelik: () => <SubscriptionPage />,
  ayarlar: () => <SettingsPage />,
};

const ADMIN: Record<string, () => ReactNode> = {
  '': () => <AdminDashboard />,
  basvurular: () => <AdminBusinesses />,
  kullanicilar: () => <AdminUsers />,
  moderasyon: () => <AdminModeration />,
  kategoriler: () => <AdminCategories />,
  paketler: () => <AdminPlans />,
  kvkk: () => <AdminDataRequests />,
  mesajlar: () => <AdminMessages />,
  kayitlar: () => <AdminAudit />,
};

const ACCOUNT: Record<string, () => ReactNode> = {
  randevular: () => <MyAppointments />,
  favoriler: () => <MyFavorites />,
  yorumlar: () => <MyReviews />,
  bildirimler: () => <NotificationsPage />,
  profil: () => <ProfilePage />,
  gizlilik: () => <PrivacyPage />,
};

/** Rota eşlemesi. {page, chrome}: chrome=false olan sayfalarda alt bilgi gösterilmez (panel/yönetim). */
function resolve(path: string): { node: ReactNode; footer: boolean } {
  const p = path.replace(/\/+$/, '') || '/';
  const simple: Record<string, () => ReactNode> = {
    '/': () => <Home />,
    '/kesfet': () => <Explore />,
    '/berberler': () => <Explore key="barber" presetType="barber" />,
    '/kuaforler': () => <Explore key="salon" presetType="hair_salon" />,
    '/guzellik-salonlari': () => <Explore key="beauty" presetType="beauty" />,
    '/giris': () => <Login />,
    '/uye-ol': () => <Register />,
    '/isletme-kayit': () => <BusinessSignup />,
    '/sifremi-unuttum': () => <ForgotPassword />,
    '/sifre-sifirla': () => <ResetPassword />,
    '/isletmeni-ekle': () => <ForBusiness />,
    '/gizlilik': () => <PrivacyPolicy />,
    '/kvkk': () => <KvkkNotice />,
    '/kullanim-kosullari': () => <Terms />,
    '/cerez-politikasi': () => <CookiePolicy />,
    '/hakkimizda': () => <About />,
    '/iletisim': () => <Contact />,
    '/hesabim': () => <Redirect to="/hesabim/randevular" />,
    '/panel': () => <RequireAuth><PanelIndex /></RequireAuth>,
    '/panel/yeni': () => <NewBusiness />,
  };
  if (simple[p]) return { node: simple[p](), footer: !p.startsWith('/panel') };
  let m: Record<string, string> | null;
  if ((m = match('/isletme/:slug', p))) return { node: <BusinessDetail key={m.slug} slug={m.slug} />, footer: true };
  if ((m = match('/randevu/:slug', p))) return { node: <Booking key={m.slug} slug={m.slug} />, footer: true };
  if ((m = match('/randevu-onay/:ref', p))) return { node: <RequireAuth><BookingSuccess reference={m.ref} /></RequireAuth>, footer: true };
  if ((m = match('/davet/:token', p))) return { node: <Invitation token={m.token} />, footer: true };
  if ((m = match('/hesabim/randevular/:ref', p))) return { node: <RequireAuth><AccountLayout><AppointmentDetailPage key={m.ref} reference={m.ref} /></AccountLayout></RequireAuth>, footer: true };
  if ((m = match('/hesabim/:section', p)) && ACCOUNT[m.section]) return { node: <RequireAuth><AccountLayout>{ACCOUNT[m.section]()}</AccountLayout></RequireAuth>, footer: true };
  if ((m = match('/panel/:bid/*', p)) || (m = match('/panel/:bid', p))) {
    const section = (m['*'] ?? '').split('/')[0];
    const page = PANEL[section];
    if (page && /^[0-9a-f-]{36}$/.test(m.bid)) return { node: <RequireAuth><PanelShell key={m.bid} bid={m.bid}>{page()}</PanelShell></RequireAuth>, footer: false };
  }
  if ((m = match('/yonetim/*', p)) || p === '/yonetim') {
    const section = (m?.['*'] ?? '').split('/')[0];
    const page = ADMIN[section];
    if (page) return { node: <RequireAuth><AdminShell>{page()}</AdminShell></RequireAuth>, footer: false };
  }
  return { node: <NotFound />, footer: true };
}

function BusinessSignup() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Redirect to="/panel" />;
  return <Register businessFlow />;
}

function App() {
  const { path } = useLocation();
  const [cookieOpen, setCookieOpen] = useState(false);
  const { node, footer } = resolve(path);
  useEffect(() => {
    // Sayfa değişiminde odak yönetimi (ekran okuyucular için)
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [path]);
  return (
    <>
      <a href="#main" className="skip-link">İçeriğe geç</a>
      <Header />
      <div id="main" tabIndex={-1} style={{ outline: 'none' }} key={path.split('/').slice(0, 2).join('/')} className="page-enter">
        {node}
      </div>
      {footer && <Footer onCookies={() => setCookieOpen(true)} />}
      <CookieBanner forceOpen={cookieOpen} onClose={() => setCookieOpen(false)} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </RouterProvider>
  </StrictMode>,
);
