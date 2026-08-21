import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

/**
 * Polling intervals (plan decision D-8).
 *
 * Doc 1 asks for a "live" tracker, stock matrix and feed but the contract
 * defines no push transport, so the UI polls. These intervals are the whole
 * "live" story in one place: swapping them for socket-driven invalidation later
 * touches nothing else.
 */
export const POLL = {
  /** The request tracker. Stops once the status is terminal -- see useRequest. */
  tracker: 5_000,
  /** Bank stock matrix, expiry radar and the request queue. */
  bank: 15_000,
  /** Donor urgent-requests feed. */
  feed: 30_000,
  /** Landing page impact counters. */
  landing: 60_000,
  /** Admin dashboard KPIs. */
  admin: 30_000,
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        // Never retry a request the server deliberately refused -- retrying a
        // 401/403/422 just burns the rate limit and confuses the user.
        if (error instanceof ApiError) {
          if (error.status === 0) return failureCount < 2;
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export const qk = {
  session: ['session'] as const,
  health: ['health'] as const,

  donorMe: ['donor', 'me'] as const,
  donorPass: ['donor', 'pass'] as const,
  donorFeed: (params: unknown) => ['donor', 'feed', params] as const,

  inventory: (bankId: string) => ['bank', bankId, 'inventory'] as const,
  radar: (bankId: string, days?: number) => ['bank', bankId, 'radar', days ?? null] as const,

  requests: (params: unknown) => ['requests', params] as const,
  request: (id: string) => ['request', id] as const,
  match: (group: string, bankId?: string, units?: number) =>
    ['match', group, bankId ?? null, units ?? 1] as const,

  bankSearch: (params: unknown) => ['banks', 'search', params] as const,

  adminMetrics: ['admin', 'metrics'] as const,
  adminPending: (page: number) => ['admin', 'pending', page] as const,
  adminLogs: (params: unknown) => ['admin', 'logs', params] as const,
};
