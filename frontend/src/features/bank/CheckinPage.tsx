import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { Camera, CameraOff, CheckCircle2, Keyboard, ScanLine, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { checkinDonor } from '@/api/endpoints';
import { qk } from '@/lib/queryClient';
import { ApiError } from '@/api/client';
import { useAccountId } from '@/hooks/useAuth';
import {
  BloodGroupChip, Button, Field, Input, SectionHeading, Surface,
} from '@/components/ui';
import { formatDate } from '@/lib/domain';
import { cn } from '@/lib/cn';
import type { CheckinResult } from '@/types/api';

/**
 * Donor check-in (Doc 1 section 3).
 *
 * The camera is the fast path, not the only path: permission denial is a normal
 * outcome, not an error, so the manual donor-ID entry is a peer of the scanner
 * rather than a hidden fallback. That also makes the flow usable by anyone who
 * cannot operate a camera viewfinder.
 *
 * Eligibility is enforced server-side on the write path; this screen surfaces
 * the refusal clearly so the operator understands why nothing was recorded.
 */
export function CheckinPage() {
  const bankId = useAccountId();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [passToken, setPassToken] = useState('');
  const [donorId, setDonorId] = useState('');
  const [units, setUnits] = useState(1);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; nextEligibleDate?: string } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stopScanner, [stopScanner]);

  const startScanner = useCallback(async () => {
    setCameraError(null);
    setScanning(true);
    try {
      const reader = new BrowserMultiFormatReader();
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (decoded) => {
          if (!decoded) return;
          const text = decoded.getText();
          // Basic shape check before we hand it to the server: a pass is a JWT.
          if (text.split('.').length !== 3) {
            toast.error('That does not look like a Jivandan donor pass');
            return;
          }
          setPassToken(text);
          setDonorId('');
          stopScanner();
          toast.success('Pass scanned - confirm the details below');
        }
      );
    } catch (err) {
      setScanning(false);
      const message =
        (err as Error).name === 'NotAllowedError'
          ? 'Camera permission was denied. Enter the donor ID manually instead.'
          : 'No camera available. Enter the donor ID manually instead.';
      setCameraError(message);
      setMode('manual');
    }
  }, [stopScanner]);

  const checkin = useMutation({
    mutationFn: () =>
      checkinDonor(bankId!, {
        ...(passToken ? { passToken } : { donorId }),
        units,
      }),
    onSuccess: (data) => {
      setResult(data);
      setRefusal(null);
      setPassToken('');
      setDonorId('');
      void queryClient.invalidateQueries({ queryKey: qk.inventory(bankId ?? '') });
      void queryClient.invalidateQueries({ queryKey: qk.radar(bankId ?? '') });
      toast.success(`Recorded ${data.donation.units} unit(s) of ${data.donation.bloodGroup}`);
    },
    onError: (err: Error) => {
      setResult(null);
      if (err instanceof ApiError && err.status === 422) {
        const detail = err.errors[0] as { nextEligibleDate?: string } | undefined;
        setRefusal({ message: err.message, nextEligibleDate: detail?.nextEligibleDate });
      } else {
        setRefusal({ message: err.message });
      }
    },
  });

  const canSubmit = Boolean((passToken || donorId.trim()) && units >= 1 && bankId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <SectionHeading
        title="Donor check-in"
        subtitle="Scan the donor's pass or enter their ID, then record the donation."
      />

      {/* Mode switch -- both are first-class. */}
      <div role="tablist" aria-label="Check-in method" className="grid grid-cols-2 gap-2">
        {(
          [
            { key: 'scan', label: 'Scan QR pass', icon: Camera },
            { key: 'manual', label: 'Enter donor ID', icon: Keyboard },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const selected = mode === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setMode(tab.key);
                if (tab.key === 'manual') stopScanner();
              }}
              className={cn(
                'flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors',
                selected
                  ? 'border-crimson-ink bg-crimson-ink text-white'
                  : 'border-[rgb(var(--line))] hover:bg-[rgb(var(--line))]'
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ---------------------------------------------------------- scanner */}
      {mode === 'scan' && (
        <Surface>
          <div className="relative aspect-video overflow-hidden rounded-xl bg-navy">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              aria-label="Camera preview for scanning a donor pass"
            />
            {!scanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy/80 text-white">
                <ScanLine className="h-8 w-8 opacity-70" aria-hidden />
                <p className="text-sm text-white/80">Camera is off</p>
                <Button size="sm" onClick={() => void startScanner()} icon={<Camera className="h-4 w-4" />}>
                  Start scanner
                </Button>
              </div>
            )}
            {scanning && (
              <>
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-[15%] rounded-xl border-2 border-crimson/70"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute right-3 top-3 bg-navy/70 text-white hover:bg-navy"
                  onClick={stopScanner}
                  icon={<CameraOff className="h-4 w-4" />}
                >
                  Stop
                </Button>
              </>
            )}
          </div>

          {cameraError && (
            <p role="alert" className="mt-3 text-xs font-medium text-amber-ink dark:text-amber">
              {cameraError}
            </p>
          )}

          {passToken && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-ink/10 px-3 py-2 text-xs font-semibold text-emerald-ink dark:text-emerald-light">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Pass captured. Confirm the units below and record the donation.
            </p>
          )}
        </Surface>
      )}

      {/* ----------------------------------------------------------- manual */}
      {mode === 'manual' && (
        <Surface>
          <Field
            label="Donor ID"
            hint="The 24-character identifier printed on the donor's pass"
            required
          >
            {(id, describedBy) => (
              <Input
                id={id}
                value={donorId}
                onChange={(e) => {
                  setDonorId(e.target.value.trim());
                  setPassToken('');
                }}
                placeholder="6a85c1ced953f5d03eb39af0"
                aria-describedby={describedBy}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
        </Surface>
      )}

      {/* ------------------------------------------------------------ form */}
      <Surface className="flex flex-col gap-4">
        <Field label="Units donated" hint="Usually one unit per donation" required>
          {(id, describedBy) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={10}
              value={units}
              onChange={(e) => setUnits(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              aria-describedby={describedBy}
              className="max-w-32"
            />
          )}
        </Field>

        <Button
          size="lg"
          disabled={!canSubmit}
          loading={checkin.isPending}
          onClick={() => checkin.mutate()}
        >
          Record donation
        </Button>

        <p className="muted text-xs leading-relaxed">
          The donor must have completed the 56-day interval since their last donation. The server
          checks this before anything is written, so an ineligible donation cannot be recorded even
          by mistake.
        </p>
      </Surface>

      {/* --------------------------------------------------------- refusal */}
      {refusal && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-card border border-flare/40 bg-flare/[0.07] px-4 py-4"
        >
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-flare" aria-hidden />
          <div>
            <p className="font-display text-sm font-semibold">Donation not recorded</p>
            <p className="muted mt-1 text-sm">{refusal.message}</p>
            {refusal.nextEligibleDate && (
              <p className="mt-2 text-sm font-semibold">
                Eligible again on {formatDate(refusal.nextEligibleDate)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- result */}
      {result && (
        <div className="rounded-card border border-emerald/40 bg-emerald-ink/[0.07] px-4 py-4">
          <p className="flex items-center gap-2 font-display text-sm font-semibold text-emerald-ink dark:text-emerald-light">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Donation recorded
          </p>

          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="muted text-xs uppercase tracking-wide">Donor</dt>
              <dd className="mt-0.5 flex items-center gap-2 text-sm font-semibold">
                {result.donor.name}
                <BloodGroupChip group={result.donor.bloodgroup} size="sm" />
              </dd>
            </div>
            <div>
              <dt className="muted text-xs uppercase tracking-wide">Units</dt>
              <dd className="tabular mt-0.5 text-sm font-semibold">{result.donation.units}</dd>
            </div>
            <div>
              <dt className="muted text-xs uppercase tracking-wide">Expires</dt>
              <dd className="mt-0.5 text-sm font-semibold">
                {formatDate(result.donation.expiryDate)}
                <span className="muted ml-1 text-xs">(42 days)</span>
              </dd>
            </div>
            <div>
              <dt className="muted text-xs uppercase tracking-wide">
                {result.donation.bloodGroup} now in stock
              </dt>
              <dd className="tabular mt-0.5 text-sm font-semibold">
                {result.inventory[result.donation.bloodGroup]} units
              </dd>
            </div>
          </dl>

          <p className="muted mt-3 text-xs">
            This donor is next eligible on {formatDate(result.donor.eligibility.nextEligibleDate)}.
          </p>
        </div>
      )}
    </div>
  );
}
