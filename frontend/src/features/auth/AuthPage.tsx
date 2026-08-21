import { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Droplet, Hospital, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { Button, Field, GlassCard, Input, Select } from '@/components/ui';
import { HeroPoster } from '@/components/three/HeroCanvas';
import { Wordmark } from '@/components/layout/AppShell';
import { BLOOD_GROUPS } from '@/lib/domain';
import { cn } from '@/lib/cn';
import { homeFor } from '@/routes/paths';
import type { Role } from '@/types/api';

/**
 * Role-aware auth (Doc 1 section 3).
 *
 * The role switcher is not decoration: the backend needs `role` on login to
 * know which identity collection to authenticate against, because each one has
 * its own unique index on email (contract section 4.2). It also drives which
 * registration fields are shown.
 */

const ROLE_TABS: { role: Role; label: string; icon: typeof Droplet; blurb: string }[] = [
  { role: 'donor', label: 'Donor', icon: Droplet, blurb: 'Give blood, track eligibility' },
  { role: 'blood-bank', label: 'Blood Bank', icon: Building2, blurb: 'Manage stock and requests' },
  { role: 'hospital', label: 'Hospital', icon: Hospital, blurb: 'Raise emergency requests' },
  { role: 'admin', label: 'Admin', icon: ShieldCheck, blurb: 'Platform oversight' },
];

/* ------------------------------------------------------------- schemas */

// Mirrors the backend's Zod rules so the user gets feedback before a round
// trip. The server validates independently -- this is UX, not security.
const email = z.string().trim().min(1, 'Email is required').email('Enter a valid email address');
const password = z.string().min(8, 'Must be at least 8 characters');
const contact = z
  .string()
  .trim()
  .min(7, 'Enter a valid contact number')
  .regex(/^[+0-9\s\-()]+$/, 'Digits and + - ( ) only');

const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required') });

const donorSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name'),
  email,
  password,
  contact,
  dob: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']),
  bloodgroup: z.enum(BLOOD_GROUPS as [string, ...string[]]),
  city: z.string().trim().optional(),
});

const orgSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email,
  password,
  contact,
  address: z.string().trim().min(4, 'Address is required'),
  city: z.string().trim().min(2, 'City is required'),
  state: z.string().trim().min(2, 'State is required'),
  pincode: z.string().trim().regex(/^[0-9]{4,10}$/, 'Enter 4-10 digits'),
  licenseNumber: z.string().trim().optional(),
  registrationNumber: z.string().trim().optional(),
});

type LoginValues = z.infer<typeof loginSchema>;
type DonorValues = z.infer<typeof donorSchema>;
type OrgValues = z.infer<typeof orgSchema>;

/* ---------------------------------------------------------------- page */

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [role, setRole] = useState<Role>('donor');
  const { user, role: currentRole, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return null;
  if (user && currentRole) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? homeFor(currentRole)} replace />;
  }

  const isRegister = mode === 'register';
  // Admin accounts are seeded, never self-registered (contract section 4.2).
  const tabs = isRegister ? ROLE_TABS.filter((t) => t.role !== 'admin') : ROLE_TABS;
  const active = tabs.some((t) => t.role === role) ? role : 'donor';

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Glass needs a rich backdrop or the blur has nothing to blur
          (Doc 1 section 2.4). */}
      <HeroPoster />
      <div className="absolute inset-0 bg-navy/72" aria-hidden />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-10">
        <div className="mb-6 [&_*]:text-white">
          <Wordmark />
        </div>

        <GlassCard className="w-full max-w-lg p-6 sm:p-8">
          <h1 className="font-display text-xl font-bold text-white">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-1 text-sm text-white/70">
            {isRegister
              ? 'Choose how you take part in the network.'
              : 'Sign in to the Jivandan network.'}
          </p>

          {/* Role switcher */}
          <div
            role="tablist"
            aria-label="Account type"
            className={cn(
              'mt-5 grid gap-2',
              tabs.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
            )}
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = active === tab.role;
              return (
                <button
                  key={tab.role}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setRole(tab.role)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition-all active:scale-[0.97]',
                    selected
                      ? 'border-crimson bg-crimson-ink text-white shadow-crimson'
                      : 'border-white/20 bg-white/5 text-white/80 hover:bg-white/10'
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[11px] text-white/60">
            {tabs.find((t) => t.role === active)?.blurb}
          </p>

          <div className="mt-6">
            {isRegister ? (
              <RegisterForm role={active} />
            ) : (
              <LoginForm role={active} />
            )}
          </div>

          <p className="mt-5 text-center text-sm text-white/70">
            {isRegister ? (
              <>
                Already registered?{' '}
                <Link to="/auth/login" className="font-semibold text-white underline underline-offset-4">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{' '}
                <Link to="/auth/register" className="font-semibold text-white underline underline-offset-4">
                  Create an account
                </Link>
              </>
            )}
          </p>
        </GlassCard>

        <Link to="/" className="mt-6 text-sm text-white/60 underline-offset-4 hover:underline">
          Back to home
        </Link>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- login */

function LoginForm({ role }: { role: Role }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await signIn({ ...values, role });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? homeFor(role), { replace: true });
      toast.success('Signed in');
    } catch (err) {
      if (err instanceof ApiError) {
        // Map the server's field errors onto the form; fall back to a toast.
        const byField = err.byField;
        let mapped = false;
        for (const [field, message] of Object.entries(byField)) {
          if (field === 'email' || field === 'password') {
            setError(field, { message });
            mapped = true;
          }
        }
        if (!mapped) {
          if (err.status === 401) {
            setError('password', { message: 'Email, password or account type is incorrect' });
          } else {
            toast.error(err.message);
          }
        }
      } else {
        toast.error('Could not sign in');
      }
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 [&_label]:text-white/85">
      <Field label="Email" error={errors.email?.message} required>
        {(id, describedBy) => (
          <Input
            id={id}
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={describedBy}
            {...register('email')}
          />
        )}
      </Field>

      <Field label="Password" error={errors.password?.message} required>
        {(id, describedBy) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby={describedBy}
            {...register('password')}
          />
        )}
      </Field>

      <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
        Sign in as {role.replace('-', ' ')}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------ register */

