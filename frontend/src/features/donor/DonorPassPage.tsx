import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Award, CalendarDays, Droplet, Lock, ShieldCheck } from 'lucide-react';
import { getDonorPass } from '@/api/endpoints';
import { qk } from '@/lib/queryClient';
import { BloodGroupChip, ErrorState, Skeleton, Surface, EmptyState } from '@/components/ui';
import { CountUp, StaggerItem, StaggerList } from '@/components/motion';
import { formatDate } from '@/lib/domain';
import { cn } from '@/lib/cn';

/**
 * Digital donor pass (Doc 1 section 3).
 *
 * The QR encodes a signed, long-lived token the bank verifies at check-in. Two
 * consequences shape this screen:
 *
 *  - The code is a credential, so it is never persisted anywhere, never logged,
 *    and the page warns before it is shared.
 *  - It must actually scan: a solid white quiet zone, a generous minimum size,
 *    and NO glass or blur behind it. Applying the glass treatment here would
 *    look on-brand and quietly break the scanner.
 */
export function DonorPassPage() {
  const pass = useQuery({
    queryKey: qk.donorPass,
    queryFn: getDonorPass,
    // A credential -- keep it out of the cache for longer than needed.
    gcTime: 60_000,
    staleTime: 30_000,
  });

  if (pass.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-80 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    );
  }

  if (pass.isError || !pass.data) {
    return (
      <ErrorState
        title="Could not load your pass"
        description={(pass.error as Error)?.message}
        onRetry={() => void pass.refetch()}
      />
    );
  }

  const { pass: card, impact, badges, timeline, eligibility } = pass.data;

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------------------------------------------------- card */}
      <div
        className={cn(
          'relative overflow-hidden rounded-card p-6 text-white shadow-raised',
          'bg-gradient-to-br from-burgundy via-[#5C0018] to-navy'
        )}
      >
        {/* Subtle noise so the card reads as a physical object, not a div. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
          }}
        />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60">
              <Droplet className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
              Jivandan donor pass
            </p>

            <h1 className="mt-3 font-display text-2xl font-bold leading-tight">{card.name}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <BloodGroupChip
                group={card.bloodgroup}
                size="lg"
                className="border-white/30 bg-white/15 text-white"
              />
              <span
                className={cn(
                  'rounded-pill px-2.5 py-1 text-xs font-semibold',
                  eligibility.eligible
                    ? 'bg-emerald/25 text-emerald-light'
                    : 'bg-amber/20 text-amber'
                )}
              >
                {eligibility.eligible
                  ? 'Eligible now'
                  : `${eligibility.daysRemaining} days to go`}
              </span>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-white/50">Donor ID</dt>
                <dd className="tabular mt-0.5 font-mono text-xs text-white/85">
                  {card.donorId.slice(-10).toUpperCase()}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-white/50">Member since</dt>
                <dd className="mt-0.5 text-white/85">{formatDate(card.memberSince)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-white/50">Donations</dt>
                <dd className="mt-0.5 font-display text-lg font-bold" data-stat>
                  <CountUp value={impact.totalDonations} />
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-white/50">Units given</dt>
                <dd className="mt-0.5 font-display text-lg font-bold" data-stat>
                  <CountUp value={impact.totalUnits} />
                </dd>
              </div>
            </dl>
          </div>

          {/* Solid white plate, no blur -- the scanner needs the contrast. */}
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-2xl bg-white p-4 shadow-raised">
              <QRCodeSVG
                value={card.qrPayload}
                size={196}
                level="M"
                marginSize={2}
                bgColor="#FFFFFF"
                fgColor="#0F172A"
                title="Your Jivandan donor pass"
              />
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-white/60">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Signed &amp; verified at check-in
            </p>
          </div>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-card border border-amber/40 bg-amber/10 px-4 py-3 text-xs leading-relaxed">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-ink dark:text-amber" aria-hidden />
        <span>
          This QR code is a credential. Show it only to blood bank staff at check-in - anyone who
          photographs it could present it as yours.
        </span>
      </p>

      {/* -------------------------------------------------------- badges */}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Milestones</h2>
        <StaggerList className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {badges.map((badge) => (
            <StaggerItem key={badge.id}>
              <div
                className={cn(
                  'flex h-full flex-col items-center gap-2 rounded-card border px-3 py-4 text-center',
                  badge.earned
                    ? 'border-crimson/30 bg-crimson/[0.06]'
                    : 'border-dashed border-[rgb(var(--line))] opacity-60'
                )}
              >
                <Award
                  className={cn(
                    'h-6 w-6',
                    badge.earned
                      ? 'text-crimson-ink dark:text-crimson-light'
                      : 'text-[rgb(var(--ink-muted))]'
                  )}
                  aria-hidden
                />
                <span className="font-display text-xs font-bold">{badge.label}</span>
                <span className="muted text-[11px]">
                  {badge.earned ? 'Earned' : `${badge.remaining} to go`}
                </span>
              </div>
            </StaggerItem>
          ))}
        </StaggerList>
      </section>

      {/* ------------------------------------------------------ timeline */}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Donation history</h2>

        {timeline.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title="No donations recorded yet"
            description="Once a blood bank scans your pass, every donation appears here with its expiry date."
          />
        ) : (
          <ol className="relative flex flex-col gap-0 pl-6">
            <span
              className="absolute left-[9px] top-2 h-[calc(100%-1rem)] w-0.5 bg-[rgb(var(--line))]"
              aria-hidden
            />
            {timeline.map((entry) => (
              <li key={entry.donationId} className="relative pb-6 last:pb-0">
                <span
                  className={cn(
                    'absolute -left-6 top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-pill border-2',
                    entry.isExpired
                      ? 'border-[rgb(var(--line))] bg-[rgb(var(--surface))]'
                      : 'border-crimson-ink bg-crimson-ink'
                  )}
                  aria-hidden
                >
                  <Droplet
                    className={cn('h-2.5 w-2.5', entry.isExpired ? 'text-[rgb(var(--ink-muted))]' : 'text-white')}
                    fill="currentColor"
                  />
                </span>

                <Surface className="ml-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <BloodGroupChip group={entry.bloodGroup} size="sm" />
                      <span className="font-display text-sm font-semibold">
                        {entry.units} unit{entry.units === 1 ? '' : 's'}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'rounded-pill px-2 py-0.5 text-[11px] font-semibold capitalize',
                        entry.status === 'available' &&
                          'bg-emerald-ink/10 text-emerald-ink dark:text-emerald-light',
                        entry.status === 'used' && 'bg-crimson/10 text-crimson-ink dark:text-crimson-light',
                        entry.status === 'expired' &&
                          'bg-[rgb(var(--line))] text-[rgb(var(--ink-muted))]'
                      )}
                    >
                      {entry.status}
                    </span>
                  </div>

                  <p className="muted mt-1.5 text-xs">
                    {entry.bankName ?? 'Unknown bank'}
                    {entry.bankCity ? `, ${entry.bankCity}` : ''} · donated{' '}
                    {formatDate(entry.donationDate)} · expires {formatDate(entry.expiryDate)}
                  </p>
                </Surface>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
