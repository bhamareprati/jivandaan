import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2, ChevronDown, Clock, MapPin, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { listPendingBanks, verifyBank } from '@/api/endpoints';
import { qk } from '@/lib/queryClient';
import {
  Button, EmptyState, ErrorState, Field, SectionHeading, Skeleton, Surface, Textarea,
} from '@/components/ui';
import { formatDate } from '@/lib/domain';
import { cn } from '@/lib/cn';
import type { PendingBank } from '@/types/api';

/**
 * Blood bank verification queue (Doc 1 section 3).
 *
 * Approving a bank makes it appear in public search and lets it trade units, so
 * the licence detail is expandable rather than hidden, and rejection REQUIRES a
 * written reason - the server enforces that too, and the reason is recorded in
 * the audit log.
 */
export function VerificationQueue() {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();

  const pending = useQuery({
    queryKey: qk.adminPending(page),
    queryFn: () => listPendingBanks(page),
  });

  const decide = useMutation({
    mutationFn: ({ id, action, why }: { id: string; action: 'approve' | 'reject'; why?: string }) =>
      verifyBank(id, action, why),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      void queryClient.invalidateQueries({ queryKey: ['banks'] });
      setRejecting(null);
      setReason('');
      toast.success(
        variables.action === 'approve'
          ? 'Bank verified - it now appears in search'
          : 'Bank rejected'
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (pending.isError) {
    return (
      <ErrorState
        title="Could not load the verification queue"
        description={(pending.error as Error).message}
        onRetry={() => void pending.refetch()}
      />
    );
  }

  const items = pending.data?.items ?? [];
  const meta = pending.data?.meta;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        title="Verification queue"
        subtitle="Blood banks cannot appear in search or record donations until verified."
      />

      {pending.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BadgeCheck className="h-5 w-5" />}
          title="Nothing awaiting review"
          description="Every registered blood bank has been verified or rejected."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((bank) => (
            <BankRow
              key={bank.id}
              bank={bank}
              expanded={expanded === bank.id}
              onToggle={() => setExpanded(expanded === bank.id ? null : bank.id)}
              rejecting={rejecting === bank.id}
              reason={reason}
              onReasonChange={setReason}
              onStartReject={() => {
                setRejecting(bank.id);
                setReason('');
              }}
              onCancelReject={() => {
                setRejecting(null);
                setReason('');
              }}
              busy={decide.isPending}
              onApprove={() => decide.mutate({ id: bank.id, action: 'approve' })}
              onReject={() => decide.mutate({ id: bank.id, action: 'reject', why: reason })}
            />
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="muted tabular text-xs">
            Page {meta.page} of {meta.totalPages} · {meta.total} pending
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function BankRow({
  bank, expanded, onToggle, rejecting, reason, onReasonChange,
  onStartReject, onCancelReject, busy, onApprove, onReject,
}: {
  bank: PendingBank;
  expanded: boolean;
  onToggle: () => void;
  rejecting: boolean;
  reason: string;
  onReasonChange: (v: string) => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const stale = bank.waitingDays >= 3;

  return (
    <Surface padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-crimson/10 text-crimson-ink dark:text-crimson-light">
          <Building2 className="h-5 w-5" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-sm font-semibold">{bank.name}</h3>
          <p className="muted truncate text-xs">
            {bank.city}, {bank.state} · {bank.email}
          </p>
        </div>

        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold',
            stale ? 'bg-amber/20 text-amber-ink dark:text-amber' : 'bg-[rgb(var(--line))] muted'
          )}
        >
          <Clock className="h-3 w-3" aria-hidden />
          {bank.waitingDays === 0 ? 'Today' : `${bank.waitingDays}d waiting`}
        </span>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex items-center gap-1 rounded-pill px-2 py-1 text-xs font-semibold hover:bg-[rgb(var(--line))]"
        >
          Details
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {expanded && (
        <dl className="grid gap-3 border-t border-[rgb(var(--line))] bg-[rgb(var(--surface-sunken))] px-4 py-4 text-sm sm:grid-cols-2">
          <Detail label="Licence number" value={bank.licenseNumber ?? 'Not supplied'} warn={!bank.licenseNumber} />
          <Detail label="Contact" value={bank.contact} />
          <Detail label="Address" value={`${bank.address}, ${bank.city} ${bank.pincode}`} />
          <Detail
            label="Coordinates"
            value={
              bank.location?.coordinates
                ? `${bank.location.coordinates[1].toFixed(4)}, ${bank.location.coordinates[0].toFixed(4)}`
                : 'Not supplied - will not appear in radius search'
            }
            warn={!bank.location?.coordinates}
          />
          <Detail label="Registered" value={formatDate(bank.createdAt)} />
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[rgb(var(--line))] px-4 py-3">
        {rejecting ? (
          <div className="flex w-full flex-col gap-3">
            <Field label="Reason for rejection" required hint="Recorded in the audit log and sent to the bank">
              {(id, d) => (
                <Textarea
                  id={id}
                  value={reason}
                  onChange={(e) => onReasonChange(e.target.value)}
                  aria-describedby={d}
                  maxLength={500}
                  placeholder="e.g. Licence number could not be validated with the state registry"
                />
              )}
            </Field>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={reason.trim().length < 3}
                loading={busy}
                onClick={onReject}
              >
                Confirm rejection
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancelReject}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button
              variant="success"
              size="sm"
              loading={busy}
              onClick={onApprove}
              icon={<BadgeCheck className="h-4 w-4" />}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onStartReject}
              icon={<ShieldX className="h-4 w-4" />}
            >
              Reject
            </Button>
            {!bank.licenseNumber && (
              <span className="muted ml-auto flex items-center gap-1.5 text-xs">
                <MapPin className="h-3 w-3" aria-hidden />
                No licence number on file
              </span>
            )}
          </>
        )}
      </div>
    </Surface>
  );
}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="muted text-xs uppercase tracking-wide">{label}</dt>
      <dd className={cn('mt-0.5 font-medium', warn && 'text-amber-ink dark:text-amber')}>{value}</dd>
    </div>
  );
}
