import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

interface Loc {
  path: string;
  search: URLSearchParams;
  hash: string;
}
const read = (): Loc => ({ path: location.pathname, search: new URLSearchParams(location.search), hash: location.hash });

const RouterCtx = createContext<Loc>(read());
type Guard = () => boolean; // false -> gezinmeyi engelle
let guard: Guard | null = null;
export const setNavigationGuard = (g: Guard | null) => {
  guard = g;
};

export function navigate(to: string, opts: { replace?: boolean; scroll?: boolean } = {}) {
  if (guard && !guard()) return;
  const current = location.pathname + location.search;
  if (opts.replace) history.replaceState(null, '', to);
  else if (to !== current) history.pushState(null, '', to);
  window.dispatchEvent(new Event('koltuk:navigate'));
  if (opts.scroll !== false && !to.includes('#')) window.scrollTo({ top: 0 });
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener('popstate', on);
    window.addEventListener('koltuk:navigate', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('koltuk:navigate', on);
    };
  }, []);
  return <RouterCtx.Provider value={loc}>{children}</RouterCtx.Provider>;
}

export const useLocation = () => useContext(RouterCtx);

export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  const wildcard = p.at(-1) === '*';
  if (wildcard ? s.length < p.length - 1 : p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') {
      params['*'] = s.slice(i).join('/');
      break;
    }
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, children, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (/^(https?:|mailto:|tel:)/.test(to)) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

/** Arama parametrelerini URL'de tutan durum */
export function useSearchParams(): [URLSearchParams, (next: Record<string, string | null | undefined>, replace?: boolean) => void] {
  const { search, path } = useLocation();
  const set = (next: Record<string, string | null | undefined>, replace = true) => {
    const u = new URLSearchParams(search);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === undefined || v === '') u.delete(k);
      else u.set(k, v);
    }
    const q = u.toString();
    navigate(`${path}${q ? `?${q}` : ''}`, { replace, scroll: false });
  };
  return [search, set];
}

export function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to]);
  return null;
}
