import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, Check, Droplet, Siren } from 'lucide-react';
import { toast } from 'sonner';
import { createRequest, searchBanks } from '@/api/endpoints';
import { qk } from '@/lib/queryClient';
import { ApiError } from '@/api/client';
import {
  BloodGroupChip, Button, Field, Input, SectionHeading, Skeleton, Surface, Textarea, UrgencyBadge,
} from '@/components/ui';
import { BLOOD_GROUPS, urgencyStyle } from '@/lib/domain';
import { cn } from '@/lib/cn';
import type { BloodGroup, Urgency } from '@/types/api';

/**
 * Emergency request form (Doc 1 section 3).
 *
 * Multi-step, with the urgency selector giving live colour feedback: the
 * surrounding surface shifts amber -> flare and begins pulsing as `critical` is
 * chosen, so the weight of the choice is felt before submitting rather than
 * after. Navigating back preserves everything already entered.
 */

const STEPS = ['Patient', 'Blood', 'Urgency', 'Bank', 'Review'] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4;

interface Draft {
  patientName: string;
  hospitalName: string;
  notes: string;
  bloodGroup: BloodGroup | '';
  units: number;
  urgency: Urgency;
  bloodBank: string;
  requiredBy: string;
}

const EMPTY: Draft = {
  patientName: '',
  hospitalName: '',
  notes: '',
  bloodGroup: '',
  units: 1,
  urgency: 'medium',
  bloodBank: '',
  requiredBy: '',
};

