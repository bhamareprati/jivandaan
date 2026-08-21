import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock, Droplet, Radio, ShieldCheck, TrendingUp } from 'lucide-react';
import { HeroCanvas } from '@/components/three/HeroCanvas';
import { Wordmark } from '@/components/layout/AppShell';
import { Button, GlassCard, BloodGroupChip, UrgencyBadge } from '@/components/ui';
import { CountUp, FadeIn, StaggerItem, StaggerList } from '@/components/motion';
import { getAdminMetrics } from '@/api/endpoints';
import { POLL, qk } from '@/lib/queryClient';
import { BLOOD_GROUPS, formatCount } from '@/lib/domain';
import { cn } from '@/lib/cn';

/**
 * Public landing (Doc 1 section 3).
 *
 * The focal point is the 3D drop, not a centred headline over a flat gradient.
 * Layout is an asymmetric split with a floating glass stat panel -- deliberately
 * not the "centered hero + 3 icon cards" that Doc 1 section 2 forbids.
 *
 * Impact counters read from /api/admin/metrics, which is admin-only, so an
 * anonymous visitor gets a graceful representative fallback rather than an
 * error. Nothing here leaks data a signed-out visitor should not see.
 */

const FALLBACK = {
  donors: 0,
  units: 0,
  requests: 0,
  banks: 0,
};

