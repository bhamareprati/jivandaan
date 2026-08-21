# Changelog

## Phase F1-F5 - Frontend complete

Built to Document 1 (*Frontend Development - Master Prompt & Implementation Blueprint*).
Verified: production build green, `tsc` clean, and all 13 routes rendered in a real headless browser against live authenticated sessions with **zero runtime errors**.

### F1 - Design system foundation
- Vite + React 18 + TypeScript + Tailwind; Outfit and Inter via the Google Fonts CDN.
- Full theme in `tailwind.config.ts`: palette, 12/14/16/20/28/40/56 type scale, 16px card radius, layered shadow scale. No component hard-codes a hex value or an off-scale size.
- Accessible ink variants added alongside the brand palette - `#E63946` measures 4.17:1 on white and fails AA for body text, so `crimson.ink #C1121F` (6.22:1) carries text and white-labelled fills, `emerald.ink #1F7A6F` for emerald text, `crimson.light #FF6B6B` (6.43:1) for dark mode.
- Base kit: GlassCard, Surface, Button (6 variants), Field/Input/Select/Textarea, BloodGroupChip, UrgencyBadge, Skeleton, EmptyState, ErrorState, StatTile.
- Motion primitives: FadeIn, StaggerList, CountUp, PulseRing, PageTransition.
- 3D hero built in isolation first: low-poly lathe blood drop with a glass transmission material, lazy-loaded into its own ~1MB chunk, with three independent kill switches (reduced motion, viewport < 768px, ≤ 4 cores) falling back to a gradient-mesh poster.

### F2 - Auth and role shells
- Typed API client and endpoint layer transcribed from `docs/backend-contract.md`; nothing outside `api/` builds a URL.
- Role-switcher auth screens - the switcher drives both the registration field set and the login payload's `role`, which the backend needs to pick the right identity collection.
- Three genuinely different shells: donor (mobile-first, bottom tab bar), bank/hospital (persistent sidebar, denser), admin (densest, command bar).
- Route guards, glass toasts, skeleton set, dark mode on Dark Slate Navy.

### F3 - Donor experience
- Eligibility ring: hand-built animated SVG `stroke-dashoffset`, three states (eligible / mid-window / never donated).
- Impact counters that animate on mount and count from the previous value on live updates rather than restarting from zero.
- Feed driven by `canDonateTo`, not `compatibleDonorsFor` - verified an O− donor sees all eight groups and an exact-match badge.
- Digital pass: signed QR on a solid white plate with **no glass behind it** (the glass treatment would look on-brand and quietly break the scanner), timeline, milestone badges.

### F4 - Bank and emergency flow
- Live 8-group stock matrix with animated rings, colour-coded and **stated in words** (Healthy / Low stock / Out of stock) so status never depends on colour alone.
- Expiry radar with severity ramp; low-stock strip; reconcile action.
- Kanban queue by urgency with the Critical column pulsing; actions come from the server's `nextStatuses`, so an illegal transition is unreachable rather than merely rejected; live substitute hints from the compatibility service.
- Check-in with camera QR scanner **and** manual entry as equal paths - permission denial is a normal outcome, not an error.
- Five-step request form where urgency colours the surface live; tracker polling every 5s that **stops** on a terminal status.

### F5 - Search, admin and polish
- Map search with a slider snapping to 5/10/25 km, radius circle, custom pins, and graceful fallback to city search when geolocation is declined.
- Admin console: KPIs, and Recharts **only here** - the stock gauges stay hand-built SVG per Doc 1 §2.3.
- Verification queue (rejection requires a reason) and a server-paginated append-only audit log.
- Reduced motion handled in three places: `MotionConfig reducedMotion="user"`, a CSS media query, and `useReducedMotion()` for count-ups and the 3D scene.
- Skip link, visible focus rings everywhere, `aria-live` on the tracker, `aria-describedby` on form errors, wide tables scrolling inside their own container.

### Security
- **Access token held in memory only** - never localStorage or sessionStorage. Sessions survive reload via the backend's httpOnly cookie, so XSS cannot steal a durable credential.
- **CSRF guard added to the backend**: cookie-authenticated writes must carry `X-Requested-With`, which a cross-site page cannot set without a preflight the CORS allowlist refuses. Bearer-authenticated writes are exempt because they are not forgeable. Verified 403 / 201 / 201 across the three cases.
- `COOKIE_SAMESITE` env so a cross-origin deployment is possible without weakening the default.
- CSP in `index.html` plus a real header set in `public/_headers` (frame-ancestors cannot be expressed in a meta tag), `X-Frame-Options`, `Permissions-Policy` granting only camera and geolocation.
- Vite proxies `/api` so development is same-origin: no CORS relaxation, SameSite=Lax intact.
- Route guards documented as UX rather than a security boundary; the server enforces independently.
- No `dangerouslySetInnerHTML` anywhere; donor-pass QR treated as a credential.
- **`npm audit` clean on both packages** - upgraded `node-cron` to v4 (vulnerable `uuid`) and `react-router-dom` to v7 (SSR hydration advisory).

