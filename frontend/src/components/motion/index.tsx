import { motion, useInView, type Variants } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '@/hooks/useMotionPrefs';
import { cn } from '@/lib/cn';

/**
 * Motion primitives (Doc 1 section 2.3).
 *
 * Every one of these degrades to "no animation, final state" under
 * prefers-reduced-motion. <MotionConfig reducedMotion="user"> in App.tsx covers
 * Framer's own transitions; CountUp needs explicit handling because its
 * animation is arithmetic rather than a transform.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Staggered entrance for dashboard card grids and feed lists. */
export function StaggerList({
  children,
  className,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  once?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, margin: '-40px' });

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={staggerParent}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={fadeUp} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * Count-up for stats (Doc 1 section 2.3).
 *
 * Doc 4 section 4.2: must animate on first mount and NOT re-trigger on
 * unrelated re-renders. The effect keys on `value` alone, and a ref remembers
 * where the last animation finished, so a live update counts from the previous
 * number rather than restarting from zero.
 */
export function CountUp({
  value,
  duration = 900,
  decimals = 0,
  suffix = '',
  prefix = '',
  className,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const from = useRef(0);
  const frame = useRef<number>();

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      from.current = value;
      return;
    }

    const start = performance.now();
    const origin = from.current;
    const delta = value - origin;

    if (delta === 0) {
      setDisplay(value);
      return;
    }

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo -- fast then settling, which reads as "counting up".
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setDisplay(origin + delta * eased);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        from.current = value;
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      from.current = value;
    };
  }, [value, duration, reduced]);

  const shown = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString('en-IN');

  return (
    <span className={cn('tabular', className)} data-stat>
      {prefix}
      {shown}
      {suffix}
    </span>
  );
}

/**
 * The radiating ring behind a Critical badge (Doc 1 section 2.3).
 *
 * CSS keyframes rather than Framer, so the reduced-motion media query in
 * globals.css switches it off without any JS involvement.
 */
export function PulseRing({ className, color = 'bg-flare' }: { className?: string; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 -z-10', className)}
    >
      <span className={cn('absolute inset-0 rounded-pill opacity-70 animate-pulse-ring', color)} />
    </span>
  );
}

/** Page transitions. */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export { motion };
