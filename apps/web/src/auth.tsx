import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, NetworkError, post } from './api';

export type Role = 'AGENT' | 'MANAGER' | 'PARENT';
export type User = { id: string; name: string; role: Role; establishmentId: string | null };

type AuthState = {
  user: User | null;
  loading: boolean;
  /** Vrai si l'utilisateur affiché vient du cache local (serveur injoignable). */
  offline: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const CACHE_KEY = 'passage.lastUser';

/**
 * Hors ligne, on ne peut pas vérifier la session. Pour que l'agent puisse
 * continuer à scanner, on garde en local le dernier profil connu (nom et rôle,
 * aucun secret). Le serveur reste seul juge : à la synchronisation, une
 * session expirée est refusée et les scans restent en file.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    get<{ user: User }>('/auth/me')
      .then(({ user }) => {
        setUser(user);
        localStorage.setItem(CACHE_KEY, JSON.stringify(user));
      })
      .catch((err) => {
        if (err instanceof NetworkError) {
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached) {
            setUser(JSON.parse(cached) as User);
            setOffline(true);
          }
        } else {
          localStorage.removeItem(CACHE_KEY);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (loginValue: string, password: string) => {
    const { user } = await post<{ user: User }>('/auth/login', { login: loginValue, password });
    localStorage.setItem(CACHE_KEY, JSON.stringify(user));
    setOffline(false);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      localStorage.removeItem(CACHE_KEY);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, offline, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors de AuthProvider');
  return ctx;
}
