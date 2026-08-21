import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Activity, BadgeCheck, Building2, Clock, Droplet, Users } from 'lucide-react';
import { getAdminMetrics } from '@/api/endpoints';
import { POLL, qk } from '@/lib/queryClient';
import { ErrorState, SectionHeading, Skeleton, StatTile, Surface } from '@/components/ui';
import { CountUp } from '@/components/motion';
import { STATUS_LABELS } from '@/lib/domain';

/**
 * Admin control centre (Doc 1 section 3).
 *
 * This is the ONLY place Recharts appears. Doc 1 section 2.3 requires the stock
 * gauges to be hand-built animated SVG rings, and letting a chart library creep
 * into the bank dashboard would violate that; analytics is a different job and
 * a chart library is the right tool for it.
 *
 * All series come from a single /api/admin/metrics call, which the backend
 * answers with one aggregation -- safe to poll.
 */

/* Palette-derived series colours. No default Recharts colours anywhere. */
const SERIES = {
  crimson: '#E63946',
  crimsonInk: '#C1121F',
  burgundy: '#800020',
  flare: '#D90429',
  amber: '#FFB703',
  emerald: '#2A9D8F',
  emeraldInk: '#1F7A6F',
  grid: 'rgba(148,163,184,0.18)',
};

const STATUS_COLOURS: Record<string, string> = {
  pending: '#94A3B8',
  under_review: SERIES.amber,
  approved: SERIES.crimson,
  dispatched: SERIES.burgundy,
  fulfilled: SERIES.emeraldInk,
  rejected: SERIES.flare,
  cancelled: '#64748B',
};

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Surface>
      <div className="mb-4">
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        {subtitle && <p className="muted mt-0.5 text-xs">{subtitle}</p>}
      </div>
      {/* Charts scroll inside their own container rather than the page. */}
      <div className="h-64 w-full overflow-x-auto">{children}</div>
    </Surface>
  );
}

/**
 * Recharts colours legend text with the series colour, which puts Burgundy
 * (#800020) on a navy surface at roughly 1.2:1 -- unreadable. Render the label
 * in the ink colour instead and let the swatch carry the series colour.
 */
const legendProps = {
  wrapperStyle: { fontSize: 11 },
  formatter: (value: string) => (
    <span style={{ color: 'rgb(var(--ink))' }}>{value}</span>
  ),
};

const tooltipStyle = {
  contentStyle: {
    background: 'rgb(var(--surface-raised))',
    border: '1px solid rgb(var(--line))',
    borderRadius: 12,
    fontSize: 12,
  },
  labelStyle: { color: 'rgb(var(--ink))', fontWeight: 600 },
};

