import { useEffect, useState } from 'react';

/**
 * Whether the viewer has asked for reduced motion.
 *
 * Doc 4 section 4.2 requires this to genuinely disable the 3D auto-rotation,
 * the urgency pulse and the count-ups -- not merely soften them. Framer Motion
 * is covered by <MotionConfig reducedMotion="user"> and CSS by a media query;
 * this hook is for the JS-driven cases (Three.js, count-up arithmetic).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Whether this device should attempt the 3D hero at all.
 *
 * Three independent kill switches, per the plan's F1 spec: reduced motion, a
 * small viewport, and a low-core device. Any one of them falls back to the
 * static gradient-mesh poster.
 */
/**
 * The capability test, readable synchronously.
 *
 * Exported because the answer is needed before React renders: it decides
 * whether the 3D chunk is worth prefetching at all.
 */
export function canRender3DNow(): boolean {
  if (typeof window === 'undefined') return false;
  const wideEnough = window.innerWidth >= 768;
  const enoughCores = (navigator.hardwareConcurrency ?? 8) > 4;
  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return wideEnough && enoughCores && !saveData;
}

/**
 * Whether this device should attempt the 3D hero at all.
 *
 * Three independent kill switches, per the plan's F1 spec: reduced motion, a
 * small viewport, and a low-core device. Any one of them falls back to the
 * static gradient-mesh poster.
 *
 * The initial value is computed synchronously rather than defaulting to false
 * and correcting in an effect. Starting false meant the scene was not rendered
 * on the first pass, so React.lazy did not begin fetching the 3D chunk until
 * after mount and effects -- putting a ~1MB download *behind* the route chunk
 * instead of alongside it, and leaving a visible second of empty hero. There is
 * no SSR here, so there is no hydration mismatch to avoid.
 */
export function useCanRender3D(): boolean {
  const reduced = useReducedMotion();
  const [capable, setCapable] = useState(canRender3DNow);

  useEffect(() => {
    const evaluate = () => setCapable(canRender3DNow());
    window.addEventListener('resize', evaluate);
    return () => window.removeEventListener('resize', evaluate);
  }, []);

  return capable && !reduced;
}
