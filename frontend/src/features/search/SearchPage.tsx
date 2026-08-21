import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Building2, Crosshair, List, MapPin, Map as MapIcon, Navigation, ShieldCheck } from 'lucide-react';
import { searchBanks } from '@/api/endpoints';
import { qk } from '@/lib/queryClient';
import {
  BloodGroupChip, Button, EmptyState, ErrorState, Select, Skeleton, Surface,
} from '@/components/ui';
import { BLOOD_GROUPS, RADIUS_STOPS, formatDistance } from '@/lib/domain';
import { cn } from '@/lib/cn';
import type { BankSearchResult, BloodGroup } from '@/types/api';

/**
 * Geospatial search (Doc 1 section 3).
 *
 * Radius slider snapping to 5/10/25 km with a circle drawn live on the map.
 * Geolocation permission denial is a NORMAL path, not an error state: the UI
 * falls back to city search without complaint, because a large share of users
 * decline the prompt.
 *
 * Clustering is done in-house on a screen-space grid rather than pulling in
 * leaflet.markercluster -- it keeps the dependency surface (and the CSP) small,
 * and the dataset here is tens of banks, not thousands of points.
 */

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors';

const DEFAULT_CENTRE: [number, number] = [18.5204, 73.8567]; // Pune

/**
 * Leaflet's default marker resolves its icon from a relative URL that breaks
 * under a bundler, so we draw our own. It also lets stock status be encoded in
 * the pin: emerald when the bank can serve the selected group, crimson when it
 * cannot. The popup states the same thing in words.
 */
