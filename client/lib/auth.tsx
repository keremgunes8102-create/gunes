import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setCsrf } from './api.ts';

export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  platform_role: 'user' | 'admin';
  account_status: string;
  email_verified_at: string | null;
  phone_verified_at: string | null;
}
export interface MembershipInfo {
  business_id: string;
  role: 'owner' | 'manager' | 'staff';
  employee_id: string | null;
  name: string;
  slug: string;
  verification_status: string;
  setup_step: number;
}
interface AuthState {
  user: User | null;
  memberships: MembershipInfo[];
  unread: number;
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (data: MeResponse) => void;
  logout: () => Promise<void>;
}
export interface MeResponse {
  user: User | null;
  csrfToken: string | null;
  memberships?: MembershipInfo[];
  unreadNotifications?: number;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<MembershipInfo[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const setSession = useCallback((d: MeResponse) => {
    setCsrf(d.csrfToken);
    setUser(d.user);
    setMemberships(d.memberships ?? []);
    setUnread(d.unreadNotifications ?? 0);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const d = await api.get<MeResponse>('/api/auth/me');
      setSession(d);
    } catch {
      /* ağ hatasında mevcut durumu koru */
    } finally {
      setLoading(false);
    }
  }, [setSession]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setSession({ user: null, csrfToken: null });
    }
  }, [setSession]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  return <Ctx.Provider value={{ user, memberships, unread, loading, refresh, setSession, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
