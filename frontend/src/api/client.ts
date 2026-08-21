import type { Envelope, FieldError, PageMeta, Paginated } from '@/types/api';

/**
 * The single way this app talks to the backend.
 *
 * Security posture, deliberately chosen:
 *
 * 1. The access token lives in MEMORY ONLY -- never localStorage, never
 *    sessionStorage, never a non-httpOnly cookie. An XSS bug therefore cannot
 *    exfiltrate a long-lived credential; it dies with the tab.
 *
 * 2. Sessions survive a reload through the backend's httpOnly session cookie,
 *    which JavaScript cannot read. On boot we call GET /api/auth/me with
 *    credentials, and the cookie re-establishes who we are.
 *
 * 3. Every request carries `X-Requested-With: XMLHttpRequest`. The backend
 *    requires it on cookie-authenticated writes; a cross-site page cannot set a
 *    custom header without a CORS preflight the allowlist refuses. That is the
 *    CSRF defence for the cookie path.
 *
 * 4. Requests default to same-origin `/api`, proxied to the backend in dev, so
 *    no CORS relaxation is needed anywhere in normal operation.
 */

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
export const API_BASE = RAW_BASE;

/** Kept out of any storage on purpose -- see note 1 above. */
let accessToken: string | null = null;
type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/** Fires when the server rejects our credentials, so the app can sign out. */
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export class ApiError extends Error {
  readonly status: number;
  readonly errors: FieldError[];

  constructor(status: number, message: string, errors: FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }

  /** Field errors keyed by field name, ready for React Hook Form's setError. */
  get byField(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.errors) {
      if (e.field && !out[e.field]) out[e.field] = e.message;
    }
    return out;
  }

  get isValidation() {
    return this.status === 422;
  }
  get isConflict() {
    return this.status === 409;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isRateLimited() {
    return this.status === 429;
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query) {
  const url = `${API_BASE}/api${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Suppress the global sign-out on 401 (used by the boot session probe). */
  quiet?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  const { method = 'GET', body, query, signal, quiet } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    // Required by the backend on cookie-authenticated writes. See note 3.
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      // Sends the httpOnly session cookie so a reload can restore the session.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the Jivandan API. Is the backend running?');
  }

  // 204 and other empty bodies.
  const text = await response.text();
  let payload: Envelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as Envelope<T>;
    } catch {
      throw new ApiError(response.status, 'The server returned a malformed response');
    }
  }

  if (!response.ok || (payload && payload.success === false)) {
    const message = payload?.message || `Request failed (${response.status})`;

    if (response.status === 401 && !quiet) {
      accessToken = null;
      unauthorizedListeners.forEach((fn) => fn());
    }

    throw new ApiError(response.status, message, payload?.errors ?? []);
  }

  return (payload ?? { success: true, message: 'OK', data: null as T }) as Envelope<T>;
}

/** Unwrap `data`. Use for every non-paginated endpoint. */
async function unwrap<T>(path: string, options?: RequestOptions): Promise<T> {
  const envelope = await request<T>(path, options);
  return envelope.data;
}

/** Keep `data` and `meta` together. Use for every list endpoint. */
async function unwrapList<T>(path: string, options?: RequestOptions): Promise<Paginated<T>> {
  const envelope = await request<T[]>(path, options);
  return {
    items: envelope.data ?? [],
    meta: envelope.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 },
  };
}

export const api = {
  get: <T>(path: string, query?: Query, opts?: RequestOptions) =>
    unwrap<T>(path, { ...opts, method: 'GET', query }),

  list: <T>(path: string, query?: Query, opts?: RequestOptions) =>
    unwrapList<T>(path, { ...opts, method: 'GET', query }),

  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    unwrap<T>(path, { ...opts, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    unwrap<T>(path, { ...opts, method: 'PATCH', body }),

  raw: request,
};

export type { PageMeta };
