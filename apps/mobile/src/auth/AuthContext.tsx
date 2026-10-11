/**
 * Auth state: token + user, loaded from secure storage, validated via /me.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore, type PublicUser } from '../api/client';
import type { Lang } from '../i18n';
import { langStore } from '../api/client';

interface AuthState {
  token: string | null;
  user: PublicUser | null;
  lang: Lang;
  ready: boolean;
  signIn: (token: string, user: PublicUser) => Promise<void>;
  signOut: () => Promise<void>;
  setLang: (l: Lang) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [lang, setLangState] = useState<Lang>('ar');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [t, l] = await Promise.all([tokenStore.get(), langStore.get()]);
        if (l === 'en' || l === 'ar') setLangState(l);
        if (t) {
          try {
            const { user: u } = await api.me(t);
            setToken(t);
            setUser(u);
          } catch {
            await tokenStore.clear();
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signIn = useCallback(async (t: string, u: PublicUser) => {
    await tokenStore.set(t);
    setToken(t);
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    await tokenStore.clear();
    setToken(null);
    setUser(null);
  }, []);

  const setLang = useCallback(async (l: Lang) => {
    await langStore.set(l);
    setLangState(l);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const { user: u } = await api.me(token);
      setUser(u);
    } catch {
      /* keep stale user */
    }
  }, [token]);

  const value = useMemo(
    () => ({ token, user, lang, ready, signIn, signOut, setLang, refreshUser }),
    [token, user, lang, ready, signIn, signOut, setLang, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
