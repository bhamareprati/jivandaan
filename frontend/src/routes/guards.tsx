import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Button } from '@/components/ui';
import { homeFor } from './paths';
import type { Role } from '@/types/api';
import type { ReactNode } from 'react';

/**
 * Client-side route guards.
 *
 * These are a UX affordance, NOT a security boundary. Every protected endpoint
 * is independently enforced server-side by requireAuth + RBAC middleware, and a
 * user who edits their way past this guard still gets a 401/403 from the API.
 * Never move an authorisation decision into this file.
 */

function BootSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[rgb(var(--surface-sunken))]">
      <Loader2 className="h-6 w-6 animate-spin text-crimson" aria-label="Loading" />
    </div>
  );
}

export function RequireAuth({
  children,
  roles,
}: {
  children: ReactNode;
  /** Omit to allow any signed-in role. */
  roles?: Role[];
}) {
  const { user, role, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <BootSplash />;

  if (!user || !role) {
    return <Navigate to="/auth/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(role)) {
    return (
      <AppShell>
        <EmptyState
          title="Not available for your account"
          description={`This area is for ${roles
            .map((r) => r.replace('-', ' '))
            .join(' and ')} accounts. You are signed in as ${role.replace('-', ' ')}.`}
          action={
            <Button onClick={() => window.location.assign(homeFor(role))}>Go to your home</Button>
          }
        />
      </AppShell>
    );
  }

  return <AppShell>{children}</AppShell>;
}

/** For pages that render inside a shell but allow any signed-in role. */
export function RequireAnyAuth({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