export function NewRequestPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<StepIndex>(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /* Banks that actually hold the requested group, so the choice is informed. */
  const banks = useQuery({
    queryKey: qk.bankSearch({ group: draft.bloodGroup, step }),
    queryFn: () =>
      searchBanks({
        bloodGroup: (draft.bloodGroup || undefined) as BloodGroup | undefined,
        limit: 20,
      }),
    enabled: step >= 3,
  });

  const submit = useMutation({
    mutationFn: () =>
      createRequest({
        bloodGroup: draft.bloodGroup as BloodGroup,
        units: draft.units,
        urgency: draft.urgency,
        bloodBank: draft.bloodBank || undefined,
        patientName: draft.patientName || undefined,
        hospitalName: draft.hospitalName || undefined,
        notes: draft.notes || undefined,
        requiredBy: draft.requiredBy || undefined,
      }),
    onSuccess: (result) => {
      toast.success('Request submitted', {
        description:
          draft.urgency === 'critical'
            ? 'Eligible donors and nearby banks have been notified.'
            : undefined,
      });
      navigate(`/request/${result.request.id}/track`);
    },
    onError: (err: Error) => {
      if (err instanceof ApiError) {
        setErrors(err.byField);
        if (err.isRateLimited) {
          toast.error('Too many requests', {
            description: 'You have reached the hourly limit. Try again shortly.',
          });
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error('Could not submit the request');
      }
    },
  });

  const validateStep = (s: StepIndex): boolean => {
    const next: Record<string, string> = {};
    if (s === 1) {
      if (!draft.bloodGroup) next.bloodGroup = 'Choose the blood group needed';
      if (draft.units < 1) next.units = 'At least one unit is required';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(4, s + 1) as StepIndex);
  };
  const goBack = () => setStep((s) => Math.max(0, s - 1) as StepIndex);

  const style = urgencyStyle(draft.urgency);
  const isCritical = draft.urgency === 'critical';

  return (
    <div className="mx-auto max-w-2xl">
      <SectionHeading
        title="Raise a blood request"
        subtitle="Five short steps. Nothing is submitted until you review it."
      />

      {/* Progress */}
      <ol className="mb-6 flex items-center gap-1.5" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-1.5">
            <span
              className={cn(
                'h-1 rounded-pill transition-colors',
                i < step ? 'bg-emerald-ink' : i === step ? 'bg-crimson-ink' : 'bg-[rgb(var(--line))]'
              )}
              aria-hidden
            />
            <span
              className={cn(
                'text-[11px] font-semibold',
                i === step ? 'text-[rgb(var(--ink))]' : 'muted'
              )}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      {/* The urgency choice colours the whole card from step 2 onward. */}
      <Surface
        className={cn(
          'relative isolate transition-colors duration-500',
          step >= 2 && draft.urgency === 'critical' && 'border-flare/50 bg-flare/[0.05]',
          step >= 2 && draft.urgency === 'high' && 'border-crimson/40 bg-crimson/[0.04]',
          step >= 2 && draft.urgency === 'medium' && 'border-amber/40 bg-amber/[0.05]'
        )}
      >
        {/* -------------------------------------------------- 0: patient */}
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <Field label="Patient name" hint="Optional - leave blank to keep it private">
              {(id) => (
                <Input
                  id={id}
                  value={draft.patientName}
                  onChange={(e) => set('patientName', e.target.value)}
                  placeholder="e.g. Trauma admission"
                />
              )}
            </Field>
            <Field label="Hospital" hint="Where the transfusion will happen">
              {(id) => (
                <Input
                  id={id}
                  value={draft.hospitalName}
                  onChange={(e) => set('hospitalName', e.target.value)}
                />
              )}
            </Field>
            <Field label="Needed by" hint="Optional">
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={draft.requiredBy}
                  onChange={(e) => set('requiredBy', e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        {/* ---------------------------------------------------- 1: blood */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                Blood group needed <span className="text-crimson-ink dark:text-crimson-light">*</span>
              </legend>
              <div className="grid grid-cols-4 gap-2">
                {BLOOD_GROUPS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={draft.bloodGroup === g}
                    onClick={() => set('bloodGroup', g)}
                    className={cn(
                      'rounded-xl border px-2 py-3 font-display text-base font-bold tabular transition-all active:scale-[0.97]',
                      draft.bloodGroup === g
                        ? 'border-crimson-ink bg-crimson-ink text-white shadow-crimson'
                        : 'border-[rgb(var(--line))] hover:border-crimson/40 hover:bg-crimson/5'
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {errors.bloodGroup && (
                <p role="alert" className="mt-2 text-xs font-medium text-crimson-ink dark:text-crimson-light">
                  {errors.bloodGroup}
                </p>
              )}
            </fieldset>

            <Field label="Units required" error={errors.units} required>
              {(id, d) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={50}
                  value={draft.units}
                  onChange={(e) => set('units', Math.max(1, Number(e.target.value) || 1))}
                  aria-describedby={d}
                  className="max-w-32"
                />
              )}
            </Field>
          </div>
        )}

        {/* -------------------------------------------------- 2: urgency */}
        {step === 2 && (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">How urgent is this?</legend>
            {(['low', 'medium', 'high', 'critical'] as Urgency[]).map((u) => {
              const selected = draft.urgency === u;
              return (
                <button
                  key={u}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => set('urgency', u)}
                  className={cn(
                    'relative isolate flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all active:scale-[0.99]',
                    selected
                      ? 'border-transparent ring-2 ring-offset-2 ring-offset-[rgb(var(--surface-raised))]'
                      : 'border-[rgb(var(--line))] hover:bg-[rgb(var(--line))]',
                    selected && u === 'critical' && 'ring-flare',
                    selected && u === 'high' && 'ring-crimson',
                    selected && u === 'medium' && 'ring-amber',
                    selected && u === 'low' && 'ring-emerald'
                  )}
                >
                  {selected && u === 'critical' && (
                    <span
                      aria-hidden
                      className="absolute inset-0 -z-10 animate-pulse-ring rounded-xl bg-flare/40"
                    />
                  )}
                  <UrgencyBadge urgency={u} />
                  <span className="text-sm">
                    {u === 'critical' && 'Life-threatening - notifies donors immediately'}
                    {u === 'high' && 'Needed within hours'}
                    {u === 'medium' && 'Needed within a day'}
                    {u === 'low' && 'Planned or elective'}
                  </span>
                </button>
              );
            })}

            {isCritical && (
              <p className="flex items-start gap-2 rounded-xl border border-flare/40 bg-flare/10 px-3 py-2.5 text-xs leading-relaxed">
                <Siren className="mt-0.5 h-3.5 w-3.5 shrink-0 text-flare" aria-hidden />
                <span>
                  Submitting at <strong>Critical</strong> immediately alerts every eligible donor
                  whose blood can serve this group, plus nearby banks holding compatible stock.
                  Please use it only for genuine emergencies.
                </span>
              </p>
            )}
          </fieldset>
        )}

        {/* ----------------------------------------------------- 3: bank */}
        {step === 3 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Choose a blood bank</p>
            <p className="muted -mt-2 text-xs">
              Only verified banks are listed. Stock shown is for {draft.bloodGroup || 'the group'}.
            </p>

            {banks.isLoading ? (
              <>
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
              </>
            ) : (banks.data?.items.length ?? 0) === 0 ? (
              <p className="muted rounded-xl border border-dashed border-[rgb(var(--line))] px-4 py-6 text-center text-sm">
                No verified bank currently lists stock for {draft.bloodGroup}. You can still submit -
                a bank can pick the request up from its queue.
              </p>
            ) : (
              banks.data!.items.map((bank) => {
                const selected = draft.bloodBank === bank.id;
                const covers = (bank.unitsForRequestedGroup ?? 0) >= draft.units;
                return (
                  <button
                    key={bank.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => set('bloodBank', selected ? '' : bank.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                      selected
                        ? 'border-crimson-ink bg-crimson/5'
                        : 'border-[rgb(var(--line))] hover:bg-[rgb(var(--line))]'
                    )}
                  >
                    <Building2 className="h-4 w-4 shrink-0 text-crimson-ink dark:text-crimson-light" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{bank.name}</span>
                      <span className="muted block truncate text-xs">
                        {bank.city}, {bank.state}
                      </span>
                    </span>
                    {draft.bloodGroup && (
                      <span
                        className={cn(
                          'shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-bold tabular',
                          covers
                            ? 'bg-emerald-ink/10 text-emerald-ink dark:text-emerald-light'
                            : 'bg-amber/20 text-amber-ink dark:text-amber'
                        )}
                      >
                        {bank.unitsForRequestedGroup ?? 0} in stock
                      </span>
                    )}
                    {selected && <Check className="h-4 w-4 shrink-0 text-crimson-ink" aria-hidden />}
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* --------------------------------------------------- 4: review */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {draft.bloodGroup && <BloodGroupChip group={draft.bloodGroup} size="lg" />}
              <div>
                <p className="font-display text-lg font-bold">
                  {draft.units} unit{draft.units === 1 ? '' : 's'} of {draft.bloodGroup}
                </p>
                <UrgencyBadge urgency={draft.urgency} size="sm" />
              </div>
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Review label="Patient" value={draft.patientName || '-'} />
              <Review label="Hospital" value={draft.hospitalName || '-'} />
              <Review
                label="Blood bank"
                value={
                  banks.data?.items.find((b) => b.id === draft.bloodBank)?.name ??
                  'Unassigned - any bank may pick this up'
                }
              />
              <Review
                label="Needed by"
                value={draft.requiredBy ? new Date(draft.requiredBy).toLocaleString('en-IN') : '-'}
              />
            </dl>

            <Field label="Notes for the bank" hint="Optional">
              {(id) => (
                <Textarea
                  id={id}
                  value={draft.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  maxLength={1000}
                />
              )}
            </Field>

            {isCritical && (
              <p className="flex items-center gap-2 rounded-xl bg-flare/10 px-3 py-2 text-xs font-semibold text-flare">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Submitting this will notify donors immediately.
              </p>
            )}
          </div>
        )}

        {/* --------------------------------------------------- navigation */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-[rgb(var(--line))] pt-5">
          <Button
            variant="ghost"
            onClick={goBack}
            disabled={step === 0}
            icon={<ArrowLeft className="h-4 w-4" />}
          >
            Back
          </Button>

          {step < 4 ? (
            <Button onClick={goNext} icon={<ArrowRight className="h-4 w-4" />}>
              Continue
            </Button>
          ) : (
            <Button
              size="lg"
              variant={isCritical ? 'danger' : 'primary'}
              loading={submit.isPending}
              onClick={() => submit.mutate()}
              icon={<Droplet className="h-4 w-4" />}
              className={cn(isCritical && 'relative isolate')}
            >
              Submit {style.label.toLowerCase()} request
            </Button>
          )}
        </div>
      </Surface>
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="muted text-xs uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
