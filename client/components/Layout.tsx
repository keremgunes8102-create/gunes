import { useEffect, useRef, useState } from 'react';
import { Link, navigate, useLocation } from '../lib/router.tsx';
import { useAuth } from '../lib/auth.tsx';
import { Logo } from '../ui/brand.tsx';
import { Button, ButtonLink, cx, useToast } from '../ui/index.tsx';
import { IconBell, IconCalendar, IconChevronDown, IconHeart, IconLogout, IconMenu, IconSettings, IconShield, IconStore, IconUser, IconX } from '../ui/icons.tsx';

const NAV = [
  { to: '/kesfet', label: 'Keşfet' },
  { to: '/berberler', label: 'Berberler' },
  { to: '/kuaforler', label: 'Kuaförler' },
  { to: '/guzellik-salonlari', label: 'Güzellik salonları' },
  { to: '/#nasil-calisir', label: 'Nasıl çalışır?' },
];

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toLocaleUpperCase('tr-TR'))
    .join('');

function UserMenu() {
  const { user, memberships, logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { path } = useLocation();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', on);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', on);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-menu-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar">{initials(user.full_name)}</span>
        <span className="desktop-only small" style={{ fontWeight: 600, maxWidth: 140 }}>
          <span className="ellipsis" style={{ display: 'block' }}>{user.full_name.split(' ')[0]}</span>
        </span>
        <IconChevronDown size={16} />
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <div className="dropdown-head">
            <strong className="ellipsis" style={{ display: 'block' }}>{user.full_name}</strong>
            <span className="muted small ellipsis" style={{ display: 'block' }}>{user.email}</span>
          </div>
          <div className="dropdown-sep" />
          <Link to="/hesabim/randevular" role="menuitem"><IconCalendar size={18} /> Randevularım</Link>
          <Link to="/hesabim/favoriler" role="menuitem"><IconHeart size={18} /> Favorilerim</Link>
          <Link to="/hesabim/profil" role="menuitem"><IconUser size={18} /> Profilim</Link>
          <Link to="/hesabim/gizlilik" role="menuitem"><IconSettings size={18} /> Hesap ve gizlilik</Link>
          {memberships.length > 0 && <div className="dropdown-sep" />}
          {memberships.map((m) => (
            <Link key={m.business_id} to={`/panel/${m.business_id}`} role="menuitem">
              <IconStore size={18} /> <span className="ellipsis">{m.name}</span>
            </Link>
          ))}
          {user.platform_role === 'admin' && (
            <>
              <div className="dropdown-sep" />
              <Link to="/yonetim" role="menuitem"><IconShield size={18} /> Platform yönetimi</Link>
            </>
          )}
          <div className="dropdown-sep" />
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await logout();
              toast('Çıkış yaptınız.');
              navigate('/');
            }}
          >
            <IconLogout size={18} /> Çıkış yap
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { user, unread, loading } = useAuth();
  const { path } = useLocation();
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setMobile(false), [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <>
      <header className={cx('header', scrolled && 'scrolled')}>
        <div className="container header-inner">
          <Link to="/" aria-label="KOLTUK ana sayfa">
            <Logo />
          </Link>
          <nav className="nav desktop-only" aria-label="Ana menü">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} aria-current={path === n.to ? 'page' : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <Link to="/isletmeni-ekle" className="btn btn-ghost btn-sm desktop-only">
              <span className="btn-label">İşletmeni ekle</span>
            </Link>
            {!loading && !user && (
              <>
                <ButtonLink to={`/giris?next=${encodeURIComponent(path)}`} variant="ghost" size="sm" className="desktop-only">
                  Giriş yap
                </ButtonLink>
                <ButtonLink to="/uye-ol" variant="dark" size="sm">
                  Üye ol
                </ButtonLink>
              </>
            )}
            {user && (
              <>
                <Link to="/hesabim/bildirimler" className="icon-btn bell" aria-label={`Bildirimler${unread ? `, ${unread} okunmamış` : ''}`}>
                  <IconBell />
                  {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
                </Link>
                <UserMenu />
              </>
            )}
            <button type="button" className="icon-btn mobile-only" aria-label={mobile ? 'Menüyü kapat' : 'Menüyü aç'} aria-expanded={mobile} onClick={() => setMobile(!mobile)}>
              {mobile ? <IconX /> : <IconMenu />}
            </button>
          </div>
        </div>
      </header>
      {mobile && (
        <div className="mobile-menu">
          <nav aria-label="Mobil menü">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to}>
                {n.label}
              </Link>
            ))}
            <Link to="/isletmeni-ekle">İşletmeni ekle</Link>
            {!user && <Link to="/giris">Giriş yap</Link>}
            {!user && <Link to="/uye-ol">Üye ol</Link>}
          </nav>
        </div>
      )}
    </>
  );
}

