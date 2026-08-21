import type { Config } from 'tailwindcss';

/**
 * Jivandan design system (Document 1 section 2).
 *
 * Every colour and every type size a component may use lives here. Nothing in
 * the app is allowed to hard-code a hex value or an off-scale font size.
 *
 * Note the `ink` variants: Vitality Crimson #E63946 measures 4.17:1 on white,
 * which fails WCAG AA for body text (needs 4.5:1). The brand colour is kept for
 * large text, icons, borders and fills; `crimson.ink` (#C1121F, 6.22:1) carries
 * body text and any fill that has a white label on it. Same reasoning for
 * emerald. See docs/IMPLEMENTATION_PLAN.md appendix A5 for the measurements.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        crimson: {
          DEFAULT: '#E63946',
          ink: '#C1121F',
          light: '#FF6B6B', // 6.43:1 on navy -- crimson text in dark mode
          50: '#FEF2F3',
          100: '#FDE3E5',
          900: '#7A1119',
        },
        burgundy: {
          DEFAULT: '#800020',
          light: '#A8143A',
        },
        flare: '#D90429',
        amber: {
          DEFAULT: '#FFB703',
          ink: '#8A5B00',
        },
        emerald: {
          DEFAULT: '#2A9D8F',
          ink: '#1F7A6F',
          light: '#5FC7B8',
        },
        navy: {
          DEFAULT: '#0F172A',
          800: '#16203A',
          700: '#1E2A47',
          600: '#2A3757',
        },
        glass: 'rgba(255,255,255,.85)',
      },
      fontFamily: {
        display: ['Outfit', 'Sora', 'Space Grotesk', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      // Document 1 section 2.2 -- the only sizes any component may use.
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['20px', { lineHeight: '28px' }],
        xl: ['28px', { lineHeight: '34px', letterSpacing: '-0.01em' }],
        '2xl': ['40px', { lineHeight: '46px', letterSpacing: '-0.02em' }],
        '3xl': ['56px', { lineHeight: '60px', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        card: '16px', // Document 1 phase F1 -- the card standard
        pill: '999px',
      },
      boxShadow: {
        // Layered, never a hard drop shadow (Document 1 section 2.4).
        soft: '0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.06)',
        raised: '0 1px 2px rgba(15,23,42,.05), 0 8px 24px rgba(15,23,42,.08), 0 24px 48px rgba(15,23,42,.06)',
        glass: '0 1px 2px rgba(15,23,42,.04), 0 8px 24px rgba(15,23,42,.10), 0 24px 64px rgba(15,23,42,.12)',
        crimson: '0 4px 16px rgba(230,57,70,.28)',
        'dark-raised': '0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(.85)', opacity: '.7' },
          '70%': { transform: 'scale(1.7)', opacity: '0' },
          '100%': { transform: 'scale(1.7)', opacity: '0' },
        },
        'mesh-drift': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(2%, -3%, 0) scale(1.06)' },
        },
        /* A heart does not pulse on a sine wave. It snaps and recoils twice --
           `lub` is systole, `dub` the smaller second sound as the valves close
           -- and then rests. Diastole is most of the cycle, and that long flat
           stretch is what makes a beat read as alive rather than as a throb. */
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        shimmer: {
          from: { backgroundPosition: '-200% 0' },
          to: { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'mesh-drift': 'mesh-drift 24s ease-in-out infinite',
        marquee: 'marquee 40s linear infinite',
        shimmer: 'shimmer 1.6s linear infinite',
      },
      transitionTimingFunction: {
        entrance: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
