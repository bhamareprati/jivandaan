# Jivandan - Frontend

React + TypeScript SPA for **जीवनदान / Jivandan**, built to Document 1 (*Frontend Development - Master Prompt & Implementation Blueprint*), phases F1-F5, wired to the API in [`../docs/backend-contract.md`](../docs/backend-contract.md).

---

## Quick start

The backend must be running first (see [`../backend/README.md`](../backend/README.md)).

```bash
npm install
cp .env.example .env     # defaults are fine for local work
npm run dev              # http://localhost:5173
```

Sign in with any seeded account - password `Passw0rd!`:

| Role | Email | What you'll see |
|---|---|---|
| donor | `asha0@donor.test` | eligible now (never donated) |
| donor | `meera2@donor.test` | mid-window, 44-day countdown |
| blood-bank | `sahyadri@bank.test` | stock with healthy / low / empty groups |
| blood-bank | `navimumbai@bank.test` | awaiting verification banner |
| hospital | `rubyhall@hospital.test` | raise and track requests |
| admin | `admin@jivandan.in` | KPIs, verification queue, audit log |

| Command | |
|---|---|
| `npm run dev` | dev server with an `/api` proxy to the backend |
| `npm run build` | typecheck then production build |
| `npm run preview` | serve the built output |
| `npm run typecheck` | types only |

---

## Security

The user asked for this explicitly, so here is what is actually done and why.

### The access token is never stored

It lives in a module-scoped variable in [`src/api/client.ts`](src/api/client.ts) - not `localStorage`, not `sessionStorage`, not a readable cookie. An XSS bug therefore cannot exfiltrate a credential that outlives the tab.

Sessions survive a reload through the backend's **httpOnly** session cookie, which JavaScript cannot read. On boot, `AuthProvider` calls `GET /api/auth/me` with `credentials: 'include'`; if the cookie is still valid the server says who you are.

### CSRF

Cookie-authenticated requests are the CSRF-exposed path (the browser attaches the cookie automatically). Bearer-authenticated ones are not - an attacker's page cannot read the token.

So every request sends `X-Requested-With: XMLHttpRequest`, and the backend **requires** it on cookie-authenticated writes. A cross-site page cannot set a custom header without a CORS preflight, and the backend's origin allowlist refuses the preflight. Verified:

```
cookie-auth POST without the header  ->  403
cookie-auth POST with the header     ->  201
bearer-auth POST without the header  ->  201   (not forgeable)
```

This is also what makes `COOKIE_SAMESITE=none` safe if you ever deploy the API on a different origin.

### Same-origin by default

`vite.config.ts` proxies `/api` to the backend, so development is same-origin: the session cookie stays `SameSite=Lax` (which blocks cross-site writes outright) and no CORS relaxation is needed. Keep it that way in production with a host rewrite if you can.

### Content Security Policy

`index.html` carries a CSP meta as a backstop. **Serve the same policy as a response header** - a meta tag cannot express `frame-ancestors`, so clickjacking protection has to come from the host.

For Netlify (`public/_headers`) or an equivalent on your host:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), geolocation=(self), microphone=()
```

`camera=(self)` and `geolocation=(self)` are needed by the check-in scanner and the radius search; nothing else is granted.

`'unsafe-inline'` appears only on `style-src`, because Framer Motion and Recharts set inline styles. Scripts get no such exemption.

### Other measures

- **Route guards are UX, not security.** [`src/routes/guards.tsx`](src/routes/guards.tsx) redirects, but every protected endpoint is independently enforced by the backend's RBAC. Editing your way past the guard still gets a 401/403.
- **No `dangerouslySetInnerHTML` anywhere.** All server data renders as text; React escapes it.
- **The donor pass QR is treated as a credential** - short cache lifetime, never persisted, and the screen warns before it is shared.
- **401 signs you out globally**, clearing the in-memory token and the whole query cache.
- **Zod validation mirrors the server's rules** for fast feedback. It is a convenience; the server validates independently and is the only thing that counts.
- **Only `VITE_*` variables reach the bundle**, and none of them is a secret.

---

## Design system

Everything comes from [`tailwind.config.ts`](tailwind.config.ts) - no component hard-codes a hex value or an off-scale font size.

**Palette** - Vitality Crimson `#E63946`, Burgundy `#800020`, Emergency Flare `#D90429`, Electric Amber `#FFB703`, Healing Emerald `#2A9D8F`, Dark Slate Navy `#0F172A`, plus glass frost.

**Accessible ink variants.** Measured against the brief's palette: `#E63946` is **4.17:1** on white, which fails WCAG AA for body text (4.5:1 needed). So the brand colour is used for large text, icons, borders and fills, and two additions carry body text:

| Token | Contrast | Use |
|---|---|---|
| `crimson.ink` `#C1121F` | 6.22:1 on white | crimson body text, and fills with white labels |
| `emerald.ink` `#1F7A6F` | 5.16:1 on white | emerald text |
| `crimson.light` `#FF6B6B` | 6.43:1 on navy | crimson text in dark mode |

Amber is a **fill only** (1.75:1 on white) and always carries navy text (10.2:1). Emergency Flare works for white text at 5.25:1, which is why critical badges use it.

**Type** - Outfit for headings, Inter for body, `tabular-nums` on every live number. Scale fixed at 12/14/16/20/28/40/56.

**Glass - floating surfaces only.** `.glass` is applied to exactly four things: modals, the sticky nav once scrolled, toasts, and the landing hero's floating stat panel. Every other card is `.surface`, solid and opaque. Doc 1 §2.4 is right that glassing every card is what makes the style look cheap, and it is the easiest rule here to break by accident.

**Motion** - Framer Motion for entrances and page transitions; hand-built SVG `stroke-dashoffset` rings for stock and eligibility (Doc 1 §2.3 forbids using a chart library for those); CSS keyframes for the Critical pulse. Recharts appears **only** in the admin console.

**Reduced motion** is handled in three places because one is not enough: `<MotionConfig reducedMotion="user">` for Framer, a media query in `globals.css` for CSS animations, and `useReducedMotion()` in JS for the count-ups and the 3D scene.

---

## The 3D hero

[`src/components/three/`](src/components/three/) - a low-poly blood drop built as a lathe, glass transmission material, slow auto-rotation with pointer parallax.

It is lazy-loaded, so `three` + `@react-three/fiber` + `drei` (≈1 MB, 289 KB gzipped) sit in their own chunk and never block first paint. It mounts only when **all** of these hold, otherwise the gradient-mesh poster renders instead:

- `prefers-reduced-motion` is not set
- viewport ≥ 768px
- `navigator.hardwareConcurrency > 4`
- data-saver is off

The poster is not an apology - it is the backdrop the glass panel blurs, so the composition works either way.

---

## Live data

No push transport exists in the contract, so the UI polls. Every interval is in one place, [`src/lib/queryClient.ts`](src/lib/queryClient.ts):

| Surface | Interval |
|---|---|
| Request tracker | 5 s - **stops** once the status is terminal |
| Bank stock, expiry radar, request queue | 15 s |
| Donor feed | 30 s |
| Admin KPIs | 30 s |
| Landing counters | 60 s |

Swapping these for socket-driven invalidation later touches this file and nothing else.

---

## Screens

| Route | Role | |
|---|---|---|
| `/` | public | 3D hero, live counters |
| `/auth/login`, `/auth/register` | public | role switcher drives fields **and** the login payload |
| `/donor/dashboard` | donor | eligibility ring, impact, feed filtered by `canDonateTo` |
| `/donor/pass` | donor | signed QR, timeline, milestone badges |
| `/bank/dashboard` | blood-bank | 8-group matrix, expiry radar, reconcile |
| `/bank/requests` | blood-bank | Kanban by urgency, Critical column pulses |
| `/bank/checkin` | blood-bank | QR scanner + manual entry as equal paths |
| `/request/new` | donor, hospital | 5 steps, urgency colours the surface live |
| `/request/:id/track` | participants | animated stepper on real timestamps |
| `/requests` | donor, hospital | your requests |
| `/search` | any | map + radius slider at 5/10/25 km |
| `/admin/dashboard` | admin | KPIs and Recharts analytics |
| `/admin/verification` | admin | approve/reject, reason required |
| `/admin/logs` | admin | server-paginated append-only audit log |

Three deliberately different shells: donor is mobile-first with a bottom tab bar; bank and hospital get a persistent sidebar and denser layout; admin is denser still with a command bar.

---

## Known limitations

- **Marker clustering is a simple in-house pin renderer**, not `leaflet.markercluster`. Fine for tens of banks; revisit at thousands.
- **The landing page's live counters need an admin session.** `/api/admin/metrics` is admin-only, so anonymous visitors see zeros and a "sign in for live data" label rather than an error. A public stats endpoint would be the honest fix.
- **`livesImpactedEstimate` is `units × 3`** - a presentational convention from the backend, not a measurement.
- **OpenStreetMap tiles** are for development. Their usage policy prohibits heavy traffic; move to a paid tile provider before launch and update `VITE_MAP_TILE_URL` and the CSP `img-src`.

---

## Copyright

© anilratn 2026. All rights reserved.