export function Footer({ onCookies }: { onCookies: () => void }) {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="stack-sm">
            <Logo />
            <p className="muted small" style={{ maxWidth: 320 }}>
              Tarzına uygun yer, sana uygun saat. Berber, kuaför ve güzellik salonlarında online randevu.
            </p>
          </div>
          <div>
            <h4>Keşfet</h4>
            <ul>
              <li><Link to="/berberler">Berberler</Link></li>
              <li><Link to="/kuaforler">Kuaförler</Link></li>
              <li><Link to="/guzellik-salonlari">Güzellik salonları</Link></li>
              <li><Link to="/kesfet">Tüm işletmeler</Link></li>
            </ul>
          </div>
          <div>
            <h4>İşletmeler</h4>
            <ul>
              <li><Link to="/isletmeni-ekle">İşletmeni ekle</Link></li>
              <li><Link to="/isletmeni-ekle#paketler">Paketler</Link></li>
              <li><Link to="/panel">İşletme paneli</Link></li>
            </ul>
          </div>
          <div>
            <h4>KOLTUK</h4>
            <ul>
              <li><Link to="/hakkimizda">Hakkımızda</Link></li>
              <li><Link to="/iletisim">İletişim</Link></li>
              <li><Link to="/gizlilik">Gizlilik politikası</Link></li>
              <li><Link to="/kvkk">KVKK aydınlatma metni</Link></li>
              <li><Link to="/kullanim-kosullari">Kullanım koşulları</Link></li>
              <li><button type="button" className="link" onClick={onCookies}>Çerez tercihleri</button></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} KOLTUK</span>
          <span>Fiyatlar işletmeler tarafından belirlenir ve TL cinsindendir.</span>
        </div>
      </div>
    </footer>
  );
}

const COOKIE_KEY = 'koltuk_cookie_notice_v1';
export function CookieBanner({ forceOpen, onClose }: { forceOpen: boolean; onClose: () => void }) {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(COOKIE_KEY) === '1';
    } catch {
      return true;
    }
  });
  if (seen && !forceOpen) return null;
  const close = () => {
    try {
      localStorage.setItem(COOKIE_KEY, '1');
    } catch {
      /* depolama yoksa yalnızca bu oturumda kapat */
    }
    setSeen(true);
    onClose();
  };
  return (
    <div className="cookie-banner" role="dialog" aria-label="Çerez bilgilendirmesi">
      <h3 style={{ fontSize: '1rem' }}>Çerezler hakkında</h3>
      <p>
        KOLTUK yalnızca hizmetin çalışması için <strong>zorunlu çerezleri</strong> kullanır (oturumunuzu güvenle açık tutmak gibi). Reklam veya analitik çerezi kullanılmaz; bu nedenle ayrıca izin istemiyoruz. Ayrıntılar için{' '}
        <Link to="/cerez-politikasi" onClick={close}>çerez politikamıza</Link> göz atabilirsiniz.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={close} size="sm">Anladım</Button>
      </div>
    </div>
  );
}
