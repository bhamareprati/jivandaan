import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, Search as SearchIcon, X } from 'lucide-react';
import { listAuditLogs } from '@/api/endpoints';
import { qk } from '@/lib/queryClient';
import {
  Button, EmptyState, ErrorState, Input, SectionHeading, Select, Skeleton, Surface,
} from '@/components/ui';
import { formatDateTime } from '@/lib/domain';
import { cn } from '@/lib/cn';

/**
 * Audit log (Doc 1 section 3).
 *
 * Server-paginated and server-filtered: this table grows without bound, so it
 * never loads more than a page at a time. The log is append-only by design -
 * there is no route anywhere that edits or deletes an entry, which is exactly
 * what makes it worth trusting.
 */

const ACTIONS = [
  'register', 'login', 'logout', 'password_reset_request', 'password_reset',
  'profile_update', 'inventory_adjust', 'donation_checkin', 'inventory_reconcile',
  'units_expired', 'request_create', 'request_status_change', 'bank_verify',
] as const;

const ACTION_TONE: Record<string, string> = {
  bank_verify: 'bg-emerald-ink/10 text-emerald-ink dark:text-emerald-light',
  request_status_change: 'bg-crimson/10 text-crimson-ink dark:text-crimson-light',
  donation_checkin: 'bg-crimson/10 text-crimson-ink dark:text-crimson-light',
  request_create: 'bg-amber/15 text-amber-ink dark:text-amber',
  units_expired: 'bg-flare/10 text-flare',
  inventory_adjust: 'bg-amber/15 text-amber-ink dark:text-amber',
  inventory_reconcile: 'bg-amber/15 text-amber-ink dark:text-amber',
};

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = useMemo(
    () => ({ page, limit: 25, action: action || undefined, from: from || undefined, to: to || undefined }),
    [page, action, from, to]
  );

  const logs = useQuery({
    queryKey: qk.adminLogs(params),
    queryFn: () => listAuditLogs(params),
  });

  const reset = () => {
    setAction('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const hasFilters = Boolean(action || from || to);
  const items = logs.data?.items ?? [];
  const meta = logs.data?.meta;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        title="Audit log"
        subtitle="Every state-changing action, append-only. Nothing here can be edited or deleted."
      />

      {/* --------------------------------------------------------- filters */}
      <Surface className="grid gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="action" className="text-sm font-medium">Action</label>
          <Select
            id="action"
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="from" className="text-sm font-medium">From</label>
          <Input id="from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="to" className="text-sm font-medium">To</label>
          <Input id="to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>

        <div className="flex items-end">
          <Button
            variant="ghost"
            onClick={reset}
            disabled={!hasFilters}
            icon={<X className="h-4 w-4" />}
            className="w-full"
          >
            Clear filters
          </Button>
        </div>
      </Surface>

      {/* ------------------------------------------------------------ table */}
      {logs.isLoading ? (
        <Surface>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="mb-3 h-10 rounded-lg" />
          ))}
        </Surface>
      ) : logs.isError ? (
        <ErrorState
          title="Could not load the audit log"
          description={(logs.error as Error).message}
          onRetry={() => void logs.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-5 w-5" />}
          title="No entries match those filters"
          description={hasFilters ? 'Try widening the date range or clearing the action filter.' : undefined}
          action={hasFilters ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button> : undefined}
        />
      ) : (
        <Surface padded={false}>
          {/* Wide table scrolls inside its own container, never the page. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Platform audit log</caption>
              <thead>
                <tr className="border-b border-[rgb(var(--line))] text-left">
                  <th scope="col" className="muted px-4 py-3 text-xs font-semibold uppercase tracking-wide">When</th>
                  <th scope="col" className="muted px-4 py-3 text-xs font-semibold uppercase tracking-wide">Action</th>
                  <th scope="col" className="muted px-4 py-3 text-xs font-semibold uppercase tracking-wide">Description</th>
                  <th scope="col" className="muted px-4 py-3 text-xs font-semibold uppercase tracking-wide">Actor</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    className="cursor-pointer border-b border-[rgb(var(--line))] last:border-0 hover:bg-[rgb(var(--surface-sunken))]"
                  >
                    <td className="tabular whitespace-nowrap px-4 py-3 text-xs muted">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block whitespace-nowrap rounded-pill px-2 py-0.5 text-[11px] font-semibold',
                          ACTION_TONE[entry.action] ?? 'bg-[rgb(var(--line))] muted'
                        )}
                      >
                        {entry.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="line-clamp-2">{entry.description}</span>
                      {expanded === entry.id && entry.metadata && (
                        <pre className="mt-2 max-w-xl overflow-x-auto rounded-lg bg-[rgb(var(--surface-sunken))] p-2 text-[11px] leading-relaxed">
                          {JSON.stringify(entry.metadata, null, 2)}
                        </pre>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs muted">
                      <span className="capitalize">{entry.userModel.replace('-', ' ')}</span>
                      <span className="ml-1 font-mono opacity-70">{entry.user.slice(-6)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {meta && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="muted tabular flex items-center gap-2 text-xs">
            <ScrollText className="h-3.5 w-3.5" aria-hidden />
            Page {meta.page} of {meta.totalPages} · {meta.total} entries
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
