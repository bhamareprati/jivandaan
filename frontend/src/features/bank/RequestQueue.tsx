import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Inbox, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { listRequests, matchBloodGroup, patchRequestStatus } from '@/api/endpoints';
import { POLL, qk } from '@/lib/queryClient';
import { ApiError } from '@/api/client';
import {
  BloodGroupChip, Button, EmptyState, ErrorState, SectionHeading, Skeleton, UrgencyBadge,
} from '@/components/ui';
import { STATUS_ACTION_LABELS, statusStyle, STATUS_LABELS, timeAgo, urgencyStyle } from '@/lib/domain';
import { cn } from '@/lib/cn';
import type { BloodRequest, RequestStatus, Urgency } from '@/types/api';

const COLUMNS: Urgency[] = ['critical', 'high', 'medium', 'low'];

/**
 * Request queue (Doc 1 section 3): Kanban by urgency, Critical column pulsing.
 *
 * Status actions come from the server's `nextStatuses`, so the UI can only ever
 * offer a legal transition -- an invalid jump is not merely rejected, it is
 * unreachable. The server still enforces the machine independently.
 */
export function RequestQueue() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: qk.requests({ scope: 'bank' }),
    queryFn: () => listRequests({ limit: 100 }),
    refetchInterval: POLL.bank,
  });

  const advance = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: RequestStatus; reason?: string }) =>
      patchRequestStatus(id, { status, reason }),
    onMutate: ({ id }) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
      void queryClient.invalidateQueries({ queryKey: ['bank'] });
      toast.success(`Request ${STATUS_LABELS[result.request.status].toLowerCase()}`);
    },
    onError: (err: Error) => {
      // A 409 means the server refused the transition -- surface exactly why.
      if (err instanceof ApiError && err.isConflict) {
        toast.error(err.message, { description: 'The queue has been refreshed.' });
        void queryClient.invalidateQueries({ queryKey: ['requests'] });
      } else {
        toast.error(err.message);
      }
    },
  });

  if (requests.isError) {
    return (
      <ErrorState
        title="Could not load the queue"
        description={(requests.error as Error).message}
        onRetry={() => void requests.refetch()}
      />
    );
  }

  const open = (requests.data?.items ?? []).filter((r) => !r.isTerminal);
  const byUrgency = (u: Urgency) => open.filter((r) => r.urgency === u);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        title="Request queue"
        subtitle={`${open.length} open request${open.length === 1 ? '' : 's'} · refreshes every ${POLL.bank / 1000}s`}
      />

      {requests.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((u) => (
            <div key={u} className="flex flex-col gap-3">
              <Skeleton className="h-8 rounded-pill" />
              <Skeleton className="h-32 rounded-card" />
              <Skeleton className="h-32 rounded-card" />
            </div>
          ))}
        </div>
      ) : open.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title="No open requests"
          description="When a hospital or donor raises a request assigned to you, it appears here immediately."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((urgency) => {
            const items = byUrgency(urgency);
            const style = urgencyStyle(urgency);
            const isCritical = urgency === 'critical';

            return (
              <section
                key={urgency}
                aria-label={`${style.label} requests`}
                className={cn('flex min-w-0 flex-col rounded-card border p-3', style.column)}
              >
                {/* Only the Critical column pulses (Doc 1 section 3). */}
                <header className="relative isolate mb-3 flex items-center justify-between">
                  <span className="relative inline-flex">
                    {isCritical && items.length > 0 && (
                      <span
                        aria-hidden
                        className="absolute inset-0 -z-10 animate-pulse-ring rounded-pill bg-flare"
                      />
                    )}
                    <UrgencyBadge urgency={urgency} />
                  </span>
                  <span className="tabular rounded-pill bg-[rgb(var(--surface))] px-2 py-0.5 text-xs font-bold">
                    {items.length}
                  </span>
                </header>

                <div className="flex flex-col gap-3">
                  {items.length === 0 ? (
                    <p className="muted rounded-xl border border-dashed border-[rgb(var(--line))] px-3 py-6 text-center text-xs">
                      Nothing here
                    </p>
                  ) : (
                    items.map((request) => (
                      <QueueCard
                        key={request.id}
                        request={request}
                        busy={busyId === request.id && advance.isPending}
                        onAdvance={(status, reason) =>
                          advance.mutate({ id: request.id, status, reason })
                        }
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- card */

function QueueCard({
  request,
  busy,
  onAdvance,
}: {
  request: BloodRequest;
  busy: boolean;
  onAdvance: (status: RequestStatus, reason?: string) => void;
}) {
  const next = request.nextStatuses ?? [];
  const bankId = typeof request.bloodBank === 'string' ? request.bloodBank : request.bloodBank?._id;

  // Only ask the server for substitutes when this bank is actually assigned.
  const substitutes = useQuery({
    queryKey: qk.match(request.bloodGroup, bankId, request.units),
    queryFn: () => matchBloodGroup(request.bloodGroup, bankId, request.units),
    enabled: Boolean(bankId),
    staleTime: POLL.bank,
  });

  const short = substitutes.data && substitutes.data.exactAvailable === false;
  const options = substitutes.data?.options ?? [];

  const requesterName =
    typeof request.requester === 'object' && request.requester
      ? request.requester.name
      : (request.hospitalName ?? 'Requester');

  return (
    <article className="surface flex flex-col gap-3 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BloodGroupChip group={request.bloodGroup} />
          <span className="font-display text-sm font-bold tabular">{request.units}u</span>
        </div>
        <span className="muted shrink-0 text-[11px]">{timeAgo(request.createdAt)}</span>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{requesterName}</p>
        {request.patientName && (
          <p className="muted truncate text-xs">Patient: {request.patientName}</p>
        )}
      </div>

      <span
        className={cn(
          'w-fit rounded-pill border px-2 py-0.5 text-[11px] font-semibold',
          statusStyle(request.status)
        )}
      >
        {STATUS_LABELS[request.status]}
      </span>

      {/* Substitute hint when the exact group cannot cover the request. */}
      {short && (
        <div className="rounded-xl border border-amber/40 bg-amber/10 px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-ink dark:text-amber">
            <Info className="h-3 w-3" aria-hidden />
            {substitutes.data!.exactUnits} of {request.units} {request.bloodGroup} in stock
          </p>
          {options.length > 0 ? (
            <p className="muted mt-1 text-[11px] leading-relaxed">
              Compatible substitutes:{' '}
              <span className="font-semibold">
                {options.slice(0, 3).map((o) => `${o.bloodGroup} (${o.unitsAvailable})`).join(', ')}
              </span>
            </p>
          ) : (
            <p className="muted mt-1 text-[11px]">No compatible stock available.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-[rgb(var(--line))] pt-3">
        {busy ? (
          <span className="muted flex items-center gap-1.5 text-xs">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Updating…
          </span>
        ) : (
          <>
            {next
              .filter((s) => s !== 'cancelled')
              .map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={
                    status === 'rejected' ? 'ghost' : status === 'fulfilled' ? 'success' : 'primary'
                  }
                  className="h-8 px-2.5 text-[11px]"
                  onClick={() => {
                    if (status === 'rejected') {
                      const reason = window.prompt('Why is this request being rejected?');
                      if (!reason) return;
                      onAdvance(status, reason);
                    } else {
                      onAdvance(status);
                    }
                  }}
                >
                  {STATUS_ACTION_LABELS[status]}
                </Button>
              ))}
            <Link to={`/request/${request.id}/track`} className="ml-auto">
              <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Open tracker">
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