export function LandingPage() {
  const { data: metrics } = useQuery({
    queryKey: qk.adminMetrics,
    queryFn: getAdminMetrics,
    refetchInterval: POLL.landing,
    // Anonymous visitors get 403 here; that is expected, so do not retry.
    retry: false,
    staleTime: POLL.landing,
  });

  const stats = metrics
    ? {
        donors: metrics.users.donors,
        units: metrics.inventory.totalUnits,
        requests: metrics.requests.total,
        banks: metrics.users.banks.verified ?? 0,
      }
    : FALLBACK;

  const hasLiveData = Boolean(metrics);

  return (
    <div className="relative isolate min-h-screen">
      {/* The hero's drifting gradient, promoted to the whole page.

          It is `fixed`, so one element covers every section and the drift keeps
          running as you scroll rather than restarting per section. `isolate` on
          the wrapper keeps the -z-10 inside this subtree, and the base surface
          colour rides on this layer because the wrapper can no longer paint it
          without covering the gradient. Reduced motion is handled globally in
          globals.css, which stills every CSS animation including this one. */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[rgb(var(--surface-sunken))]"
        aria-hidden
      >
        <div className="mesh-backdrop absolute inset-[-20%] animate-mesh-drift opacity-90" />
      </div>

      {/* ------------------------------------------------------------- hero */}
      <section className="relative isolate min-h-[92vh] overflow-hidden">
        <HeroCanvas />
        {/* Readability scrim. It has to darken the type enough to pass contrast
            without flattening the thing it sits on: at navy/80-95 the drifting
            gradient underneath was invisible. Heavier top and bottom, where the
            nav and the section seam need it, and nearly clear across the middle
            band where the gradient and the drop actually read. */}
        <div
          className="absolute inset-0 bg-gradient-to-b from-navy/70 via-navy/20 to-navy/90"
          aria-hidden
        />

        {/* Sticky nav uses glass -- one of the four sanctioned surfaces. */}
        <header className="relative z-20">
          <div className="shell flex items-center justify-between py-5">
            <div className="[&_*]:text-white">
              <Wordmark />
            </div>
            <nav className="flex items-center gap-2">
              <Link to="/auth/login">
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/10">
                  Sign in
                </Button>
              </Link>
              <Link to="/auth/register">
                <Button size="sm">Join the network</Button>
              </Link>
            </nav>
          </div>
        </header>

        {/* Asymmetric: type on the left, 3D breathing on the right. */}
        <div className="shell relative z-10 grid items-center gap-10 pb-24 pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
          <FadeIn>
            <p className="mb-5 inline-flex items-center gap-2 rounded-pill border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur">
              <Radio className="h-3.5 w-3.5 text-crimson" aria-hidden />
              Real-time blood inventory network
            </p>

            <h1 className="font-display text-[clamp(2.6rem,6.2vw,4.4rem)] font-extrabold leading-[1.02] tracking-tight text-white">
              Every minute counts.
              <br />
              <span className="bg-gradient-to-r from-crimson via-[#FF6B6B] to-amber bg-clip-text text-transparent">
                Jivandan
              </span>{' '}
              finds the blood.
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/75">
              Live stock across every blood bank, compatibility matching when the exact group runs
              out, and a request you can watch move from submitted to fulfilled.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/auth/register">
                <Button size="lg" icon={<Droplet className="h-4 w-4" />}>
                  Become a donor
                </Button>
              </Link>
              <Link to="/request/new">
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/30 text-white hover:bg-white/10"
                  icon={<ArrowRight className="h-4 w-4" />}
                >
                  Request blood
                </Button>
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                All eight groups
              </span>
              {BLOOD_GROUPS.map((g) => (
                <BloodGroupChip
                  key={g}
                  group={g}
                  size="sm"
                  className="border-white/25 bg-white/10 text-white"
                />
              ))}
            </div>
          </FadeIn>

          {/* Floating glass stat panel -- a sanctioned glass surface, and it has
              the 3D scene behind it to blur. */}
          <FadeIn delay={0.15}>
            <GlassCard className="ml-auto w-full max-w-md p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-display text-sm font-semibold text-white">
                  Network at a glance
                </span>
                <span
                  className={cn(
                    'flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-semibold',
                    hasLiveData ? 'bg-emerald/20 text-emerald-light' : 'bg-white/10 text-white/60'
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      hasLiveData ? 'bg-emerald-light' : 'bg-white/40'
                    )}
                  />
                  {hasLiveData ? 'Live' : 'Sign in for live data'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <HeroStat label="Registered donors" value={stats.donors} icon={<Droplet className="h-4 w-4" />} />
                <HeroStat label="Units in stock" value={stats.units} icon={<TrendingUp className="h-4 w-4" />} />
                <HeroStat label="Requests handled" value={stats.requests} icon={<Clock className="h-4 w-4" />} />
                <HeroStat label="Verified banks" value={stats.banks} icon={<ShieldCheck className="h-4 w-4" />} />
              </div>

              <p className="mt-4 text-xs leading-relaxed text-white/55">
                Counts refresh every minute. Blood banks are listed only after an administrator has
                verified their licence.
              </p>
            </GlassCard>
          </FadeIn>
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section className="shell py-20">
        <div className="mb-10 max-w-2xl">
          <h2 className="font-display text-2xl font-bold">From request to transfusion</h2>
          <p className="muted mt-2">
            Four stages, each visible to everyone involved. No phone tag, no guessing where a unit
            is.
          </p>
        </div>

        <StaggerList className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              step: 'Submitted',
              title: 'A request is raised',
              body: 'A hospital or donor names the group, the units and the urgency. Critical requests notify eligible donors immediately.',
            },
            {
              step: 'Review',
              title: 'The bank checks stock',
              body: 'If the exact group is short, compatibility matching suggests substitutes that are actually on the shelf.',
            },
            {
              step: 'Dispatched',
              title: 'Units leave the shelf',
              body: 'Stock is drawn oldest-first so nothing expires unnecessarily, and the count updates the moment it moves.',
            },
            {
              step: 'Fulfilled',
              title: 'The requester sees it land',
              body: 'The tracker advances live. Every step is timestamped and written to an audit trail.',
            },
          ].map((item, i) => (
            <StaggerItem key={item.step}>
              <article className="surface flex h-full flex-col p-5">
                <span className="mb-3 inline-flex w-fit items-center gap-2 rounded-pill bg-crimson/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-crimson-ink dark:text-crimson-light">
                  <span className="tabular">0{i + 1}</span> {item.step}
                </span>
                <h3 className="font-display text-base font-semibold">{item.title}</h3>
                <p className="muted mt-2 text-sm leading-relaxed">{item.body}</p>
              </article>
            </StaggerItem>
          ))}
        </StaggerList>
      </section>

      {/* ------------------------------------------------------- built for */}
      <section className="surface-veil border-t border-[rgb(var(--line))]">
        <div className="shell grid gap-10 py-20 lg:grid-cols-3">
          <div>
            <h2 className="font-display text-2xl font-bold">Built for four kinds of people</h2>
            <p className="muted mt-2 text-sm leading-relaxed">
              Each role gets an interface shaped around what it actually does, not one dashboard
              wearing four hats.
            </p>
            <Link to="/auth/register" className="mt-5 inline-block">
              <Button variant="outline" icon={<ArrowRight className="h-4 w-4" />}>
                Choose your role
              </Button>
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
            {[
              { role: 'Donors', body: 'A 56-day eligibility countdown, a scannable digital pass, and only the requests your blood can actually serve.' },
              { role: 'Blood banks', body: 'A live eight-group stock matrix, an expiry radar for units nearing 42 days, and a queue ordered by urgency.' },
              { role: 'Hospitals', body: 'Raise an emergency request in four steps and watch it move, with substitute groups surfaced when stock is short.' },
              { role: 'Administrators', body: 'Verification queue, platform KPIs, and an append-only audit log of every state change.' },
            ].map((item) => (
              <article key={item.role} className="surface p-5">
                <h3 className="font-display text-base font-semibold">{item.role}</h3>
                <p className="muted mt-2 text-sm leading-relaxed">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ CTA */}
      <section className="relative isolate overflow-hidden bg-burgundy">
        <div className="mesh-backdrop absolute inset-0 animate-mesh-drift opacity-40" aria-hidden />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-5 py-20 text-center">
          <UrgencyBadge urgency="critical" className="mb-5" />
          <h2 className="font-display text-[clamp(1.8rem,4vw,2.6rem)] font-bold leading-tight text-white">
            Somewhere nearby, a critical request is waiting.
          </h2>
          <p className="mt-3 max-w-lg text-white/75">
            One donation is separated into components that can serve up to three patients. Register
            once, and the network will tell you when you are the match.
          </p>
          <Link to="/auth/register" className="mt-7">
            <Button size="lg" icon={<Droplet className="h-4 w-4" />}>
              Register as a donor
            </Button>
          </Link>
        </div>
      </section>

      <footer className="surface-veil border-t border-[rgb(var(--line))]">
        <div className="shell flex flex-col items-center justify-between gap-4 py-8 sm:flex-row">
          <Wordmark />
          <div className="flex flex-col items-center gap-1 sm:items-end">
            <p className="muted text-xs">
              जीवनदान - the gift of life.
            </p>
            <p className="muted text-xs">© anilratn 2026. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function HeroStat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-3">
      <div className="mb-1 flex items-center justify-between text-white/60">
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <span className="font-display text-xl font-bold text-white" data-stat>
        <CountUp value={value} />
      </span>
      <span className="sr-only">{formatCount(value)}</span>
    </div>
  );
}
