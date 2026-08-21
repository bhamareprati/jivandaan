import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/useMotionPrefs';
import { cn } from '@/lib/cn';
import { STOCK_COLOURS, STOCK_LABELS, stockLevel } from '@/lib/domain';
import { CountUp } from '@/components/motion';
import type { BloodGroup } from '@/types/api';

/**
 * Animated SVG progress ring.
 *
 * Doc 1 section 2.3 is explicit: stroke-dashoffset animation, NOT a chart
 * library. Recharts is reserved for the admin analytics; a stock gauge built
 * from a chart component would be both heavier and less controllable.
 *
 * Animates on mount AND on change, so a live stock update visibly moves.
 */
export function ProgressRing({
  progress,
  size = 96,
  stroke = 8,
  colour,
  trackClassName,
  children,
  className,
  label,
}: {
  /** 0..1 */
  progress: number;
  size?: number;
  stroke?: number;
  colour: string;
  trackClassName?: string;
  children?: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const reduced = useReducedMotion();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const [drawn, setDrawn] = useState(reduced ? progress : 0);
  const raf = useRef<number>();
  const from = useRef(0);

  useEffect(() => {
    if (reduced) {
      setDrawn(progress);
      from.current = progress;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const delta = progress - origin;
    const duration = 850;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDrawn(origin + delta * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = progress;
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      from.current = progress;
    };
  }, [progress, reduced]);

  const offset = circumference * (1 - Math.max(0, Math.min(1, drawn)));

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role={label ? 'img' : 'presentation'}
        aria-label={label}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={cn('stroke-[rgb(var(--line))]', trackClassName)}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
      )}
    </div>
  );
}

/**
 * One blood group's stock, as a ring.
 *
 * `capacity` scales the arc. There is no true maximum, so the ring is drawn
 * against twice the low-stock threshold: a full ring reads as "comfortably
 * stocked" rather than implying a hard ceiling that does not exist.
 */
export function StockLevelRing({
  group,
  units,
  threshold,
  expiringSoon = 0,
  size = 104,
}: {
  group: BloodGroup;
  units: number;
  threshold: number;
  expiringSoon?: number;
  size?: number;
}) {
  const level = stockLevel(units, threshold);
  const capacity = Math.max(threshold * 2, 1);
  const progress = Math.min(1, units / capacity);

  return (
    <div className="flex flex-col items-center gap-2">
      <ProgressRing
        progress={progress}
        size={size}
        stroke={9}
        colour={STOCK_COLOURS[level]}
        label={`${group}: ${units} units, ${STOCK_LABELS[level]}`}
      >
        <span className="font-display text-lg font-bold" data-stat>
          <CountUp value={units} />
        </span>
        <span className="muted text-xs font-medium">units</span>
      </ProgressRing>

      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-sm font-bold tabular">{group}</span>
        {/* State is stated in words, never colour alone. */}
        <span
          className={cn(
            'rounded-pill px-2 py-0.5 text-[11px] font-semibold',
            level === 'empty' && 'bg-flare/12 text-flare',
            level === 'low' && 'bg-amber/20 text-amber-ink dark:text-amber',
            level === 'healthy' && 'bg-emerald-ink/10 text-emerald-ink dark:text-emerald-light'
          )}
        >
          {STOCK_LABELS[level]}
        </span>
        {expiringSoon > 0 && (
          <span className="text-[11px] font-medium text-amber-ink dark:text-amber">
            {expiringSoon} expiring
          </span>
        )}
      </div>
    </div>
  );
}
