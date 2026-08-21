import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PulseRing } from '@/components/motion';
import { urgencyStyle } from '@/lib/domain';
import type { BloodGroup, Urgency } from '@/types/api';

/* ---------------------------------------------------------------- cards */

/**
 * GLASS. Floating surfaces only (Doc 1 section 2.4): modals, the sticky nav
 * once scrolled, toasts, and the landing hero's floating panel.
 *
 * If you are reaching for this for an ordinary dashboard card, you want
 * <Surface> instead. Glass on every card is precisely what makes glassmorphism
 * look cheap, and it is the single easiest rule in this design system to break.
 */
export function GlassCard({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'aside';
}) {
  return <Tag className={cn('glass rounded-card', className)}>{children}</Tag>;
}

/** The default card: solid, opaque, subtle border. Use this one. */
export function Surface({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={cn('surface', padded && 'p-5', className)}>{children}</div>;
}

export function SectionHeading({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-end justify-between gap-4', className)}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="muted mt-0.5 text-sm">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------- buttons */

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'success' | 'outline' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // crimson.ink, not crimson: white-on-#C1121F is 6.22:1, white-on-#E63946 is 4.17:1.
  primary: 'bg-crimson-ink text-white hover:bg-crimson shadow-crimson hover:shadow-lg border-transparent',
  danger: 'bg-flare text-white hover:brightness-110 border-transparent',
  success: 'bg-emerald-ink text-white hover:bg-emerald border-transparent',
  outline:
    'bg-transparent text-crimson-ink dark:text-crimson-light border-crimson/40 hover:bg-crimson/10',
  ghost:
    'bg-transparent text-[rgb(var(--ink))] border-transparent hover:bg-[rgb(var(--line))]',
  subtle:
    'bg-[rgb(var(--line))] text-[rgb(var(--ink))] border-transparent hover:brightness-95 dark:hover:brightness-125',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-13 px-7 text-base gap-2.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-pill border font-display font-semibold',
        // Micro-interaction: hover elevation, haptic-style press (Doc 1 s2.3).
        'transition-all duration-150 active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* --------------------------------------------------------------- inputs */

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

/** Wraps a control with its label, hint and error, wired via aria-describedby. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span className="ml-1 text-crimson-ink dark:text-crimson-light" aria-hidden>
            *
          </span>
        )}
      </label>
      {children(id, describedBy)}
      {hint && !error && (
        <p id={`${id}-hint`} className="muted text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-center gap-1.5 text-xs font-medium text-crimson-ink dark:text-crimson-light"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-xl border border-[rgb(var(--line))] bg-[rgb(var(--surface))] px-3.5 py-2.5 text-sm ' +
  'placeholder:text-[rgb(var(--ink-muted))] transition-colors ' +
  'focus:border-crimson focus:outline-none disabled:opacity-60 aria-[invalid=true]:border-flare';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(CONTROL_BASE, className)} {...rest} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(CONTROL_BASE, 'pr-8', className)} {...rest}>
        {children}
      </select>
    );
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(CONTROL_BASE, 'min-h-24 resize-y', className)} {...rest} />;
  }
);

/* ---------------------------------------------------------------- chips */

/**
 * A blood group. The group is always rendered as text, never encoded in colour
 * alone -- Doc 4's accessibility pass requires that.
 */
export function BloodGroupChip({
  group,
  size = 'md',
  selected,
  muted,
  className,
}: {
  group: BloodGroup;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const sizes = {
    sm: 'h-6 min-w-[2.25rem] text-xs px-1.5',
    md: 'h-8 min-w-[2.75rem] text-sm px-2',
    lg: 'h-11 min-w-[3.5rem] text-base px-3',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-lg border font-display font-bold tabular tracking-tight',
        sizes[size],
        muted
          ? 'border-[rgb(var(--line))] bg-[rgb(var(--line))] text-[rgb(var(--ink-muted))]'
          : selected
            ? 'border-crimson-ink bg-crimson-ink text-white'
            : 'border-crimson/30 bg-crimson/10 text-crimson-ink dark:text-crimson-light',
        className
      )}
    >
      {group}
    </span>
  );
}

/**
 * Urgency badge. Critical pulses; nothing else does (Doc 1 section 3,
 * Doc 4 section 4.2).
 */
export function UrgencyBadge({
  urgency,
  size = 'md',
  className,
}: {
  urgency: Urgency;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const style = urgencyStyle(urgency);
  const isCritical = urgency === 'critical';

  return (
    <span
      className={cn(
        'relative isolate inline-flex items-center gap-1.5 rounded-pill border font-display font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        style.chip,
        className
      )}
    >
      {isCritical && <PulseRing color={style.ring} />}
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} aria-hidden />
      {style.label}
    </span>
  );
}

export function StatusPill({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill border px-2.5 py-1 text-xs font-semibold',
        className
      )}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------- feedback */

/** Skeletons, not spinners, for async data (Doc 1 section 2.3). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Surface>
      <Skeleton className="mb-3 h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('mb-2 h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </Surface>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed',
        'border-[rgb(var(--line))] px-6 py-12 text-center',
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-pill bg-[rgb(var(--line))] text-[rgb(var(--ink-muted))]">
          {icon}
        </div>
      )}
      <p className="font-display text-base font-semibold">{title}</p>
      {description && <p className="muted mt-1 max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-flare/30',
        'bg-flare/5 px-6 py-10 text-center',
        className
      )}
    >
      <AlertCircle className="mb-3 h-8 w-8 text-flare" aria-hidden />
      <p className="font-display text-base font-semibold">{title}</p>
      {description && <p className="muted mt-1 max-w-md text-sm">{description}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Small labelled statistic, used across dashboards. */
export function StatTile({
  label,
  value,
  sub,
  icon,
  accent,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: ReactNode;
  accent?: 'crimson' | 'emerald' | 'amber' | 'neutral';
  className?: string;
}) {
  const accents = {
    crimson: 'text-crimson-ink dark:text-crimson-light',
    emerald: 'text-emerald-ink dark:text-emerald-light',
    amber: 'text-amber-ink dark:text-amber',
    neutral: 'text-[rgb(var(--ink))]',
  };
  return (
    <Surface className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <span className="muted text-xs font-medium uppercase tracking-wide">{label}</span>
        {icon && <span className="muted">{icon}</span>}
      </div>
      <span className={cn('font-display text-xl font-bold', accents[accent ?? 'neutral'])}>
        {value}
      </span>
      {sub && <span className="muted text-xs">{sub}</span>}
    </Surface>
  );
}
