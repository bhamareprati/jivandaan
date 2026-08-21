import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import {
  Activity, BadgeCheck, Bell, ClipboardList, Droplet, Gauge, LayoutGrid, LogOut,
  Map as MapIcon, Menu, Moon, QrCode, ScrollText, Search, Sun, Syringe, X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';
import type { Role } from '@/types/api';

/**
 * Three genuinely different shells (Doc 1 section 7 asks whether the donor app
 * and the admin console are "meaningfully different" -- not merely recoloured):
 *
 *   donor              mobile-first, bottom tab bar under md, warm, roomy
 *   blood-bank/hospital  desktop-first, persistent left sidebar, denser
 *   admin              densest, cool surfaces, command bar, data-grid oriented
 */

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const NAV: Record<Role, NavItem[]> = {
  donor: [
    { to: '/donor/dashboard', label: 'Home', icon: <Gauge className="h-5 w-5" /> },
    { to: '/donor/pass', label: 'My pass', icon: <QrCode className="h-5 w-5" /> },
    { to: '/search', label: 'Find', icon: <Search className="h-5 w-5" /> },
    { to: '/request/new', label: 'Request', icon: <Droplet className="h-5 w-5" /> },
  ],
  'blood-bank': [
    { to: '/bank/dashboard', label: 'Stock', icon: <LayoutGrid className="h-5 w-5" /> },
    { to: '/bank/requests', label: 'Queue', icon: <ClipboardList className="h-5 w-5" /> },
    { to: '/bank/checkin', label: 'Check-in', icon: <Syringe className="h-5 w-5" /> },
    { to: '/search', label: 'Network', icon: <MapIcon className="h-5 w-5" /> },
  ],
  hospital: [
    { to: '/request/new', label: 'New request', icon: <Droplet className="h-5 w-5" /> },
    { to: '/requests', label: 'My requests', icon: <ClipboardList className="h-5 w-5" /> },
    { to: '/search', label: 'Find banks', icon: <MapIcon className="h-5 w-5" /> },
  ],
  admin: [
    { to: '/admin/dashboard', label: 'Overview', icon: <Activity className="h-5 w-5" /> },
    { to: '/admin/verification', label: 'Verification', icon: <BadgeCheck className="h-5 w-5" /> },
    { to: '/admin/logs', label: 'Audit log', icon: <ScrollText className="h-5 w-5" /> },
    { to: '/search', label: 'Network', icon: <MapIcon className="h-5 w-5" /> },
  ],
};

/* ------------------------------------------------------------ dark mode */

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}

function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-9 w-9 items-center justify-center rounded-pill text-[rgb(var(--ink-muted))] transition-colors hover:bg-[rgb(var(--line))] hover:text-[rgb(var(--ink))]"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

/* --------------------------------------------------------------- pieces */

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-crimson to-burgundy shadow-crimson">
        <Droplet className="h-4 w-4 text-white" fill="currentColor" aria-hidden />
      </span>
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-base font-bold tracking-tight">Jivandan</span>
          <span className="muted text-[10px] font-medium tracking-[0.18em]">जीवनदान</span>
        </span>
      )}
    </Link>
  );
}

function AccountMenu() {
  const { user, role, signOut } = useAuth();
  if (!user) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="hidden flex-col items-end leading-tight sm:flex">
        <span className="text-sm font-semibold">{user.name}</span>
        <span className="muted text-[11px] capitalize">{role?.replace('-', ' ')}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void signOut()}
        icon={<LogOut className="h-4 w-4" />}
        aria-label="Sign out"
      >
        <span className="sr-only sm:not-sr-only">Sign out</span>
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------- shells */

/** Donor: mobile-first, warm, bottom tab bar below md. */
function DonorShell({ children, items }: { children: ReactNode; items: NavItem[] }) {
  return (
    <div className="min-h-screen bg-[rgb(var(--surface-sunken))]">
      <header className="sticky top-0 z-40 border-b border-[rgb(var(--line))] bg-[rgb(var(--surface))]/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Wordmark />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-6 md:pb-12">{children}</main>

      {/* Bottom tab bar -- the donor flows are designed for a phone. */}
      <nav
        aria-label="Main"
        className="glass fixed inset-x-3 bottom-3 z-40 rounded-card px-2 py-2 md:hidden"
      >
        <ul className="flex items-center justify-around">
          {items.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold transition-colors',
                    isActive
                      ? 'text-crimson-ink dark:text-crimson-light'
                      : 'text-[rgb(var(--ink-muted))]'
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Inline nav on desktop, where a bottom bar would be odd. */}
      <nav aria-label="Main" className="hidden md:block">
        <ul className="mx-auto flex max-w-3xl gap-2 px-4 pb-10">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-pill border px-4 py-2 text-sm font-semibold transition-colors',
                    isActive
                      ? 'border-crimson-ink bg-crimson-ink text-white'
                      : 'border-[rgb(var(--line))] hover:bg-[rgb(var(--line))]'
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Bank / hospital / admin: persistent sidebar, denser, desktop-first. */
function ConsoleShell({
  children,
  items,
  tone,
}: {
  children: ReactNode;
  items: NavItem[];
  tone: 'operational' | 'admin';
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 px-2 pt-2">
        <Wordmark />
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-crimson-ink text-white'
                  : 'text-[rgb(var(--ink-muted))] hover:bg-[rgb(var(--line))] hover:text-[rgb(var(--ink))]'
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );

  return (
    <div
      className={cn(
        'min-h-screen',
        tone === 'admin' ? 'bg-[rgb(var(--surface-sunken))]' : 'bg-[rgb(var(--surface-sunken))]'
      )}
    >
      <div className="flex">
        {/* Persistent sidebar from lg up */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-[rgb(var(--line))] bg-[rgb(var(--surface))] lg:block">
          {sidebar}
        </aside>

        {/* Drawer below lg */}
        {open && (
          <>
            <div
              className="fixed inset-0 z-40 bg-navy/60 lg:hidden"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <aside className="fixed inset-y-0 left-0 z-50 w-64 border-r border-[rgb(var(--line))] bg-[rgb(var(--surface))] lg:hidden">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="absolute right-3 top-3 rounded-pill p-2 hover:bg-[rgb(var(--line))]"
              >
                <X className="h-4 w-4" />
              </button>
              {sidebar}
            </aside>
          </>
        )}

        <div className="min-w-0 flex-1">
          {/* Command bar: denser than the donor header, with room for tools. */}
          <header className="sticky top-0 z-30 border-b border-[rgb(var(--line))] bg-[rgb(var(--surface))]/90 backdrop-blur-md">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  aria-label="Open navigation"
                  className="rounded-pill p-2 hover:bg-[rgb(var(--line))] lg:hidden"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <span className="font-display text-sm font-semibold uppercase tracking-wide text-[rgb(var(--ink-muted))]">
                  {tone === 'admin' ? 'Control centre' : 'Operations'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span
                  className="hidden items-center gap-1.5 rounded-pill border border-[rgb(var(--line))] px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--ink-muted))] sm:flex"
                  title="Data refreshes automatically"
                >
                  <Bell className="h-3 w-3" /> Live
                </span>
                <ThemeToggle />
                <AccountMenu />
              </div>
            </div>
          </header>

          <main className="p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const items = NAV[role ?? 'donor'] ?? NAV.donor;

  if (role === 'donor') return <DonorShell items={items}>{children}</DonorShell>;
  if (role === 'admin')
    return (
      <ConsoleShell items={items} tone="admin">
        {children}
      </ConsoleShell>
    );
  return (
    <ConsoleShell items={items} tone="operational">
      {children}
    </ConsoleShell>
  );
}
