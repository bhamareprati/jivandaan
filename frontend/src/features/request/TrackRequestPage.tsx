import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, Droplet, Info, Phone, Radio, User } from 'lucide-react';
import { getRequest } from '@/api/endpoints';
import { POLL, qk } from '@/lib/queryClient';
import {
  BloodGroupChip, ErrorState, SectionHeading, Skeleton, Surface, UrgencyBadge,
} from '@/components/ui';
import { StatusStepper } from '@/components/ui/StatusStepper';
import { formatDateTime, statusStyle, STATUS_LABELS } from '@/lib/domain';
import { cn } from '@/lib/cn';

/**
 * Live request tracker (Doc 1 section 3).
 *
 * Polls every 5 seconds while the request is still moving and STOPS once it
 * reaches a terminal state. A tracker that keeps polling a fulfilled request
 * forever is a battery and quota leak, and the data cannot change again.
 */
export function TrackRequestPage() {
  const { id = '' } = useParams();

  const query = useQuery({
    queryKey: qk.request(id),
    queryFn: () => getRequest(id),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return POLL.tracker;
      return data.stepper.isTerminal ? false : POLL.tracker;
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    const err = query.error as Error & { status?: number };
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          title={err?.status === 403 ? 'You do not have access to this request' : 'Could not load the request'}
          description={
            err?.status === 403
              ? 'Only the requester, the assigned blood bank and administrators can view a request.'
              : err?.message
          }
          onRetry={err?.status === 403 ? undefined : () => void query.refetch()}
        />
      </div>
    );
  }

  const { request, stepper, substitutes } = query.data;

  const bank = typeof request.bloodBank === 'object' ? request.bloodBank : null;
  const requester = typeof request.requester === 'object' ? request.requester : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      {/* --------------------------------------------------------- header */}
      <Surface>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <BloodGroupChip group={request.bloodGroup} size="lg" />
            <div>
              <h1 className="font-display text-xl font-bold">
                {request.units} unit{request.units === 1 ? '' : 's'} of {request.bloodGroup}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <UrgencyBadge urgency={request.urgency} size="sm" />
                <span
                  className={cn(
                    'rounded-pill border px-2.5 py-0.5 text-xs font-semibold',
                    statusStyle(request.status)
                  )}
                >
                  {STATUS_LABELS[request.status]}
                </span>
              </div>
            </div>
          </div>

          {/* The live indicator stops when polling does -- it never lies. */}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold',
              stepper.isTerminal
                ? 'bg-[rgb(var(--line))] text-[rgb(var(--ink-muted))]'
                : 'bg-emerald-ink/10 text-emerald-ink dark:text-emerald-light'
            )}
            aria-live="polite"
          >
            <Radio className="h-3 w-3" aria-hidden />
            {stepper.isTerminal ? 'Closed' : `Live · every ${POLL.tracker / 1000}s`}
          </span>
        </div>

        {(request.patientName || request.hospitalName) && (
          <p className="muted mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {request.patientName && (
              <span className="inline-flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" aria-hidden /> {request.patientName}
              </span>
            )}
            {request.hospitalName && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" aria-hidden /> {request.hospitalName}
              </span>
            )}
          </p>
        )}
      </Surface>

      {/* -------------------------------------------------------- stepper */}
      <Surface>
        <SectionHeading title="Progress" subtitle="Each step shows when it actually happened." />
        {/* Announced politely so a screen reader hears status changes. */}
        <div aria-live="polite" aria-atomic="false">
          <div className="hidden sm:block">
            <StatusStepper stepper={stepper} />
          </div>
          <div className="sm:hidden">
            <StatusStepper stepper={stepper} orientation="vertical" />
          </div>
        </div>
      </Surface>

      {/* ---------------------------------------------------- substitutes */}
      {substitutes && !substitutes.exactAvailable && substitutes.options.length > 0 && (
        <Surface className="border-amber/40 bg-amber/[0.05]">
          <p className="flex items-center gap-2 font-display text-sm font-semibold">
            <Info className="h-4 w-4 text-amber-ink dark:text-amber" aria-hidden />
            Compatible substitutes available
          </p>
          <p className="muted mt-1.5 text-sm">
            The bank holds {substitutes.exactUnits} of the {substitutes.unitsRequested}{' '}
            {substitutes.requestedGroup} units needed. These groups are safe alternatives and are in
            stock:
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {substitutes.options.map((option) => (
              <li
                key={option.bloodGroup}
                className="flex items-center gap-2 rounded-pill border border-[rgb(var(--line))] bg-[rgb(var(--surface))] px-2.5 py-1"
              >
                <BloodGroupChip group={option.bloodGroup} size="sm" />
                <span className="tabular text-xs font-semibold">{option.unitsAvailable} units</span>
                {option.coversRequest && (
                  <span className="text-[11px] font-semibold text-emerald-ink dark:text-emerald-light">
                    covers
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Surface>
      )}

      {/* --------------------------------------------------------- detail */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Surface>
          <p className="muted mb-2 text-xs font-semibold uppercase tracking-wide">Assigned bank</p>
          {bank ? (
            <>
              <p className="font-display text-sm font-semibold">{bank.name}</p>
              {bank.address && <p className="muted mt-0.5 text-xs">{bank.address}</p>}
              {bank.contact && (
                <a
                  href={`tel:${bank.contact}`}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-crimson-ink underline-offset-4 hover:underline dark:text-crimson-light"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden />
                  {bank.contact}
                </a>
              )}
            </>
          ) : (
            <p className="muted text-sm">
              Not yet assigned - any verified bank can pick this up from its queue.
            </p>
          )}
        </Surface>

        <Surface>
          <p className="muted mb-2 text-xs font-semibold uppercase tracking-wide">Request details</p>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="muted">Raised</dt>
              <dd className="text-right font-medium">{formatDateTime(request.createdAt)}</dd>
            </div>
            {request.requiredBy && (
              <div className="flex justify-between gap-3">
                <dt className="muted">Needed by</dt>
                <dd className="text-right font-medium">{formatDateTime(request.requiredBy)}</dd>
              </div>
            )}
            {requester && (
              <div className="flex justify-between gap-3">
                <dt className="muted">Requested by</dt>
                <dd className="text-right font-medium">{requester.name}</dd>
              </div>
            )}
            {request.fulfilledAt && (
              <div className="flex justify-between gap-3">
                <dt className="muted">Fulfilled</dt>
                <dd className="text-right font-medium text-emerald-ink dark:text-emerald-light">
                  {formatDateTime(request.fulfilledAt)}
                </dd>
              </div>
            )}
          </dl>
        </Surface>
      </div>

      {request.rejectionReason && (
        <Surface className="border-flare/40 bg-flare/[0.05]">
          <p className="font-display text-sm font-semibold">Reason given</p>
          <p className="muted mt-1 text-sm">{request.rejectionReason}</p>
        </Surface>
      )}

      {request.notes && (
        <Surface>
          <p className="muted mb-1 text-xs font-semibold uppercase tracking-wide">Notes</p>
          <p className="text-sm leading-relaxed">{request.notes}</p>
        </Surface>
      )}

      {stepper.isTerminal && request.status === 'fulfilled' && (
        <p className="flex items-center justify-center gap-2 rounded-card border border-emerald/40 bg-emerald-ink/[0.07] px-4 py-4 text-sm font-semibold text-emerald-ink dark:text-emerald-light">
          <Droplet className="h-4 w-4" fill="currentColor" aria-hidden />
          This request has been fulfilled.
        </p>
      )}
    </div>
  );
}
