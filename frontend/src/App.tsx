import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { Loader2 } from 'lucide-react';

import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/hooks/useAuth';
import { RequireAuth } from '@/routes/guards';
import { PageTransition } from '@/components/motion';

import { LandingPage } from '@/features/landing/LandingPage';
import { AuthPage } from '@/features/auth/AuthPage';
import { prefetchHeroScene } from '@/components/three/HeroCanvas';

/**
 * Route-level code splitting.
 *
 * The map, the charts and the QR scanner are each heavy and each used by one
 * role, so nobody downloads a console they will never open.
 */
const DonorDashboard = lazy(() =>
  import('@/features/donor/DonorDashboard').then((m) => ({ default: m.DonorDashboard }))
);
const DonorPassPage = lazy(() =>
  import('@/features/donor/DonorPassPage').then((m) => ({ default: m.DonorPassPage }))
);
const BankDashboard = lazy(() =>
  import('@/features/bank/BankDashboard').then((m) => ({ default: m.BankDashboard }))
);
const RequestQueue = lazy(() =>
  import('@/features/bank/RequestQueue').then((m) => ({ default: m.RequestQueue }))
);
const CheckinPage = lazy(() =>
  import('@/features/bank/CheckinPage').then((m) => ({ default: m.CheckinPage }))
);
const NewRequestPage = lazy(() =>
  import('@/features/request/NewRequestPage').then((m) => ({ default: m.NewRequestPage }))
);
const TrackRequestPage = lazy(() =>
  import('@/features/request/TrackRequestPage').then((m) => ({ default: m.TrackRequestPage }))
);
const MyRequestsPage = lazy(() =>
  import('@/features/request/MyRequestsPage').then((m) => ({ default: m.MyRequestsPage }))
);
const SearchPage = lazy(() =>
  import('@/features/search/SearchPage').then((m) => ({ default: m.SearchPage }))
);
const AdminDashboard = lazy(() =>
  import('@/features/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const VerificationQueue = lazy(() =>
  import('@/features/admin/VerificationQueue').then((m) => ({ default: m.VerificationQueue }))
);
const AuditLogPage = lazy(() =>
  import('@/features/admin/AuditLogPage').then((m) => ({ default: m.AuditLogPage }))
);

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-crimson" aria-label="Loading" />
    </div>
  );
}

/**
 * Start the hero's 3D chunk from the entry module.
 *
 * The landing route is itself code-split, so without this the ~1MB three.js
 * chunk could not even begin downloading until the route chunk had landed and
 * mounted -- two round trips in series. This makes them concurrent. It is a
 * no-op on devices that fail the capability test.
 */
prefetchHeroScene();

function AppRoutes() {
  const location = useLocation();

  return (
    <Suspense fallback={<RouteFallback />}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          {/* ------------------------------------------------------ public */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth/login" element={<AuthPage mode="login" />} />
          <Route path="/auth/register" element={<AuthPage mode="register" />} />

          {/* ------------------------------------------------------- donor */}
          <Route
            path="/donor/dashboard"
            element={
              <RequireAuth roles={['donor']}>
                <PageTransition><DonorDashboard /></PageTransition>
              </RequireAuth>
            }
          />
          <Route
            path="/donor/pass"
            element={
              <RequireAuth roles={['donor']}>
                <PageTransition><DonorPassPage /></PageTransition>
              </RequireAuth>
            }
          />

          {/* -------------------------------------------------- blood bank */}
          <Route
            path="/bank/dashboard"
            element={
              <RequireAuth roles={['blood-bank']}>
                <PageTransition><BankDashboard /></PageTransition>
              </RequireAuth>
            }
          />
          <Route
            path="/bank/requests"
            element={
              <RequireAuth roles={['blood-bank', 'admin']}>
                <PageTransition><RequestQueue /></PageTransition>
              </RequireAuth>
            }
          />
          <Route
            path="/bank/checkin"
            element={
              <RequireAuth roles={['blood-bank']}>
                <PageTransition><CheckinPage /></PageTransition>
              </RequireAuth>
            }
          />

          {/* ----------------------------------------------------- request */}
          <Route
            path="/request/new"
            element={
              <RequireAuth roles={['donor', 'hospital']}>
                <PageTransition><NewRequestPage /></PageTransition>
              </RequireAuth>
            }
          />
          <Route
            path="/request/:id/track"
            element={
              <RequireAuth>
                <PageTransition><TrackRequestPage /></PageTransition>
              </RequireAuth>
            }
          />
          <Route
            path="/requests"
            element={
              <RequireAuth roles={['donor', 'hospital']}>
                <PageTransition><MyRequestsPage /></PageTransition>
              </RequireAuth>
            }
          />

          {/* ------------------------------------------------------ search */}
          <Route
            path="/search"
            element={
              <RequireAuth>
                <PageTransition><SearchPage /></PageTransition>
              </RequireAuth>
            }
          />

          {/* ------------------------------------------------------- admin */}
          <Route
            path="/admin/dashboard"
            element={
              <RequireAuth roles={['admin']}>
                <PageTransition><AdminDashboard /></PageTransition>
              </RequireAuth>
            }
          />
          <Route
            path="/admin/verification"
            element={
              <RequireAuth roles={['admin']}>
                <PageTransition><VerificationQueue /></PageTransition>
              </RequireAuth>
            }
          />
          <Route
            path="/admin/logs"
            element={
              <RequireAuth roles={['admin']}>
                <PageTransition><AuditLogPage /></PageTransition>
              </RequireAuth>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/*
        reducedMotion="user" makes every Framer Motion animation in the tree
        honour prefers-reduced-motion without each component checking.
      */}
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <AuthProvider>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-pill focus:bg-crimson-ink focus:px-4 focus:py-2 focus:text-white"
            >
              Skip to content
            </a>
            <div id="main">
              <AppRoutes />
            </div>
            <Toaster
              position="top-right"
              closeButton
              toastOptions={{
                // Toasts are one of the four sanctioned glass surfaces.
                className: 'glass !rounded-card !border !font-body',
                style: { color: 'rgb(var(--ink))' },
              }}
            />
          </AuthProvider>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  );
}
