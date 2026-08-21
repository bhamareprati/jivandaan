import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Droplet, Inbox } from 'lucide-react';
import { listRequests } from '@/api/endpoints';
import { POLL, qk } from '@/lib/queryClient';
import {
  BloodGroupChip, Button, EmptyState, ErrorState, SectionHeading, Skeleton, Surface, UrgencyBadge,
} from '@/components/ui';
import { StaggerItem, StaggerList } from '@/components/motion';
import { STATUS_LABELS, statusStyle, timeAgo } from '@/lib/domain';
import { cn } from '@/lib/cn';

/**
 * A requester's own requests.
 *
 * Doc 1 lists no dedicated hospital dashboard, so this is the hospital's home:
 * everything they have raised, newest and most urgent first, each linking to
 * the live tracker. Donors who raise requests see the same screen.
 */
export function MyRequestsPage() {
  const requests = useQuery({
    queryKey: qk.requests({ mine: true }),
    queryFn: () => listRequests({ mine: true, limit: 50 }),
    refetchInterval: POLL.bank,
  });

  if (requests.isError) {
    return (
      <ErrorState
        title="Could not load your requests"
        description={(requests.error as Error).message}
        onRetry={() => void requests.refetch()}
      />
    );
  }

  const items = requests.data?.items ?? [];
  const open = items.filter((r) => !r.isTerminal);
  const closed = items.filter((r) => r.isTerminal);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <SectionHeading
        title="Your requests"
        subtitle={`${open.length} open · ${closed.length} closed`}
        action={
          <Link to="/request/new">
            <Button size="sm" icon={<Droplet className="h-4 w-4" />}>
              New request
            </Button>
          </Link>
        }
      />

      {requests.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-card" />
          <Skeleton className="h-24 rounded-card" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title="No requests yet"
          description="Raise a request and you will be able to watch it move from submitted to fulfilled."
          action={
            <Link to="/request/new">
              <Button icon={<Droplet className="h-4 w-4" />}>Raise a request</Button>
            </Link>
          }
        />
      ) : (
        <>
          {open.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-base font-semibold">In progress</h2>
              <StaggerList className="flex flex-col gap-3">
                {open.map((r) => (
                  <StaggerItem key={r.id}>
                    <RequestRow request={r} />
                  </StaggerItem>
                ))}
              </StaggerList>
            </section>
          )}

          {closed.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-base font-semibold">Closed</h2>
              <div className="flex flex-col gap-3 opacity-80">
                {closed.map((r) => (
                  <RequestRow key={r.id} request={r} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function RequestRow({ request }: { request: import('@/types/api').BloodRequest }) {
  const bank = typeof request.bloodBank === 'object' ? request.bloodBank : null;

  return (
    <Surface className="flex flex-wrap items-center gap-4">
      <BloodGroupChip group={request.bloodGroup} size="lg" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <UrgencyBadge urgency={request.urgency} size="sm" />
          <span
            className={cn(
              'rounded-pill border px-2 py-0.5 text-[11px] font-semibold',
              statusStyle(request.status)
            )}
          >
            {STATUS_LABELS[request.status]}
          </span>
        </div>

        <p className="mt-1.5 truncate font-display text-sm font-semibold">
          {request.units} unit{request.units === 1 ? '' : 's'}
          {request.patientName ? ` · ${request.patientName}` : ''}
        </p>

        <p className="muted mt-0.5 truncate text-xs">
          {bank ? bank.name : 'Unassigned'} · raised {timeAgo(request.createdAt)}
        </p>
      </div>

      <Link to={`/request/${request.id}/track`} className="shrink-0">
        <Button variant="outline" size="sm" icon={<ArrowRight className="h-4 w-4" />}>
          Track
        </Button>
      </Link>
    </Surface>
  );
}