export function AdminDashboard() {
  const metrics = useQuery({
    queryKey: qk.adminMetrics,
    queryFn: getAdminMetrics,
    refetchInterval: POLL.admin,
  });

  if (metrics.isError) {
    return (
      <ErrorState
        title="Could not load platform metrics"
        description={(metrics.error as Error).message}
        onRetry={() => void metrics.refetch()}
      />
    );
  }

  if (metrics.isLoading || !metrics.data) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-card" />
          <Skeleton className="h-80 rounded-card" />
        </div>
      </div>
    );
  }

  const m = metrics.data;

  const statusData = Object.entries(m.requests.byStatus).map(([status, count]) => ({
    name: STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status,
    key: status,
    value: count ?? 0,
  }));

  const groupData = m.requests.byBloodGroup.map((row) => ({
    group: row.bloodGroup,
    requests: row.requests,
    units: row.units,
    stock: m.inventory.byBloodGroup[row.bloodGroup] ?? 0,
  }));

  // Include groups nobody has requested, so the chart shows real coverage.
  for (const [group, stock] of Object.entries(m.inventory.byBloodGroup)) {
    if (!groupData.some((g) => g.group === group)) {
      groupData.push({ group: group as never, requests: 0, units: 0, stock });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        title="Platform overview"
        subtitle={`Refreshes every ${POLL.admin / 1000}s · generated ${new Date(
          m.generatedAt
        ).toLocaleTimeString('en-IN')}`}
      />

      {/* ------------------------------------------------------------ KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Donors"
          value={<CountUp value={m.users.donors} />}
          icon={<Users className="h-4 w-4" />}
        />
        <StatTile
          label="Verified banks"
          value={<CountUp value={m.users.banks.verified ?? 0} />}
          sub={`${m.users.banks.pending ?? 0} awaiting review`}
          icon={<Building2 className="h-4 w-4" />}
          accent={(m.users.banks.pending ?? 0) > 0 ? 'amber' : 'emerald'}
        />
        <StatTile
          label="Requests"
          value={<CountUp value={m.requests.total} />}
          sub={`${m.requests.fulfilmentRate}% fulfilled`}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatTile
          label="Units in stock"
          value={<CountUp value={m.inventory.totalUnits} />}
          sub={`${m.inventory.unitsExpiringSoon} expiring in ${m.inventory.expiringWithinDays}d`}
          icon={<Droplet className="h-4 w-4" />}
          accent={m.inventory.unitsExpiringSoon > 0 ? 'amber' : 'emerald'}
        />
        <StatTile
          label="Median fulfilment"
          value={
            m.requests.medianTimeToFulfilHours === null ? (
              '-'
            ) : (
              <CountUp value={m.requests.medianTimeToFulfilHours} decimals={1} suffix=" h" />
            )
          }
          sub="Request to fulfilment"
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      {/* ---------------------------------------------------------- charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Donations per week"
          subtitle="Units collected across the network, last 12 weeks"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={m.donations.weeklyTrend} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
              <CartesianGrid stroke={SERIES.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'rgb(var(--ink-muted))' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'rgb(var(--ink-muted))' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip {...tooltipStyle} />
              <Line
                type="monotone"
                dataKey="units"
                name="Units"
                stroke={SERIES.crimson}
                strokeWidth={2.5}
                dot={{ r: 3, fill: SERIES.crimson, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="donations"
                name="Donations"
                stroke={SERIES.emerald}
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
              />
              <Legend {...legendProps} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Requests by status" subtitle="Every request ever raised">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                innerRadius="52%"
                outerRadius="80%"
                paddingAngle={2}
                stroke="none"
              >
                {statusData.map((entry) => (
                  <Cell key={entry.key} fill={STATUS_COLOURS[entry.key] ?? SERIES.crimson} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend {...legendProps} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Demand vs supply by blood group"
          subtitle="Units requested against units currently on the shelf"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={groupData} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
              <CartesianGrid stroke={SERIES.grid} vertical={false} />
              <XAxis
                dataKey="group"
                tick={{ fontSize: 11, fill: 'rgb(var(--ink-muted))' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'rgb(var(--ink-muted))' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip {...tooltipStyle} />
              <Legend {...legendProps} />
              <Bar dataKey="units" name="Units requested" fill={SERIES.crimson} radius={[4, 4, 0, 0]} />
              <Bar dataKey="stock" name="Units in stock" fill={SERIES.emeraldInk} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Requests by urgency" subtitle="Where the pressure sits">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={(['critical', 'high', 'medium', 'low'] as const).map((u) => ({
                urgency: u[0].toUpperCase() + u.slice(1),
                count: m.requests.byUrgency[u] ?? 0,
                fill:
                  u === 'critical'
                    ? SERIES.flare
                    : u === 'high'
                      ? SERIES.crimson
                      : u === 'medium'
                        ? SERIES.amber
                        : SERIES.emerald,
              }))}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 16 }}
            >
              <CartesianGrid stroke={SERIES.grid} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'rgb(var(--ink-muted))' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="urgency"
                tick={{ fontSize: 11, fill: 'rgb(var(--ink-muted))' }}
                tickLine={false}
                axisLine={false}
                width={62}
              />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" name="Requests" radius={[0, 4, 4, 0]}>
                {(['critical', 'high', 'medium', 'low'] as const).map((u) => (
                  <Cell
                    key={u}
                    fill={
                      u === 'critical'
                        ? SERIES.flare
                        : u === 'high'
                          ? SERIES.crimson
                          : u === 'medium'
                            ? SERIES.amber
                            : SERIES.emerald
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <Surface className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-emerald-ink dark:text-emerald-light" aria-hidden />
          <strong className="tabular">{m.users.banks.verified ?? 0}</strong> verified
        </span>
        <span className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-ink dark:text-amber" aria-hidden />
          <strong className="tabular">{m.users.banks.pending ?? 0}</strong> pending review
        </span>
        <span className="flex items-center gap-2">
          <Droplet className="h-4 w-4 text-crimson-ink dark:text-crimson-light" aria-hidden />
          <strong className="tabular">{m.inventory.batchesExpired}</strong> batches expired
        </span>
        <span className="muted ml-auto text-xs">Hospitals registered: {m.users.hospitals}</span>
      </Surface>
    </div>
  );
}