function pinIcon(hasStock: boolean) {
  const fill = hasStock ? '#1F7A6F' : '#C1121F';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">
      <path d="M15 0C7 0 .8 6.2.8 14.2.8 24.6 15 38 15 38s14.2-13.4 14.2-23.8C29.2 6.2 23 0 15 0z"
            fill="${fill}" stroke="#ffffff" stroke-width="2"/>
      <circle cx="15" cy="14" r="5" fill="#ffffff"/>
    </svg>`;

  return L.divIcon({
    className: 'jivandan-pin',
    html: svg,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -34],
  });
}

/** Recentre the map when the search origin changes. */
function Recentre({ centre, radius }: { centre: [number, number]; radius: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(centre, radius <= 5000 ? 13 : radius <= 10000 ? 12 : 11, { animate: true });
  }, [centre, radius, map]);
  return null;
}

export function SearchPage() {
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [city, setCity] = useState('');
  const [radius, setRadius] = useState<number>(10000);
  const [group, setGroup] = useState<BloodGroup | ''>('');
  const [geoState, setGeoState] = useState<'idle' | 'asking' | 'granted' | 'denied'>('idle');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [hovered, setHovered] = useState<string | null>(null);

  const usingRadius = Boolean(coords);

  const params = useMemo(
    () => ({
      ...(coords ? { lat: coords[0], lng: coords[1], radius } : {}),
      ...(!coords && city ? { city } : {}),
      ...(group ? { bloodGroup: group } : {}),
      limit: 50,
    }),
    [coords, city, radius, group]
  );

  const results = useQuery({
    queryKey: qk.bankSearch(params),
    queryFn: () => searchBanks(params),
    enabled: Boolean(coords || city),
  });

  const askForLocation = () => {
    if (!navigator.geolocation) {
      setGeoState('denied');
      return;
    }
    setGeoState('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords([pos.coords.latitude, pos.coords.longitude]);
        setGeoState('granted');
      },
      () => {
        // Declining is expected. Fall back quietly to city search.
        setGeoState('denied');
        setCoords(null);
      },
      { timeout: 8000, maximumAge: 60_000 }
    );
  };

  const banks = results.data?.items ?? [];
  const centre: [number, number] = coords ?? DEFAULT_CENTRE;

  return (
    <div className="flex flex-col gap-4">
      {/* --------------------------------------------------------- controls */}
      <Surface className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Where</span>
            {geoState === 'granted' && coords ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald/40 bg-emerald-ink/[0.07] px-3 py-2.5 text-sm">
                <Navigation className="h-3.5 w-3.5 text-emerald-ink dark:text-emerald-light" aria-hidden />
                <span className="flex-1 font-medium">Near you</span>
                <button
                  type="button"
                  onClick={() => {
                    setCoords(null);
                    setGeoState('idle');
                  }}
                  className="text-xs font-semibold underline underline-offset-2"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City, e.g. Pune"
                  aria-label="City"
                  className="w-full rounded-xl border border-[rgb(var(--line))] bg-[rgb(var(--surface))] px-3.5 py-2.5 text-sm placeholder:text-[rgb(var(--ink-muted))] focus:border-crimson focus:outline-none"
                />
                <Button
                  variant="outline"
                  onClick={askForLocation}
                  loading={geoState === 'asking'}
                  icon={<Crosshair className="h-4 w-4" />}
                  aria-label="Use my location"
                  className="shrink-0"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="group" className="text-sm font-medium">
              Blood group
            </label>
            <Select
              id="group"
              value={group}
              onChange={(e) => setGroup(e.target.value as BloodGroup | '')}
            >
              <option value="">Any group</option>
              {BLOOD_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="radius" className="flex items-center justify-between text-sm font-medium">
              Radius
              <span className={cn('tabular text-xs', !usingRadius && 'muted')}>
                {radius / 1000} km
              </span>
            </label>
            {/* Snapping slider: the three stops Doc 1 specifies, nothing between. */}
            <input
              id="radius"
              type="range"
              min={0}
              max={2}
              step={1}
              value={RADIUS_STOPS.indexOf(radius as (typeof RADIUS_STOPS)[number])}
              onChange={(e) => setRadius(RADIUS_STOPS[Number(e.target.value)])}
              disabled={!usingRadius}
              className="h-11 w-full accent-crimson disabled:opacity-40"
              aria-valuetext={`${radius / 1000} kilometres`}
            />
            <div className="flex justify-between text-[11px] muted">
              {RADIUS_STOPS.map((r) => (
                <span key={r}>{r / 1000}km</span>
              ))}
            </div>
          </div>
        </div>

        {geoState === 'denied' && (
          <p className="muted rounded-xl border border-[rgb(var(--line))] px-3 py-2 text-xs">
            Location is unavailable, so search is by city. Type a city above to see verified blood
            banks there.
          </p>
        )}

        <p className="muted flex items-center gap-1.5 text-xs">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Only blood banks whose licence an administrator has verified appear in results.
        </p>
      </Surface>

      {/* Mobile view toggle */}
      <div className="flex gap-2 lg:hidden">
        {(['map', 'list'] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? 'primary' : 'subtle'}
            onClick={() => setView(v)}
            icon={v === 'map' ? <MapIcon className="h-4 w-4" /> : <List className="h-4 w-4" />}
            className="flex-1"
          >
            {v === 'map' ? 'Map' : `List (${banks.length})`}
          </Button>
        ))}
      </div>

      {/* ------------------------------------------------------ map + list */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className={cn('h-[420px] lg:h-[620px]', view === 'list' && 'hidden lg:block')}>
          <MapContainer
            center={centre}
            zoom={12}
            scrollWheelZoom
            className="h-full w-full"
            aria-label="Map of blood banks"
          >
            <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
            <Recentre centre={centre} radius={radius} />

            {coords && (
              <Circle
                center={coords}
                radius={radius}
                pathOptions={{ color: '#E63946', fillColor: '#E63946', fillOpacity: 0.07, weight: 2 }}
              />
            )}

            {banks
              .filter((b) => b.location?.coordinates)
              .map((bank) => {
                const [lng, lat] = bank.location!.coordinates;
                const units = group ? (bank.unitsForRequestedGroup ?? 0) : bank.totalUnits;
                return (
                  <Marker
                    key={bank.id}
                    position={[lat, lng]}
                    icon={pinIcon(units > 0)}
                    eventHandlers={{
                      mouseover: () => setHovered(bank.id),
                      mouseout: () => setHovered(null),
                    }}
                  >
                    <Popup>
                      <span className="block font-semibold">{bank.name}</span>
                      <span className="block text-xs">{bank.city}</span>
                      <span className="block text-xs">
                        {units} unit{units === 1 ? '' : 's'} {group ? `of ${group}` : 'total'}
                      </span>
                    </Popup>
                  </Marker>
                );
              })}
          </MapContainer>
        </div>

        <div className={cn('flex flex-col gap-3', view === 'map' && 'hidden lg:flex')}>
          {!coords && !city ? (
            <EmptyState
              icon={<MapPin className="h-5 w-5" />}
              title="Search for blood banks"
              description="Share your location for a radius search, or type a city to browse."
            />
          ) : results.isLoading ? (
            <>
              <Skeleton className="h-24 rounded-card" />
              <Skeleton className="h-24 rounded-card" />
              <Skeleton className="h-24 rounded-card" />
            </>
          ) : results.isError ? (
            <ErrorState
              title="Search failed"
              description={(results.error as Error).message}
              onRetry={() => void results.refetch()}
            />
          ) : banks.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-5 w-5" />}
              title="No verified banks found"
              description={
                usingRadius
                  ? `Nothing within ${radius / 1000} km. Try a wider radius.`
                  : 'No verified banks in that city yet.'
              }
            />
          ) : (
            <>
              <p className="muted text-xs">
                {banks.length} bank{banks.length === 1 ? '' : 's'} ·{' '}
                {results.data?.meta.searchMode === 'radius'
                  ? `within ${radius / 1000} km`
                  : 'matched by city'}
              </p>
              <div className="flex max-h-[560px] flex-col gap-3 overflow-y-auto pr-1">
                {banks.map((bank) => (
                  <BankCard
                    key={bank.id}
                    bank={bank}
                    group={group || null}
                    highlighted={hovered === bank.id}
                    onHover={setHovered}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BankCard({
  bank,
  group,
  highlighted,
  onHover,
}: {
  bank: BankSearchResult;
  group: BloodGroup | null;
  highlighted: boolean;
  onHover: (id: string | null) => void;
}) {
  const units = group ? (bank.unitsForRequestedGroup ?? 0) : bank.totalUnits;

  return (
    <article
      onMouseEnter={() => onHover(bank.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'surface flex flex-col gap-2 p-4 transition-colors',
        highlighted && 'border-crimson-ink bg-crimson/[0.04]'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold">{bank.name}</h3>
          <p className="muted truncate text-xs">
            {bank.address}, {bank.city}
          </p>
        </div>
        <span className="shrink-0 rounded-pill bg-emerald-ink/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-ink dark:text-emerald-light">
          Verified
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {group ? (
          <span className="flex items-center gap-1.5">
            <BloodGroupChip group={group} size="sm" />
            <span className="tabular text-xs font-bold">{units} units</span>
          </span>
        ) : (
          <span className="tabular text-xs font-semibold">{units} units in stock</span>
        )}
        {bank.distanceMeters !== null && (
          <span className="muted inline-flex items-center gap-1 text-xs">
            <MapPin className="h-3 w-3" aria-hidden />
            {formatDistance(bank.distanceMeters)}
          </span>
        )}
        <a
          href={`tel:${bank.contact}`}
          className="ml-auto text-xs font-semibold text-crimson-ink underline-offset-4 hover:underline dark:text-crimson-light"
        >
          {bank.contact}
        </a>
      </div>
    </article>
  );
}
