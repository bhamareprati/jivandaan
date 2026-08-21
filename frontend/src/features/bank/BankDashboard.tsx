import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, PackageX, RefreshCw, ShieldAlert, TrendingDown } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getExpiryRadar, getInventory, reconcileInventory } from '@/api/endpoints';
import { POLL, qk } from '@/lib/queryClient';
import { useAccountId, useAuth } from '@/hooks/useAuth';
import {
  BloodGroupChip, Button, EmptyState, ErrorState, SectionHeading, Skeleton, StatTile, Surface,
} from '@/components/ui';
import { StockLevelRing } from '@/components/ui/StockLevelRing';
import { CountUp, StaggerItem, StaggerList } from '@/components/motion';
import { formatDate } from '@/lib/domain';
import { cn } from '@/lib/cn';
import type { BankAccount } from '@/types/api';

/**
 * Blood bank home (Doc 1 section 3).
 *
 * Desktop-first and data-dense: the eight-group matrix and the expiry radar
 * side by side, both polling so the numbers are current without a refresh.
 */
export function BankDashboard() {
  const bankId = useAccountId();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const inventory = useQuery({
    queryKey: qk.inventory(bankId ?? ''),
    queryFn: () => getInventory(bankId!),
    enabled: !!bankId,
    refetchInterval: POLL.bank,
  });

  const radar = useQuery({
    queryKey: qk.radar(bankId ?? ''),
    queryFn: () => getExpiryRadar(bankId!),
    enabled: !!bankId,
    refetchInterval: POLL.bank,
  });

  const reconcile = useMutation({
    mutationFn: () => reconcileInventory(bankId!),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: qk.inventory(bankId ?? '') });
      void queryClient.invalidateQueries({ queryKey: qk.radar(bankId ?? '') });
      toast.success(
        result.corrected > 0
          ? `Reconciled ${result.corrected} blood group${result.corrected === 1 ? '' : 's'} from the ledger`
          : 'Stock counts already match the donation ledger'
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unverified =
    user && (user as BankAccount).verificationStatus &&
    (user as BankAccount).verificationStatus !== 'verified';

  if (inventory.isError) {
    return (
      <ErrorState
        title="Could not load your stock"
        description={(inventory.error as Error).message}
        onRetry={() => void inventory.refetch()}
      />
    );
  }

  const matrix = inventory.data;

  return (
    <div className="flex flex-col gap-6">
      {unverified && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-card border border-amber/40 bg-amber/10 px-4 py-3"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-ink dark:text-amber" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">Awaiting verification</p>
            <p className="muted mt-0.5 text-xs leading-relaxed">
              Until an administrator verifies your licence you will not appear in search results,
              cannot record donations, and cannot be assigned requests.
            </p>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {inventory.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-card" />)
        ) : matrix ? (
          <>
            <StatTile
              label="Total units"
              value={<CountUp value={matrix.totalUnits} />}
              sub={`Across ${matrix.groups.length} blood groups`}
            />
            <StatTile
              label="Low or empty"
              value={<CountUp value={matrix.groups.filter((g) => g.isLow || g.isEmpty).length} />}
              sub={`Threshold ${matrix.lowStockThreshold} units`}
              accent="amber"
              icon={<TrendingDown className="h-4 w-4" />}
            />
            <StatTile
              label="Expiring soon"
              value={<CountUp value={radar.data?.totalUnitsAtRisk ?? 0} />}
              sub={`Within ${matrix.expiryWindowDays} days`}
              accent="crimson"
              icon={<Clock className="h-4 w-4" />}
            />
            <StatTile
              label="Out of stock"
              value={<CountUp value={matrix.groups.filter((g) => g.isEmpty).length} />}
              sub="Groups at zero"
              accent={matrix.groups.some((g) => g.isEmpty) ? 'crimson' : 'emerald'}
              icon={<PackageX className="h-4 w-4" />}
            />
          </>
        ) : null}
      </div>

      {/* ------------------------------------------------ low stock strip */}
      {matrix && matrix.lowStock.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-amber/40 bg-amber/[0.08] px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-ink dark:text-amber" aria-hidden />
          <span className="text-sm font-semibold">Below threshold:</span>
          <div className="flex flex-wrap gap-1.5">
            {matrix.lowStock.map((g) => (
              <span
                key={g.bloodGroup}
                className="inline-flex items-center gap-1.5 rounded-pill border border-amber/40 bg-[rgb(var(--surface))] px-2 py-0.5 text-xs font-semibold"
              >
                <BloodGroupChip group={g.bloodGroup} size="sm" />
                {g.units} / {g.threshold}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- stock matrix */}
      <section>
        <SectionHeading
          title="Live stock"
          subtitle={
            matrix
              ? `All eight groups · refreshes every ${POLL.bank / 1000}s`
              : 'All eight blood groups'
          }
          action={
            <Button
              variant="ghost"
              size="sm"
              loading={reconcile.isPending}
              onClick={() => reconcile.mutate()}
              icon={<RefreshCw className="h-4 w-4" />}
              title="Rebuild the cached counts from the donation ledger"
            >
              Reconcile
            </Button>
          }
        />

        <Surface>
          {inventory.isLoading ? (
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 xl:grid-cols-8">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <Skeleton className="h-[104px] w-[104px] rounded-full" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          ) : matrix ? (
            <StaggerList className="grid grid-cols-2 gap-6 sm:grid-cols-4 xl:grid-cols-8">
              {matrix.groups.map((g) => (
                <StaggerItem key={g.bloodGroup} className="flex justify-center">
                  <StockLevelRing
                    group={g.bloodGroup}
                    units={g.units}
                    threshold={matrix.lowStockThreshold}
                    expiringSoon={g.expiringSoon}
                  />
                </StaggerItem>
              ))}
            </StaggerList>
          ) : null}
        </Surface>
      </section>

      {/* ----------------------------------------------------- expiry radar */}
      <section>
        <SectionHeading
          title="Expiry radar"
          subtitle={
            radar.data
              ? `Units within ${radar.data.windowDays} days of their ${radar.data.shelfLifeDays}-day shelf life`
              : 'Units nearing expiry'
          }
        />

        {radar.isLoading ? (
          <Surface>
            <Skeleton className="mb-2 h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </Surface>
        ) : radar.isError ? (
          <ErrorState
            title="Could not load the radar"
            description={(radar.error as Error).message}
            onRetry={() => void radar.refetch()}
          />
        ) : !radar.data || radar.data.batches.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-5 w-5" />}
            title="Nothing expiring soon"
            description="No units are within the expiry window. Expired batches are swept out of your counts automatically."
          />
        ) : (
          <Surface padded={false}>
            <ul role="list" className="divide-y divide-[rgb(var(--line))]">
              {radar.data.batches.map((batch) => (
                <li
                  key={batch.donationId}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                >
                  <BloodGroupChip group={batch.bloodGroup} />

                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm font-semibold">
                      {batch.units} unit{batch.units === 1 ? '' : 's'}
                      {batch.donorName ? ` · from ${batch.donorName}` : ''}
                    </p>
                    <p className="muted text-xs">
                      Donated {formatDate(batch.donationDate)} · expires{' '}
                      {formatDate(batch.expiryDate)}
                    </p>
                  </div>

                  {/* Severity is a word as well as a colour. */}
                  <span
                    className={cn(
                      'shrink-0 rounded-pill px-2.5 py-1 text-xs font-bold tabular',
                      batch.severity === 'critical'
                        ? 'bg-flare text-white'
                        : 'bg-amber text-navy'
                    )}
                  >
                    {batch.daysToExpiry === 0
                      ? 'Expires today'
                      : `${batch.daysToExpiry}d left`}
                  </span>
                </li>
              ))}
            </ul>
          </Surface>
        )}
      </section>
    </div>
  );
}
