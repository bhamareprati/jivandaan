import { Component, Suspense, lazy, type ReactNode } from 'react';
import { canRender3DNow, useCanRender3D } from '@/hooks/useMotionPrefs';
import { cn } from '@/lib/cn';

/**
 * Gate + lazy loader for the 3D hero.
 *
 * The scene is code-split, so `three`, `@react-three/fiber` and `drei` are
 * never in the entry chunk. It only mounts when useCanRender3D() agrees:
 * reduced motion off, viewport >= 768px, more than 4 cores, data-saver off.
 * Everyone else gets the poster, which is a real design in its own right
 * rather than an apology.
 */

const importScene = () => import('./BloodDropScene');
const BloodDropScene = lazy(importScene);

/**
 * Warm the chunk as soon as this module is evaluated.
 *
 * Rendering it is still gated, but *fetching* it does not have to be: by the
 * time React decides, the bytes are already on their way. Guarded by the same
 * capability test so the devices the gate protects never pay for the download.
 */
export function prefetchHeroScene() {
  if (canRender3DNow()) void importScene();
}
prefetchHeroScene();

/** The animated gradient-mesh backdrop. Also the fallback in its own right. */
export function HeroPoster({ className }: { className?: string }) {
  return (
    <div className={cn('absolute inset-0 overflow-hidden', className)} aria-hidden>
      <div className="mesh-backdrop absolute inset-[-20%] animate-mesh-drift opacity-90" />
      {/* A flat drop silhouette so the composition still has a focal point. */}
      <svg
        viewBox="0 0 200 260"
        className="absolute left-1/2 top-1/2 h-[62%] -translate-x-1/2 -translate-y-1/2 opacity-[0.22]"
      >
        <defs>
          <linearGradient id="dropFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E63946" />
            <stop offset="100%" stopColor="#800020" />
          </linearGradient>
        </defs>
        <path
          d="M100 6 C100 6 22 108 22 164 a78 78 0 0 0 156 0 C178 108 100 6 100 6 Z"
          fill="url(#dropFill)"
        />
      </svg>
    </div>
  );
}

/**
 * Keeps a failing hero decorative.
 *
 * Anything thrown inside the Canvas -- a lost WebGL context, a driver that
 * cannot compile the transmission shader, an asset a CSP blocks -- otherwise
 * unmounts the whole route, and the landing page renders as an empty #root.
 * The poster below is a complete design on its own, so the fallback here is
 * `null`: drop the canvas and let the poster stand.
 */
class Hero3DBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) console.warn('[hero] 3D scene disabled after error:', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function HeroCanvas({ className }: { className?: string }) {
  const can3D = useCanRender3D();

  return (
    <div className={cn('absolute inset-0', className)}>
      {/* The poster always renders: it is the gradient the glass panels blur,
          and it covers the 3D chunk's load time without a layout shift. */}
      <HeroPoster />

      {can3D && (
        <Hero3DBoundary>
          <Suspense fallback={null}>
            <div className="absolute inset-0">
              <BloodDropScene />
            </div>
          </Suspense>
        </Hero3DBoundary>
      )}
    </div>
  );
}
