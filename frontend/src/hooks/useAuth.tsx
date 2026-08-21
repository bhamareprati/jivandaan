import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onUnauthorized, setAccessToken } from '@/api/client';
import * as endpoints from '@/api/endpoints';
import type { AnyAccount, Eligibility, Role } from '@/types/api';

/**
 * Authentication state.
 *
 * The access token is held in module memory by api/client.ts and deliberately
 * never persisted. Continuity across a reload comes from the backend's httpOnly
 * session cookie: on boot we probe GET /api/auth/me, and if the cookie is still
 * valid the server tells us who we are.
 *
 * Consequence worth knowing: an XSS bug cannot steal a durable credential, and
 * closing the tab ends the token's usefulness.
 */

interface AuthState {
  user: AnyAccount | null;
  role: Role | null;
  eligibility: Eligibility | null;
  /** True until the boot session probe has settled -- guards render a spinner. */
  initialising: boolean;
  signIn: (input: endpoints.LoginInput) => Promise<AnyAccount>;
  signUp: (input: Record<string, unknown>) => Promise<AnyAccount>;
  signOut: (opts?: { silent?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AnyAccount | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [initialising, setInitialising] = useState(true);
  const queryClient = useQueryClient();
  const booted = useRef(false);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setRole(null);
    setEligibility(null);
    queryClient.clear();
  }, [queryClient]);

  const refresh = useCallback(async () => {
    try {
      const session = await endpoints.getSession();
      setUser(session.user);
      setRole(session.role);
      setEligibility(session.eligibility ?? null);
    } catch {
      clear();
    }
  }, [clear]);

  // Boot probe: does the session cookie still identify us?
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      await refresh();
      setInitialising(false);
    })();
  }, [refresh]);

  // The server rejected our credentials mid-session -- drop everything.
  useEffect(() => {
    const unsubscribe = onUnauthorized(() => clear());
    return () => {
      unsubscribe();
    };
  }, [clear]);

  const adopt = useCallback((result: { token: string; role: Role; user: AnyAccount }) => {
    setAccessToken(result.token);
    setUser(result.user);
    setRole(result.role);
    return result.user;
  }, []);

  const signIn = useCallback(
    async (input: endpoints.LoginInput) => {
      const result = await endpoints.login(input);
      const account = adopt(result);
      // Donors get their eligibility with the session; fetch it now so the
      // dashboard ring has data before its own query resolves.
      if (result.role === 'donor') void refresh();
      return account;
    },
    [adopt, refresh]
  );

  const signUp = useCallback(
    async (input: Record<string, unknown>) => {
      const result = await endpoints.register(input);
      return adopt(result);
    },
    [adopt]
  );

  const signOut = useCallback(
    async (opts?: { silent?: boolean }) => {
      try {
        await endpoints.logout();
      } catch {
        // Even if the server call fails, drop local state -- the user asked to
        // leave and the token is memory-only anyway.
        if (!opts?.silent) {
          /* swallow: signing out must always succeed locally */
        }
      }
      clear();
    },
    [clear]
  );

  const value = useMemo<AuthState>(
    () => ({ user, role, eligibility, initialising, signIn, signUp, signOut, refresh }),
    [user, role, eligibility, initialising, signIn, signUp, signOut, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in account's id, whichever role it is. */
export function useAccountId(): string | null {
  const { user } = useAuth();
  if (!user) return null;
  return user.id ?? user._id ?? null;
}