### Infrastructure
- Connected to MongoDB Atlas. Two problems found and fixed along the way:
  - Node's configured nameserver is `127.0.0.1` and refuses SRV lookups, so `mongodb+srv://` failed with `querySrv ECONNREFUSED`. Added a `DNS_SERVERS` override in `config/db.js`.
  - The obvious workaround - listing the shard hosts directly - bypasses the SRV name Atlas uses for SNI routing on shared tiers, and surfaced later as an intermittent `tlsv1 alert internal error`. The SRV form plus the DNS override is the correct fix.

### Known limitations
- Landing-page counters read `/api/admin/metrics`, which is admin-only, so anonymous visitors see zeros rather than an error. A public stats endpoint would be the honest fix.
- Marker clustering is a simple in-house pin renderer, adequate for tens of banks.
- OpenStreetMap tiles are development-only under their usage policy.

---

## Phase B1-B5 - Backend complete

Built to Document 2 (*Backend Development - Master Prompt & Implementation Plan*).
Verified: `npm run verify` 53/53 · `npm test` 84/84 · full donor-to-fulfilment flow exercised against a live server.

### B1 - Foundation
- Express + Mongoose scaffold in MVC layout; `.env`-driven config that fails fast on missing secrets and refuses development-looking secrets in production.
- `GET /api/health`, centralised error handler translating Mongoose/driver errors, 404 handler, morgan logging.
- One response envelope (`{ success, message, data | errors }`) used by every controller.
- Seven models with collection names pinned explicitly: donors, blood-banks, hospitals, admins, bloodrequests, donationhistories, activitylogs.
- `age` and `nextEligibleDate` virtuals on donors; `expiryDate` auto-set to `donationDate + 42 days`; bcrypt pre-save hook that cannot double-hash.

### B2 - Auth & RBAC
- Register (role-aware), login, logout, forgot/reset password, `GET /api/auth/me`.
- Cross-collection email uniqueness; login takes `role` to select the identity collection.
- `requireAuth`, `requireRole`, `requireSelf`, `requireBankOwner`, `requireVerifiedBank`.
- Sessions backed by connect-mongo rather than MemoryStore.

### B3 - Core domain logic
- `compatibility` - ABO/Rh matrix authored once and transposed, so the two directions cannot drift; substitute ranking that preserves rare stock.
- `eligibility` - 56-day interval on UTC day boundaries, enforced on the check-in write path, not just displayed.
- `inventory` - check-in, FEFO consumption, manual adjustment, reconciliation. Ledger and cached counts written together in one transaction.
- `expiryRadar` - 42-day sweep (scheduled and lazily on read), near-expiry radar, low-stock flagging.
- `requestLifecycle` - the status machine and tracker stepper payload; the only place a transition is authorised.
- `notification` - urgency hook behind a swappable provider interface, non-blocking by construction.
- All donor, bank and request routes.

### B4 - Admin, search & logging
- Admin metrics as a single `$facet` aggregation; verification queue; append-only audit log.
- Geospatial search: `$geoNear` with a city/pincode fallback, `matchedBy` on every result, verified banks only.
- One audit entry per state-changing action across every controller.

### B5 - Hardening
- Zod validation on every route, returning field-keyed 422s.
- Rate limiting on auth and request creation; helmet, CORS allowlist, in-house NoSQL-injection and parameter-pollution guard.
- Deterministic idempotent seed shaped so every frontend screen has real data at every state.
- Postman collection (38 requests), `npm run verify` harness, `npm run routes` for contract diffing, `npm run db` for a zero-install MongoDB.

### Contract decisions applied
Documented in `docs/IMPLEMENTATION_PLAN.md` §2 and reflected in `docs/backend-contract.md`:
D-1 status enum extended · D-2 hospitals collection + refPath requester · D-3 admins collection
D-4 bank verification fields · D-5 GeoJSON coordinates · D-6 ledger as source of truth
D-7 role-scoped login · D-11 two-step password reset · D-12 signed donor-pass QR
D-13 both compatibility directions · D-14 security baseline

### Bugs found and fixed during verification
- `refPath` resolves against Mongoose **model** names, not collection names - populating a request failed with `MissingSchemaError`. Model names now equal collection names throughout.
- `assertCanView` compared a *populated* requester document against an id, so requesters were denied their own requests.
- Token revocation compared JWT `iat` (one-second resolution) against a millisecond timestamp, so a password reset within the same second did not revoke. Replaced with an explicit `tokenVersion` counter.
- Seeding as a child process from a parent holding a Mongoose connection deadlocked; the seed is now importable and runs in-process.

### Not built (by design)
- Real SMS/push delivery - interface and console implementation ship; swap the provider at deploy.
- WebSockets - the frontend polls; Socket.IO is an optional post-QA addition needing no contract change.

---

## Copyright

© anilratn 2026. All rights reserved.
