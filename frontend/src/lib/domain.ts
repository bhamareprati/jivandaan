import type { BloodGroup, RequestStatus, Urgency, VerificationStatus } from '@/types/api';

/**
 * Presentation rules for the domain vocabulary.
 *
 * Colour is never the only carrier of meaning here -- every helper also returns
 * a label, because Doc 4's accessibility pass requires blood group and urgency
 * to be readable without seeing colour.
 */

export const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/* -------------------------------------------------------------- urgency */

export const URGENCY_ORDER: Record<Urgency, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface UrgencyStyle {
  label: string;
  /** Solid fill + readable label. Emergency Flare carries white text at 5.25:1. */
  chip: string;
  dot: string;
  ring: string;
  column: string;
}

export const URGENCY_STYLES: Record<Urgency, UrgencyStyle> = {
  critical: {
    label: 'Critical',
    chip: 'bg-flare text-white border-flare',
    dot: 'bg-white',
    ring: 'bg-flare',
    column: 'border-flare/40 bg-flare/[0.04]',
  },
  high: {
    label: 'High',
    chip: 'bg-crimson-ink text-white border-crimson-ink',
    dot: 'bg-white',
    ring: 'bg-crimson',
    column: 'border-crimson/30 bg-crimson/[0.03]',
  },
  medium: {
    // Amber is a fill colour only -- 1.75:1 on white. Navy text on it is 10.2:1.
    label: 'Medium',
    chip: 'bg-amber text-navy border-amber',
    dot: 'bg-navy',
    ring: 'bg-amber',
    column: 'border-amber/40 bg-amber/[0.06]',
  },
  low: {
    label: 'Low',
    chip: 'bg-emerald-ink text-white border-emerald-ink',
    dot: 'bg-white',
    ring: 'bg-emerald',
    column: 'border-emerald/30 bg-emerald/[0.04]',
  },
};

export const urgencyStyle = (u: Urgency) => URGENCY_STYLES[u] ?? URGENCY_STYLES.low;

/* --------------------------------------------------------------- status */

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Submitted',
  under_review: 'Review',
  approved: 'Approved',
  dispatched: 'Dispatched',
  fulfilled: 'Fulfilled',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const STATUS_FLOW: RequestStatus[] = [
  'pending',
  'under_review',
  'approved',
  'dispatched',
  'fulfilled',
];

export const TERMINAL_STATUSES: RequestStatus[] = ['fulfilled', 'rejected', 'cancelled'];

export const isTerminal = (s: RequestStatus) => TERMINAL_STATUSES.includes(s);

export function statusStyle(s: RequestStatus) {
  switch (s) {
    case 'fulfilled':
      return 'bg-emerald-ink/10 text-emerald-ink border-emerald-ink/30 dark:text-emerald-light';
    case 'rejected':
    case 'cancelled':
      return 'bg-crimson-ink/10 text-crimson-ink border-crimson-ink/30 dark:text-crimson-light';
    case 'dispatched':
      return 'bg-crimson/10 text-crimson-ink border-crimson/30 dark:text-crimson-light';
    case 'approved':
      return 'bg-amber/15 text-amber-ink border-amber/40 dark:text-amber';
    default:
      return 'bg-[rgb(var(--line))] text-[rgb(var(--ink-muted))] border-[rgb(var(--line))]';
  }
}

/** The action label a bank sees for each legal next move. */
export const STATUS_ACTION_LABELS: Record<RequestStatus, string> = {
  pending: 'Reopen',
  under_review: 'Start review',
  approved: 'Approve',
  dispatched: 'Mark dispatched',
  fulfilled: 'Mark fulfilled',
  rejected: 'Reject',
  cancelled: 'Cancel request',
};

/* --------------------------------------------------------- verification */

export function verificationStyle(v: VerificationStatus) {
  switch (v) {
    case 'verified':
      return { label: 'Verified', cls: 'bg-emerald-ink/10 text-emerald-ink border-emerald-ink/30 dark:text-emerald-light' };
    case 'rejected':
      return { label: 'Rejected', cls: 'bg-crimson-ink/10 text-crimson-ink border-crimson-ink/30 dark:text-crimson-light' };
    default:
      return { label: 'Pending', cls: 'bg-amber/15 text-amber-ink border-amber/40 dark:text-amber' };
  }
}

/* ------------------------------------------------------------- stock UI */

export type StockLevel = 'empty' | 'low' | 'healthy';

export function stockLevel(units: number, threshold: number): StockLevel {
  if (units <= 0) return 'empty';
  if (units < threshold) return 'low';
  return 'healthy';
}

/** SVG stroke colours for the animated rings -- resolved from the palette. */
export const STOCK_COLOURS: Record<StockLevel, string> = {
  empty: '#D90429',
  low: '#FFB703',
  healthy: '#2A9D8F',
};

export const STOCK_LABELS: Record<StockLevel, string> = {
  empty: 'Out of stock',
  low: 'Low stock',
  healthy: 'Healthy',
};

/* ------------------------------------------------------------ formatting */

export function formatDistance(metres: number | null): string {
  if (metres === null || Number.isNaN(metres)) return '-';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

/** "3 minutes ago", for feeds and queues. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The radius stops Doc 1 section 3 specifies, in metres. */
export const RADIUS_STOPS = [5000, 10000, 25000] as const;
