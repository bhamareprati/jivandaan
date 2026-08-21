import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:5000';

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    /**
     * Pre-bundle the 3D stack.
     *
     * Unlisted, Vite discovers `three` and drei only when the lazy hero chunk
     * is first requested, then stops to optimise them -- so the scene's own
     * load waits on a dependency scan of a few thousand modules. Naming them
     * here moves that work to server start, where it costs nothing the user
     * sees. drei is the expensive one: it re-exports far more than we import.
     */
    optimizeDeps: {
      include: ['three', '@react-three/fiber', '@react-three/drei'],
    },
    server: {
      port: 5173,
      /**
       * Proxy /api to the backend so development is SAME-ORIGIN.
       *
       * This is a security decision, not a convenience one: same-origin means
       * the session cookie stays SameSite=Lax (which blocks cross-site writes
       * outright) and no CORS relaxation is needed anywhere.
       */
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: false,
          secure: false,
        },
      },
    },
    build: {
      target: 'es2020',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            // The 3D scene is lazy-loaded; keep it out of the entry chunk so it
            // can never block the landing page's first paint.
            three: ['three', '@react-three/fiber', '@react-three/drei'],
            charts: ['recharts'],
            map: ['leaflet', 'react-leaflet'],
            scanner: ['@zxing/browser', '@zxing/library'],
          },
        },
      },
    },
  };
});
