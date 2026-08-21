import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CalendarClock, Droplet, HeartPulse, Inbox, MapPin, QrCode, Search, Users,
} from 'lucide-react';
import { getDonorFeed, getDonorMe } from '@/api/endpoints';
import { POLL, qk } from '@/lib/queryClient';
import {
  BloodGroupChip, Button, EmptyState, ErrorState, Skeleton, StatTile, Surface, UrgencyBadge,
} from '@/components/ui';
import { ProgressRing } from '@/components/ui/StockLevelRing';
import { CountUp, StaggerItem, StaggerList } from '@/components/motion';
import { formatDate, timeAgo } from '@/lib/domain';
import { cn } from '@/lib/cn';

/**
 * Donor home (Doc 1 section 3).
 *
 * Mobile-first: this is the screen a donor opens on a phone. The eligibility
 * ring is the anchor, then impact, then the feed of requests they can actually
 * answer.
 */
export function DonorDashboard() {
  const me = useQuery({ queryKey: qk.donorMe, queryFn: getDonorMe });

  const feed = useQuery({
    queryKey: qk.donorFeed({ limit: 10 }),
    queryFn: () => getDonorFeed({ limit: 10 }),
    refetchInterval: POLL.feed,
  });

  if (me.isError) {
    return (
      <ErrorState
        title="Could not load your profile"
        description={(me.error as Error).message}
        onRetry={() => void me.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ------------------------------------------------- eligibility ring */}
      {me.isLoading ? (
        <Surface className="flex items-center gap-6">
          <Skeleton className="h-40 w-40 rounded-full" />
          <div className="flex-1">
            <Skeleton className="mb-3 h-5 w-40" />
            <Skeleton className="mb-2 h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </Surface>
      ) : me.data ? (
        <EligibilityCard
          eligible={me.data.eligibility.eligible}
          progress={me.data.eligibility.progress}
          daysRemaining={me.data.eligibility.daysRemaining}
          nextEligibleDate={me.data.eligibility.nextEligibleDate}
          intervalDays={me.data.eligibility.intervalDays}
          bloodgroup={me.data.profile.bloodgroup}
          name={me.data.profile.name}
        />
      ) : null}

      {/* ------------------------------------------------------- impact row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {me.isLoading ? (
          <>
            <Skeleton className="h-24 rounded-card" />
            <Skeleton className="h-24 rounded-card" />
            <Skeleton className="h-24 rounded-card" />
          </>
        ) : me.data ? (
          <>
            <StatTile
              label="Donations"
              value={<CountUp value={me.data.impact.totalDonations} />}
              icon={<Droplet className="h-4 w-4" />}
              accent="crimson"
            />
            <StatTile
              label="Units given"
              value={<CountUp value={me.data.impact.totalUnits} />}
              icon={<HeartPulse className="h-4 w-4" />}
              accent="crimson"
            />
            <StatTile
              label="Lives impacted"
              value={<CountUp value={me.data.impact.livesImpactedEstimate} />}
              sub="Estimated at 3 per unit"
              icon={<Users className="h-4 w-4" />}
              accent="emerald"
              className="col-span-2 sm:col-span-1"
            />
          </>
        ) : null}
      </div>

      {/* ---------------------------------------------------- quick actions */}
      <div className="grid grid-cols-3 gap-3">
        <QuickAction to="/donor/pass" icon={<QrCode className="h-5 w-5" />} label="My pass" />
        <QuickAction to="/search" icon={<Search className="h-5 w-5" />} label="Find a bank" />
        <QuickAction to="/request/new" icon={<Droplet className="h-5 w-5" />} label="Raise request" />
      </div>

      {/* ------------------------------------------------------------ feed */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Requests you can answer</h2>
            <p className="muted text-sm">
              {me.data
                ? `Matched to your ${me.data.profile.bloodgroup} blood, nearest first`
                : 'Matched to your blood group'}
            </p>
          </div>
          {feed.isFetching && !feed.isLoading && (
            <span className="muted text-[11px] font-medium">Updating…</span>
          )}
        </div>

        {feed.isLoading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Surface key={i}>
                <Skeleton className="mb-2 h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </Surface>
            ))}
          </div>
        ) : feed.isError ? (
          <ErrorState
            title="Could not load the feed"
            description={(feed.error as Error).message}
            onRetry={() => void feed.refetch()}
          />
        ) : !feed.data || feed.data.items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            title="No open requests near you"
            description="When someone nearby needs blood your group can serve, it will appear here within 30 seconds."
          />
        ) : (
          <StaggerList className="flex flex-col gap-3">
            {feed.data.items.map((item) => (
              <StaggerItem key={item.id}>
                <Surface className="flex items-start gap-4">
                  <BloodGroupChip group={item.bloodGroup} size="lg" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <UrgencyBadge urgency={item.urgency} size="sm" />
                      {item.isExactMatch && (
                        <span className="rounded-pill bg-emerald-ink/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-ink dark:text-emerald-light">
                          Exact match
                        </span>
                      )}
                    </div>

                    <p className="mt-1.5 truncate font-display text-sm font-semibold">
                      {item.units} unit{item.units === 1 ? '' : 's'} of {item.bloodGroup}
                      {item.hospitalName ? ` · ${item.hospitalName}` : ''}
                    </p>

                    <p className="muted mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      {item.bank && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" aria-hidden />
                          {item.bank.name}, {item.bank.city}
                        </span>
                      )}
                      <span>{timeAgo(item.createdAt)}</span>
                    </p>
                  </div>

                  <Link to={`/request/${item.id}/track`} className="shrink-0 self-center">
                    <Button variant="ghost" size="sm" aria-label="View request">
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </Surface>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ sub-parts */

function EligibilityCard({
  eligible, progress, daysRemaining, nextEligibleDate, intervalDays, bloodgroup, name,
}: {
  eligible: boolean;
  progress: number;
  daysRemaining: number;
  nextEligibleDate: string | null;
  intervalDays: number;
  bloodgroup: string;
  name: string;
}) {
  return (
    <Surface
      className={cn(
        'relative overflow-hidden',
        eligible ? 'border-emerald/30' : 'border-crimson/25'
      )}
    >
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
        <ProgressRing
          progress={eligible ? 1 : progress}
          size={148}
          stroke={11}
          colour={eligible ? '#1F7A6F' : '#E63946'}
          label={
            eligible
              ? 'You are eligible to donate'
              : `${daysRemaining} days until you can donate again`
          }
        >
          {eligible ? (
            <>
              <HeartPulse className="mb-1 h-6 w-6 text-emerald-ink dark:text-emerald-light" aria-hidden />
              <span className="font-display text-sm font-bold text-emerald-ink dark:text-emerald-light">
                Eligible
              </span>
            </>
          ) : (
            <>
              <span className="font-display text-2xl font-bold" data-stat>
                <CountUp value={daysRemaining} />
              </span>
              <span className="muted text-xs font-medium">days to go</span>
            </>
          )}
        </ProgressRing>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="mb-2 flex items-center justify-center gap-2 sm:justify-start">
            <BloodGroupChip group={bloodgroup as never} />
            <span className="muted text-sm">{name}</span>
          </div>

          <h1 className="font-display text-xl font-bold">
            {eligible ? 'You can donate today' : 'Recovering from your last donation'}
          </h1>

          <p className="muted mt-1.5 text-sm leading-relaxed">
            {eligible
              ? `The ${intervalDays}-day interval since your last donation has passed. Find a bank near you and bring your digital pass.`
              : `Donors wait ${intervalDays} days between donations. You will be eligible again on ${formatDate(nextEligibleDate)}.`}
          </p>

          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {eligible ? (
              <Link to="/search">
                <Button size="sm" icon={<Search className="h-4 w-4" />}>
                  Find a blood bank
                </Button>
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-pill border border-[rgb(var(--line))] px-3 py-1.5 text-xs font-medium">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                Next eligible {formatDate(nextEligibleDate)}
              </span>
            )}
            <Link to="/donor/pass">
              <Button size="sm" variant="outline" icon={<QrCode className="h-4 w-4" />}>
                Show my pass
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </Surface>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="surface flex flex-col items-center gap-2 px-3 py-4 text-center transition-transform active:scale-[0.97]"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-crimson/10 text-crimson-ink dark:text-crimson-light">
        {icon}
      </span>
      <span className="text-xs font-semibold">{label}</span>
    </Link>
  );
}