function RegisterForm({ role }: { role: Role }) {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const isDonor = role === 'donor';

  const schema = useMemo(() => (isDonor ? donorSchema : orgSchema), [isDonor]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DonorValues & OrgValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues: { gender: 'prefer_not_to_say' } as Partial<DonorValues & OrgValues>,
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await signUp({ ...values, role });
      navigate(homeFor(role), { replace: true });
      toast.success('Account created');
    } catch (err) {
      if (err instanceof ApiError) {
        const byField = err.byField;
        let mapped = false;
        for (const [field, message] of Object.entries(byField)) {
          if (field in values) {
            setError(field as keyof (DonorValues & OrgValues), { message });
            mapped = true;
          }
        }
        if (err.isConflict) {
          setError('email', { message: 'That email is already registered' });
          mapped = true;
        }
        if (!mapped) toast.error(err.message);
      } else {
        toast.error('Could not create the account');
      }
    }
  });

  const err = errors as Record<string, { message?: string } | undefined>;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 [&_label]:text-white/85">
      <Field label={isDonor ? 'Full name' : 'Organisation name'} error={err.name?.message} required>
        {(id, d) => (
          <Input id={id} aria-invalid={!!err.name} aria-describedby={d} {...register('name')} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" error={err.email?.message} required>
          {(id, d) => (
            <Input id={id} type="email" autoComplete="email" aria-invalid={!!err.email} aria-describedby={d} {...register('email')} />
          )}
        </Field>
        <Field label="Contact number" error={err.contact?.message} required>
          {(id, d) => (
            <Input id={id} inputMode="tel" aria-invalid={!!err.contact} aria-describedby={d} {...register('contact')} />
          )}
        </Field>
      </div>

      <Field label="Password" error={err.password?.message} hint="At least 8 characters" required>
        {(id, d) => (
          <Input id={id} type="password" autoComplete="new-password" aria-invalid={!!err.password} aria-describedby={d} {...register('password')} />
        )}
      </Field>

      {isDonor ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date of birth" error={err.dob?.message} required>
              {(id, d) => (
                <Input id={id} type="date" aria-invalid={!!err.dob} aria-describedby={d} {...register('dob')} />
              )}
            </Field>
            <Field label="Blood group" error={err.bloodgroup?.message} required>
              {(id, d) => (
                <Select id={id} aria-invalid={!!err.bloodgroup} aria-describedby={d} {...register('bloodgroup')}>
                  <option value="">Select…</option>
                  {BLOOD_GROUPS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Gender" error={err.gender?.message} required>
              {(id, d) => (
                <Select id={id} aria-describedby={d} {...register('gender')}>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </Select>
              )}
            </Field>
            <Field label="City" error={err.city?.message}>
              {(id, d) => <Input id={id} aria-describedby={d} {...register('city')} />}
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label="Address" error={err.address?.message} required>
            {(id, d) => (
              <Input id={id} aria-invalid={!!err.address} aria-describedby={d} {...register('address')} />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" error={err.city?.message} required>
              {(id, d) => <Input id={id} aria-invalid={!!err.city} aria-describedby={d} {...register('city')} />}
            </Field>
            <Field label="State" error={err.state?.message} required>
              {(id, d) => <Input id={id} aria-invalid={!!err.state} aria-describedby={d} {...register('state')} />}
            </Field>
            <Field label="PIN code" error={err.pincode?.message} required>
              {(id, d) => (
                <Input id={id} inputMode="numeric" aria-invalid={!!err.pincode} aria-describedby={d} {...register('pincode')} />
              )}
            </Field>
          </div>
          <Field
            label={role === 'blood-bank' ? 'Licence number' : 'Registration number'}
            hint="Required before an admin can verify you"
            error={
              role === 'blood-bank' ? err.licenseNumber?.message : err.registrationNumber?.message
            }
          >
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                {...register(role === 'blood-bank' ? 'licenseNumber' : 'registrationNumber')}
              />
            )}
          </Field>
          <p className="rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-white/85">
            New organisations start as <strong>pending verification</strong>. An admin must approve
            you before you appear in search or can trade units.
          </p>
        </>
      )}

      <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
        Create {role.replace('-', ' ')} account
      </Button>
    </form>
  );
}
