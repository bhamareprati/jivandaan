import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/domain';
import type { Stepper } from '@/types/api';

/**
 * The live request tracker (Doc 1 section 3).
 *
 * Submitted -> Review -> Approved -> Dispatched -> Fulfilled, driven entirely
 * by the server's `stepper` payload so each completed step shows the real time
 * it happened rather than a guess.
 *
 * A rejected or cancelled request BRANCHES OFF the line rather than continuing
 * along it -- showing "Rejected" as step 3 of 5 would imply it is still moving.
 */
export function StatusStepper({
  stepper,
  orientation = 'horizontal',
}: {
  stepper: Stepper;
  orientation?: 'horizontal' | 'vertical';
}) {
  const { steps, derailed, derailedAs, currentIndex } = stepper;
  const vertical = orientation === 'vertical';

  return (
    <div className={cn(vertical ? 'flex flex-col' : 'w-full')}>
      <ol
        className={cn(
          vertical ? 'flex flex-col gap-0' : 'flex items-start justify-between gap-1',
          derailed && 'opacity-60'
        )}
      >
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const done = step.complete;
          const active = step.current && !derailed;

          return (
            <li
              key={step.status}
              className={cn(
                'relative',
                vertical ? 'flex gap-3 pb-6 last:pb-0' : 'flex flex-1 flex-col items-center'
              )}
            >
              {/* Connector */}
              {!isLast && (
                <span
                  className={cn(
                    'absolute bg-[rgb(var(--line))]',
                    vertical
                      ? 'left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5'
                      : 'left-1/2 top-[13px] h-0.5 w-full'
                  )}
                  aria-hidden
                >
                  <motion.span
                    className="block h-full w-full origin-left bg-emerald-ink"
                    initial={{ scaleX: 0, scaleY: 0 }}
                    animate={
                      vertical
                        ? { scaleY: done ? 1 : 0, scaleX: 1 }
                        : { scaleX: done ? 1 : 0, scaleY: 1 }
                    }
                    style={{ originY: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: i * 0.08 }}
                  />
                </span>
              )}

              {/* Node */}
              <span className={cn('relative z-10', vertical ? 'shrink-0' : '')}>
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.08, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-pill border-2 text-xs font-bold',
                    done && 'border-emerald-ink bg-emerald-ink text-white',
                    active && 'border-crimson-ink bg-crimson-ink text-white',
                    !done && !active &&
                      'border-[rgb(var(--line))] bg-[rgb(var(--surface))] text-[rgb(var(--ink-muted))]'
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                </motion.span>

                {/* The active step pulses. Nothing else does. */}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-0 -z-10 animate-pulse-ring rounded-pill bg-crimson"
                  />
                )}
              </span>

              {/* Label */}
              <span className={cn(vertical ? 'flex flex-col pt-0.5' : 'mt-2 flex flex-col items-center text-center')}>
                <span
                  className={cn(
                    'font-display text-xs font-semibold',
                    (done || active) ? 'text-[rgb(var(--ink))]' : 'muted'
                  )}
                >
                  {step.label}
                </span>
                <span className="muted mt-0.5 text-[11px] tabular">
                  {step.at ? formatDateTime(step.at) : '-'}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {derailed && derailedAs && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-center gap-2 rounded-card border border-flare/30 bg-flare/5 px-4 py-3"
          role="status"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-flare text-white">
            <X className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="text-sm font-medium">
            This request was <strong>{derailedAs}</strong> after{' '}
            {currentIndex >= 0 ? steps[Math.max(0, currentIndex)]?.label : steps[0].label}.
          </span>
        </motion.div>
      )}
    </div>
  );
}
