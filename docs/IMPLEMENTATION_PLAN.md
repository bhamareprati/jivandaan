# जीवनदान · JIVANDAN - Master Implementation Plan

**Real-time blood donation & inventory network**

Derived from Documents 1-4 (Frontend Blueprint, Backend Plan, Build Sequence Guide, Supporting Documents). Nothing here replaces those documents - this consolidates them into an executable, gated, phase-by-phase build order and resolves the points where the four documents are silent or disagree.

---

## 0. How to use this plan

1. **Read §2 (Decisions & Gap Resolutions) first and sign off on it.** Doc 2 §5 ends with *"Ask me before deviating from the schema or route map."* §2 is that conversation, pre-answered. Every item is either a genuine conflict between the documents or a hole the build cannot proceed past. Confirm or override each one **before** Phase B1.
2. **Build in the order given.** Backend fully, then frontend (Doc 3 §1: backend first, non-negotiable). Never mix a backend and a frontend concern in one prompt (Doc 3 §3.3).
3. **Each phase has an Exit Gate.** Do not start the next phase until every gate item passes. Doc 3 §3.3: *"catching a schema mistake at Step 2 is cheap; catching it at Step 9 means re-touching the frontend too."*
4. **Each phase ships a paste-ready prompt.** Hand that block to Claude Code / Antigravity - not the whole master prompt (Doc 3 §3.1).
5. **After each phase, update `/docs/backend-contract.md` and `CHANGELOG.md`** so the contract stays the single source of truth across sessions (Doc 3 §3.1, §3.2).

### Phase map at a glance

| # | Phase | Doc 3 Step | Depends on | Exit gate summary |
|---|---|---|---|---|
| P0 | Setup & Contract Freeze | - | - | Node 18+, Mongo reachable, docs in repo |
| B1 | Backend Foundation | 1 | P0 | `GET /api/health` 200, all models load |
| B2 | Auth & RBAC | 2 | B1 | 4 roles register/login; donor → admin route = 403 |
| B3 | Core Domain Logic | 3 | B2 | Inventory, requests, compatibility, eligibility, radar verified |
| B4 | Admin, Search & Logging | 4 | B3 | Admin routes + geo search + every mutation logged |
| B5 | Hardening & Seed | 5 | B4 | Every route in Appendix A1 green in Postman; seed data live |
| F1 | Design System Foundation | 6 | B5 | Tokens + base kit + 3D hero at ≥50 fps in isolation |
| F2 | Auth & Role Shells | 7 | F1 | Login as all 4 roles against the real API |
| F3 | Donor Experience | 8 | F2 | Dashboard + digital pass render live donor data |
| F4 | Bank & Emergency Flow | 9 | F3 | Stock matrix, queue, request form, live tracker |
| F5 | Search, Admin & Polish | 10 | F4 | Map search, admin console, a11y/motion/responsive pass |
| Q | End-to-End QA | 11 | F5 | Full donor → fulfilment flow passes Doc 4 §4 |
| D | Deployment | - | Q | Production smoke test passes |
| R | Realtime (optional) | - | Q | Push replaces polling with no contract change |

---

## 1. Consolidated source-of-truth digest

### 1.1 Stack (frozen)

**Backend** - Node.js 18+, Express.js, MongoDB + Mongoose, bcryptjs, JWT + express-session, RBAC middleware, MVC layout (`models/ controllers/ routes/ middleware/ config/ utils/`), morgan request logging, `activitylogs` audit collection.

**Frontend** - React (Vite) + TypeScript, Tailwind CSS, Framer Motion, React Three Fiber + drei, Recharts, React Router, React Hook Form + Zod, lucide-react icons.

### 1.2 Roles (4)

`donor` · `blood-bank` · `hospital` (requester) · `admin`

### 1.3 Entity relationships (Doc 4 §3)

```
Donor      (1) ──< (many) DonationHistory (many) >── (1) BloodBank
Donor      (1) ──< (many) BloodRequest        [as requester]
Hospital   (1) ──< (many) BloodRequest        [as requester]   <- see D-2
BloodBank  (1) ──< (many) BloodRequest        [as fulfiller]
BloodBank  (1) ──  (1)    Inventory Map [8 blood groups]
AnyActor   (1) ──< (many) ActivityLog
```

### 1.4 The eight blood groups (one canonical list, used everywhere)

`A+  A-  B+  B-  AB+  AB-  O+  O-`

### 1.5 Fixed business rules

| Rule | Value | Source |
|---|---|---|
| Donor re-donation interval | **56 days** from `lastDonationDate` | Doc 2 §5.3 |
| Unit shelf life | **42 days** from `donationDate` | Doc 2 §3.4 |
| Expiry radar window | units expiring within **7 days** (configurable) | Doc 2 §5.2 |
| Low-stock flag | below a configurable threshold per group | Doc 2 §5.2 |
| Search radii offered in UI | **5 / 10 / 25 km** | Doc 1 §3 |
| Urgency levels | `low` `medium` `high` `critical` | Doc 2 §3.3 |
| Critical request | fires the notification hook | Doc 2 §5.4 |

---

## 2. Decisions & Gap Resolutions

> These are the places where the four documents conflict, or are silent on something the build cannot proceed without. Each has a **recommended resolution**. Override any of them before Phase B1 and update this section.

### D-1 · Request status enum conflict - must fix

Doc 2 §3.3 declares `status: enum [pending, approved, rejected, fulfilled]`. Doc 1 §3 requires a tracker stepper `Submitted → Review → Approved → Dispatched → Fulfilled`. Doc 2 §4.4 requires `PATCH /api/requests/:id/status` to advance `review → approved → dispatched → fulfilled`.

Two states (`review`, `dispatched`) exist in the routes and the UI but not in the schema enum. As written, the stepper cannot render and the PATCH route cannot work.

**Resolution - extend the enum and freeze this mapping:**

| DB value | UI stepper label | Terminal? |
|---|---|---|
| `pending` | Submitted | no |
| `under_review` | Review | no |
| `approved` | Approved | no |
| `dispatched` | Dispatched | no |
| `fulfilled` | Fulfilled | **yes** |
| `rejected` | Rejected | **yes** |
| `cancelled` | Cancelled (by requester) | **yes** |

**State machine** (enforced server-side; Doc 4 §4.1 requires invalid jumps be rejected):

```
pending ──> under_review ──> approved ──> dispatched ──> fulfilled
   |             |              |
   +--> rejected +--> rejected  +--> rejected
   |
   +--> cancelled     (requester only, while pending | under_review)
```

- Any transition not on this graph returns `409 Conflict` with `{ success:false, message:"Invalid status transition: pending -> fulfilled" }`.
- `pending → fulfilled` is the explicit negative test in Doc 4 §4.1.
- `cancelled` appears in no document - include it or drop it, but decide now.

### D-2 · Hospital role has no home - must fix

Doc 2 names four roles including `hospital/requester`, but defines only five collections (`donors`, `blood-banks`, `bloodrequests`, `donationhistories`, `activitylogs`), sets `BloodRequest.requester → donors`, and limits `ActivityLog.userModel` to `donors | blood-banks | admins`. A hospital can neither be stored nor be a requester.

**Resolution (recommended):** add a `hospitals` collection and make `requester` a dynamic reference.

```js
requester:      { type: ObjectId, required: true, refPath: 'requesterModel' },
requesterModel: { type: String, required: true, enum: ['donors', 'hospitals'] },
```

`hospitals` mirrors the blood-bank contact/location shape: `name, email (unique), password, contact, address, city, state, pincode, location (GeoJSON), registrationNumber, role:'hospital', verificationStatus`. Also extend `ActivityLog.userModel` to `['donors','blood-banks','hospitals','admins']`.

**Fallback (lower effort, uglier):** register hospitals into the `donors` collection with `role:'hospital'` and a null blood group, keeping the documented `requester → donors` ref intact. Choose this only if you want zero schema deviation.

### D-3 · The `admins` collection is referenced but never specified - must fix

`ActivityLog.userModel` includes `admins`, and Doc 2 §4.5 defines four admin routes, but no Admin schema exists.

**Resolution:** add an `admins` collection - `name, email (unique), password (bcrypt), role:'admin', isSuperAdmin (Boolean), lastLoginAt`. Seed exactly one super-admin from `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`). Never expose admin creation through `/api/auth/register`.

### D-4 · Bank verification needs schema fields - must fix

Doc 2 §4.5 defines `GET /api/admin/banks/pending` and `PATCH /api/admin/banks/:id/verify`, but the Blood Bank schema (§3.2) has no verification field.

**Resolution:** add to `blood-banks` - `verificationStatus: enum ['pending','verified','rejected'] default 'pending'`, `licenseNumber: String`, `verifiedBy: ObjectId → admins`, `verifiedAt: Date`, `rejectionReason: String`.

Business rule: an unverified bank **cannot** appear in `/api/banks` search results and **cannot** approve requests. Gate this with a `requireVerifiedBank` middleware.

### D-5 · Geospatial search needs coordinates - must fix

Doc 2 §4.3 lists `GET /api/banks` as "geospatial search by city/radius"; Doc 2 Phase B4 allows "lat/lng + radius **if coordinates are captured**"; Doc 1 §3 requires a radius slider at 5/10/25 km. A radius slider is impossible without coordinates.

**Resolution:** capture coordinates on `blood-banks` and `hospitals`.

```js
location: {
  type:        { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], default: undefined }   // [longitude, latitude]
}
// schema.index({ location: '2dsphere' })
```

Query with `$geoNear` / `$near` plus `$maxDistance` in **metres** (5000 / 10000 / 25000). Fall back to exact `city` / `pincode` match when a record has no coordinates, and return `matchedBy: "radius" | "city"` so the UI can say which. Extend the query contract to `?lat=&lng=&radius=&city=&bloodGroup=&page=&limit=`.

### D-6 · Inventory count vs. donation ledger can drift - must fix

`blood-banks.inventory` is a `Map<String,Number>` of live counts. `donationhistories` is a per-donation ledger carrying `expiryDate`. Nothing in the documents connects them, so an expiring unit would be flagged by the radar (Doc 2 §5.2) while the inventory map keeps counting it forever.

**Resolution - the ledger is truth, the map is a denormalised cache:**

1. Add `status: enum ['available','reserved','used','expired'] default 'available'` and `unitsRemaining: Number` to `donationhistories`.
2. Every mutation touches **both** in one operation:
   - **Check-in** - insert a ledger row (`available`) *and* `$inc` the bank's inventory map for that group.
   - **Request fulfilled** - consume available rows oldest-expiry-first (FEFO), mark them `used`, `$inc` the map down.
   - **Expiry sweep** - mark rows `expired`, `$inc` the map down, write an ActivityLog entry.
3. Use a MongoDB **transaction** for each pair. Transactions require a replica set - Atlas has one by default, a local standalone `mongod` does **not**. Either run local Mongo as a single-node replica set (`mongod --replSet rs0`, then `rs.initiate()`) or set `USE_TRANSACTIONS=false` and fall back to ordered writes with a compensating rollback. Decide at P0.
4. Ship a `reconcileInventory(bankId)` utility that recomputes the map from the ledger, plus an admin route to trigger it. This is the safety net.
5. Run the expiry sweep on a schedule (`node-cron`, daily 02:00) **and** lazily on every `/expiry-radar` read, so results are correct even when the cron is not running.

### D-7 · Email uniqueness is only per-collection - must fix

Credentials live in three or four separate collections, each with its own unique index on `email`. The same address can therefore register as a donor *and* a blood bank, and `POST /api/auth/login` has no way to know which record to check.

**Resolution:** the login screen already has a **role switcher** (Doc 1 §3) - use it.

- `POST /api/auth/login` accepts `{ email, password, role }`; `role` selects the collection.
- `POST /api/auth/register` checks the email against **all** identity collections before creating, returning `409` on any hit. This is what makes Doc 4 §4.1's *"duplicate email is rejected"* actually hold.
- *Optional hardening:* an `authindex` collection `{ email (unique), role, refId }` written in the same transaction as registration, making both the uniqueness check and login O(1).

### D-8 · "Live" is specified but no transport is - decide now

Doc 1 demands a "live" request tracker, "live impact counters", a "live stock matrix", and an "urgent requests ticker". Doc 2 defines no WebSocket, SSE, or push mechanism.

**Resolution - Phase F: HTTP polling** via TanStack Query `refetchInterval`. Zero contract change, works everywhere.

| Surface | Interval |
|---|---|
| Request tracker `/request/:id/track` | 5 s (stop once status is terminal) |
| Bank stock matrix + request queue | 15 s |
| Donor urgent feed | 30 s |
| Landing impact counters | 60 s |

**Phase R (optional, post-QA):** add Socket.IO rooms (`request:<id>`, `bank:<id>`) emitting on the same events that already write ActivityLog entries. Because the REST contract is unchanged, this is a drop-in swap of `refetchInterval` for socket-driven cache invalidation.

### D-9 · Client libraries not named in Doc 1's stack - approve these additions

Doc 1 §5 says *"Ask me before inventing new API endpoints not in the contract."* These add no endpoints; they are client-side libraries the specified screens cannot be built without.

| Need | Recommended | Why |
|---|---|---|
| Server state, loading/empty/error, polling | **TanStack Query v5** | Doc 1 requires distinct loading/empty/error states and live data on every screen; hand-rolling this is the main source of frontend bugs |
| Map view (`/search`) | **react-leaflet + Leaflet** | Doc 1 names a map but no library; Leaflet needs no API token (Mapbox does) |
| Marker clustering | **leaflet.markercluster** | Doc 1 §4 lists "MapPin cluster" |
| QR generation (donor pass) | **qrcode.react** | Doc 1 §3 `/donor/pass` |
| QR scanning (bank check-in) | **@zxing/browser** or **html5-qrcode** | Doc 1 §3 `/bank/checkin` |
| Date maths (56-day, 42-day displays) | **date-fns** | tree-shakeable, no moment.js bulk |
| Toasts | **sonner**, restyled to the glass spec | Doc 1 §4 NotificationToast |

### D-10 · Sessions and JWT overlap - clarify

Doc 2 §2 specifies *"JWT for API auth + express-session for server-rendered views."* The frontend in Doc 1 is a Vite SPA - there are no server-rendered views.

**Resolution:** JWT is the live auth path for every `/api/*` route. Keep `express-session` wired (it is in the spec and useful for the admin console later) but back it with **`connect-mongo`**, not the default MemoryStore, which leaks memory and drops sessions on restart. Store the JWT in memory plus refresh from an `httpOnly` cookie, or in `localStorage` if you accept the XSS trade-off - decide at F2 and apply it consistently.

### D-11 · `reset-password` has no delivery channel - clarify

`POST /api/auth/reset-password` (Doc 2 §4.1) needs to get a token to a human.

**Resolution:** two steps behind the same `NotificationService` interface as the urgency hook (Doc 2 §5.4). `POST /api/auth/forgot-password` issues a token (store the **hash**, 15-minute expiry, single use) and dispatches it; `POST /api/auth/reset-password` consumes `{ token, newPassword }`. The default implementation logs to the console; swap in a real provider at Phase D.

### D-12 · The donor-pass QR must be verifiable - clarify

`GET /api/donors/me/pass` returns a "QR payload" and `/bank/checkin` scans it. If the QR is just a raw donor id, anyone can mint one.

**Resolution:** the payload is a signed JWT `{ typ:'donor-pass', sub: donorId, bg: bloodGroup, jti }`, signed with `JWT_SECRET`, long-lived (1 year) so a printed pass keeps working. `POST /api/banks/:id/checkin` verifies the signature, re-reads the donor from the database (never trusting claims in the token), then checks 56-day eligibility before recording anything. Optionally keep a `revokedPassJtis` list for lost passes.

### D-13 · Compatibility runs in two directions - get this right

The same matrix answers two different questions, and inverting it silently breaks the donor feed.

- `compatibleDonorsFor(recipientGroup) → string[]` - *"a patient needs AB+, which units may we substitute?"* Drives `GET /api/requests/match/:bloodGroup` and the bank's substitute suggestions.
- `canDonateTo(donorGroup) → string[]` - *"I am O−, which open requests can I answer?"* Drives `GET /api/donors/feed`.

The second is the transpose of the first. Implement one table (Appendix A4), derive the other, and unit-test both directions.

### D-14 · Security baseline, not specified anywhere - add at B5

`helmet`, a CORS allowlist (dev `http://localhost:5173`; prod the deployed origin only, per Doc 4 §5), `express-mongo-sanitize`, `hpp`, and a JSON body-size limit. No document mentions these; a public health platform should not ship without them.

### D-15 · Recharts vs. the "no static bar chart" rule - clarify

Doc 1 §2.3 says stock levels must be *"animated progress rings/bars (SVG stroke-dashoffset), not a static Chart.js bar"*, while Doc 1 §5 lists Recharts in the stack.

**Resolution:** these are different surfaces. Hand-built animated SVG rings/bars for the **8-group stock matrix** and any single-value gauge; Recharts only for the **admin analytics** (trend lines, demand bars) in Doc 1 §4's `ChartCard`. Do not let Recharts creep into the stock matrix.

---

## 3. Repository layout

Monorepo, two siblings (Doc 4 §2: *"monorepo is simpler for solo/small-team AI-assisted development"*).

```
jivandan/
├── docs/
│   ├── IMPLEMENTATION_PLAN.md      <- this file
│   ├── backend-contract.md         <- Doc 2 §3 + §4, kept live (Doc 3 §3.1)
│   ├── design-system.md            <- Doc 1 §2, kept live (Doc 3 §3.1)
│   └── qa-checklist.md             <- Doc 4 §4
├── backend/
│   ├── src/
│   │   ├── config/        db.js, env.js, constants.js
│   │   ├── models/        donor, bloodBank, hospital, admin,
│   │   │                  bloodRequest, donationHistory, activityLog
│   │   ├── controllers/   auth, donor, bank, request, admin
│   │   ├── routes/        one router per controller + index.js
│   │   ├── middleware/    auth.js, rbac.js, validate.js,
│   │   │                  errorHandler.js, rateLimit.js, notFound.js
│   │   ├── services/      compatibility, eligibility, inventory,
│   │   │                  expiryRadar, notification, activityLogger
│   │   ├── validators/    zod schemas per route
│   │   ├── utils/         apiResponse.js, ApiError.js, paginate.js, jwt.js
│   │   ├── jobs/          expirySweep.js
│   │   ├── app.js
│   │   └── server.js
│   ├── tests/
│   ├── scripts/seed.js
│   ├── postman/Jivandan.postman_collection.json
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── api/           client.ts + one module per resource
│   │   ├── components/    ui/ (base kit), motion/, three/, charts/, layout/
│   │   ├── features/      auth/ donor/ bank/ request/ search/ admin/
│   │   ├── hooks/         useAuth, useReducedMotion, useCountUp, useGeolocation
│   │   ├── lib/           bloodGroups.ts, urgency.ts, format.ts, queryClient.ts
│   │   ├── routes/        router.tsx, guards
│   │   ├── styles/        tokens.css, globals.css
│   │   └── types/         api.d.ts (mirrors the contract)
│   ├── tailwind.config.ts
│   └── .env
├── CHANGELOG.md
└── README.md
```

**Naming discipline (Doc 3 §3.3):** the collection names in Doc 2 are lowercase-plural (`donors`, `blood-banks`, `bloodrequests`, `donationhistories`, `activitylogs`). Pin them explicitly in each model - `mongoose.model('Donor', schema, 'donors')` - so Mongoose's pluraliser cannot rename them out from under the audit log's `userModel` enum.

---

## 4. Phase P0 - Setup & Contract Freeze

**Source:** Doc 4 §2, Doc 3 §3.1

### Tasks

1. Install Node.js 18+ and confirm with `node -v`.
2. Provision MongoDB - local install or a free Atlas cluster - and copy the connection string. **If local, decide D-6 now:** run as a single-node replica set to get transactions, or set `USE_TRANSACTIONS=false`.
3. `git init` and create the layout in §3 with `backend/` and `frontend/` as siblings.
4. Write `backend/.env` (Appendix A6) and `frontend/.env` with `VITE_API_BASE_URL=http://localhost:5000`.
5. Install a REST client - Postman, Insomnia, or the VS Code Thunder Client extension.
6. **Copy the reference documents into the repo** (Doc 3 §3.1) so the AI can re-read them every session instead of you re-pasting:
   - `docs/backend-contract.md` - Doc 2 §3 (schemas) + §4 (route map), amended by every "must fix" in §2 above.
   - `docs/design-system.md` - Doc 1 §2 (palette, typography, motion, glass rules) + §4 (component inventory).
   - `docs/qa-checklist.md` - Doc 4 §4.
7. Create `CHANGELOG.md` with a heading per phase; every phase appends to it (Doc 3 §3.2).
8. **Sign off §2.** Write your decisions into `docs/backend-contract.md` - it is now frozen for the duration of the frontend build (Doc 3 §1 rule of thumb).

### Exit gate

- [ ] `node -v` reports 18 or higher
- [ ] The Mongo connection string connects (`mongosh "$MONGO_URI" --eval 'db.runCommand({ping:1})'`)
- [ ] If transactions are required, `rs.status()` shows a healthy replica set
- [ ] `docs/backend-contract.md` and `docs/design-system.md` exist and reflect the §2 decisions
- [ ] Both `.env` files exist and are listed in `.gitignore`

---

## 5. Backend Phases

### Phase B1 - Foundation

**Doc 3 Step 1 · Doc 2 Phase B1 · Schemas from Doc 2 §3**

#### Deliverables

- Express app scaffold with the MVC folder structure, `.env`-driven config, MongoDB connection with retry, and graceful shutdown.
- `GET /api/health` returning `{ status, uptime, db: 'connected'|'disconnected', version }`.
- Morgan request logging (`dev` in development, `combined` in production).
- Centralised error-handling middleware plus a 404 handler.
- The consistent JSON envelope from Doc 2 §5 - `{ success, message, data | errors }` - implemented once in `utils/apiResponse.js` and used by every controller.
- **All seven Mongoose models** (five from Doc 2 §3, plus `hospitals` per D-2 and `admins` per D-3), with explicit collection names.

#### Model detail

**`donors`** (Doc 2 §3.1) - `name*`, `dob*` (Date), `gender*`, `bloodgroup*` (enum, the 8 groups), `contact*`, `email*` (unique, lowercased), `password*` (bcrypt), `role` (default `'donor'`), `profileImageUrl`, `lastDonationDate` (Date).
- **Virtual `age`** derived from `dob`.
- **Virtual `nextEligibleDate`** = `lastDonationDate + 56 days`, `null` when never donated.
- Pre-save hook: bcrypt-hash `password` only when modified (salt rounds 12).
- `toJSON` transform strips `password`; enable `{ virtuals: true }`.
- Optional `location` GeoJSON + 2dsphere index if you want radius-based donor search.

**`blood-banks`** (Doc 2 §3.2 + D-4 + D-5) - `name*`, `email*` (unique), `password*`, `contact*`, `city*`, `state*`, `pincode*`, `address*`, `role` (default `'blood-bank'`), `inventory: Map<String, Number>`, plus `verificationStatus`, `licenseNumber`, `verifiedBy`, `verifiedAt`, `rejectionReason`, `location` (GeoJSON, 2dsphere), `lowStockThreshold` (Number, default 10).
- Initialise `inventory` with all 8 keys at 0 so the frontend matrix never sees a missing group.

**`hospitals`** (D-2) - as described in §2 D-2.

**`admins`** (D-3) - as described in §2 D-3.

**`bloodrequests`** (Doc 2 §3.3 + D-1 + D-2) - `requester*` (refPath), `requesterModel*`, `bloodBank` (ref `blood-banks`), `bloodGroup*` (enum), `units*` (min 1), `urgency*` (enum `low|medium|high|critical`), `patientName`, `hospitalName`, `status` (the D-1 enum, default `pending`), plus `statusHistory: [{ status, changedBy, changedByModel, note, at }]` so the tracker stepper can show timestamps per step, and `fulfilledAt`, `requiredBy` (Date).
- Indexes: `{ status: 1, urgency: 1, createdAt: -1 }`, `{ bloodBank: 1, status: 1 }`, `{ bloodGroup: 1, status: 1 }`.

**`donationhistories`** (Doc 2 §3.4 + D-6) - `donor*` (ref), `bloodBank*` (ref), `bloodGroup*`, `units*`, `donationDate*` (default now), `expiryDate` (**auto = donationDate + 42 days** via pre-validate hook), plus `status` (`available|reserved|used|expired`), `unitsRemaining`, `consumedByRequest` (ref).
- Indexes: `{ bloodBank: 1, status: 1, expiryDate: 1 }` (drives the expiry radar), `{ donor: 1, donationDate: -1 }` (drives the pass timeline).

**`activitylogs`** (Doc 2 §3.5) - `user*` (ObjectId), `userModel*` (enum `donors|blood-banks|hospitals|admins`), `action*` (enum of a fixed verb list), `description`, `targetUser`, `targetModel`, `metadata` (Mixed), `ip`, `createdAt`.
- Index `{ createdAt: -1 }` and `{ user: 1, createdAt: -1 }`; the admin log endpoint is paginated over these.

#### Verification

```bash
curl -s http://localhost:5000/api/health | jq
# -> { "success": true, "data": { "status": "ok", "db": "connected", ... } }
```

Then in `mongosh`, confirm a hand-inserted donation gets `expiryDate = donationDate + 42d` and a donor document exposes `age` and `nextEligibleDate` virtuals.

#### Exit gate

- [ ] `GET /api/health` returns 200 with `db: "connected"`
- [ ] All seven models register without a schema error, under the exact collection names in §3
- [ ] Password hashing fires on create **and** on update, and never double-hashes
- [ ] `expiryDate` auto-computes to `donationDate + 42` days
- [ ] `age` and `nextEligibleDate` virtuals serialise in `toJSON`
- [ ] A thrown error anywhere returns the standard envelope, not an HTML stack trace
- [ ] `CHANGELOG.md` has a B1 entry; `docs/backend-contract.md` reflects the final schemas

#### Prompt for this phase

> Build Phase B1 of the Jivandan backend: project scaffold and data layer only. No auth, no business routes yet.
>
> Stack: Node.js 18+, Express, MongoDB + Mongoose. MVC structure: `src/models`, `src/controllers`, `src/routes`, `src/middleware`, `src/config`, `src/services`, `src/utils`.
>
> Deliver: (1) Express app with `.env`-driven config (`MONGO_URI`, `JWT_SECRET`, `SESSION_SECRET`, `PORT`, `NODE_ENV`), MongoDB connection with retry and graceful shutdown, morgan logging; (2) `GET /api/health` returning status, uptime and DB state; (3) centralised error-handling middleware and a 404 handler, both emitting the envelope `{ success, message, data | errors }` - implement that envelope once in `utils/apiResponse.js` and an `ApiError` class; (4) all seven Mongoose models exactly as specified in the attached schema section, with collection names pinned explicitly via the third argument to `mongoose.model()`.
>
> Required model behaviour: bcrypt pre-save hook (12 rounds, only when the password field is modified) on donors, blood-banks, hospitals and admins; `toJSON` strips `password`; an `age` virtual and a `nextEligibleDate` virtual (`lastDonationDate + 56 days`) on donors; `expiryDate` auto-set to `donationDate + 42 days` on donationhistories; blood-bank `inventory` initialised with all eight blood-group keys at 0; the indexes listed in the attached section.
>
> Do not invent routes beyond `/api/health`. Ask before deviating from the schema.
>
> *(attach: `docs/backend-contract.md` §3)*

---

### Phase B2 - Auth & RBAC

**Doc 3 Step 2 · Doc 2 Phase B2**

#### Deliverables

- `POST /api/auth/register` - role-aware, writing to the collection selected by `role` (`donor` / `blood-bank` / `hospital`). **Admin registration is not exposed** (D-3). Enforces cross-collection email uniqueness (D-7).
- `POST /api/auth/login` - accepts `{ email, password, role }` (D-7), returns a JWT and sets the session, and logs `lastLoginAt`.
- `POST /api/auth/logout` - clears the session and, if you adopt a denylist, revokes the token.
- `POST /api/auth/forgot-password` + `POST /api/auth/reset-password` (D-11).
- `GET /api/auth/me` - resolves the token to the current actor. *(Not in Doc 2 §4.1; add it or have the frontend call the per-role `/me` route instead. If you add it, record it in `docs/backend-contract.md`.)*
- `middleware/auth.js` - `requireAuth` verifies the JWT, loads the actor, attaches `req.user = { id, role, model, doc }`.
- `middleware/rbac.js` - `requireRole('admin')`, `requireRole('blood-bank','admin')`, plus `requireSelf` (a donor may only read their own `/me`) and `requireVerifiedBank` (D-4).
- `express-session` backed by `connect-mongo` (D-10).

#### Implementation notes

- JWT payload `{ sub, role, model }`, `expiresIn: '7d'`, issuer `jivandan`. Sign and verify only through `utils/jwt.js`.
- Login must be timing-safe about which failure occurred - return one message, `"Invalid credentials"`, for both an unknown email and a wrong password.
- Password reset stores the **hash** of the token, expires in 15 minutes, is single-use, and dispatches through `services/notification.js`.
- Registration writes an ActivityLog entry (`action: 'register'`) - Doc 2 §5.5 requires logging on every state-changing action, and registration is the first one.

#### Verification (Doc 4 §4.1)

```bash
# register one of each role
curl -X POST localhost:5000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"role":"donor","name":"Asha","dob":"1995-04-12","gender":"female","bloodgroup":"O-","contact":"9876543210","email":"asha@test.in","password":"Passw0rd!"}'

# duplicate email -> 409
# login -> token
TOKEN=$(curl -s -X POST localhost:5000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"asha@test.in","password":"Passw0rd!","role":"donor"}' | jq -r .data.token)

# protected route without a token -> 401
curl -i localhost:5000/api/donors/me
# donor token against an admin route -> 403
curl -i localhost:5000/api/admin/metrics -H "Authorization: Bearer $TOKEN"
```

#### Exit gate

- [ ] Register succeeds for donor, blood-bank and hospital; admin registration is refused
- [ ] Duplicate email is rejected **across every collection**, not just within one
- [ ] Login returns a valid JWT and sets a session cookie
- [ ] A missing or invalid token returns **401**; a valid token with the wrong role returns **403**
- [ ] `requireSelf` blocks donor A from reading donor B
- [ ] Passwords never appear in any response body or log line
- [ ] Forgot/reset password round-trips; the token is single-use and expires
- [ ] `activitylogs` contains a `register` and a `login` entry
- [ ] `CHANGELOG.md` + contract doc updated

#### Prompt for this phase

> Build Phase B2 of the Jivandan backend: authentication and role-based access control. Do not touch inventory, requests, or admin logic yet.
>
> Implement `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, and `GET /api/auth/me`.
>
> Rules: (1) register is role-aware and writes to the collection named by `role` - `donor`, `blood-bank`, or `hospital`; admin accounts are seeded only, never registered; (2) before creating any account, check the email against **all** identity collections and return 409 on a hit - per-collection unique indexes are not enough; (3) login takes `{ email, password, role }` and uses `role` to select the collection; return the same "Invalid credentials" message for unknown-email and wrong-password; (4) JWT payload `{ sub, role, model }`, 7-day expiry, signed and verified only via `utils/jwt.js`; (5) express-session backed by `connect-mongo`, not MemoryStore; (6) password reset stores the token **hash**, expires in 15 minutes, is single-use, and dispatches through a `NotificationService` interface whose default implementation logs to the console.
>
> Build `middleware/auth.js` with `requireAuth` (verifies the token, loads the actor, sets `req.user = { id, role, model, doc }`) and `middleware/rbac.js` with `requireRole(...roles)`, `requireSelf`, and `requireVerifiedBank`. Missing/invalid token → 401; wrong role → 403; both in the standard `{ success, message }` envelope.
>
> Write an `activitylogs` entry for register, login, and password reset.
>
> *(attach: `docs/backend-contract.md` §4.1 + the roles table)*

---

### Phase B3 - Core Domain Logic

**Doc 3 Step 3 · Doc 2 Phase B3 · The heart of the product**

This is where Doc 2 §5's *"first-class backend logic, not just CRUD"* is earned. Build the services first, then the controllers that call them.

#### B3.1 Services

**`services/compatibility.js`** (D-13, Appendix A4)
- `compatibleDonorsFor(recipientGroup) → string[]`
- `canDonateTo(donorGroup) → string[]`
- `findSubstitutes(bankId, recipientGroup, units)` - returns the exact group if stocked, otherwise compatible groups that *are* stocked, ranked: exact match first, then rarest-preserving order (never hand out O− when O+ would do).

**`services/eligibility.js`** (Doc 2 §5.3)
- `nextEligibleDate(lastDonationDate) = lastDonationDate + 56d`, `null` when never donated.
- `isEligible(donor) → { eligible, nextEligibleDate, daysRemaining }`, `daysRemaining = max(0, ceil((next - now)/86400000))`.
- Compute in UTC day boundaries so the countdown ring does not flicker across timezones.

**`services/inventory.js`** (D-6)
- `checkIn({ bankId, donorId, bloodGroup, units, donationDate })` - validates eligibility, writes the ledger row, `$inc`s the map, sets `donor.lastDonationDate`, logs the activity. One transaction.
- `consume({ bankId, bloodGroup, units, requestId })` - FEFO consumption, marks rows `used`, `$inc`s the map down, logs.
- `reconcile(bankId)` - recomputes the map from `available` ledger rows.

**`services/expiryRadar.js`** (Doc 2 §5.2)
- `sweepExpired(bankId?)` - marks rows past `expiryDate` as `expired` and decrements the map.
- `radar(bankId, windowDays = EXPIRY_RADAR_DAYS)` - sweeps first, then returns units expiring inside the window, grouped by blood group, sorted soonest-first, each with `daysToExpiry`.
- `lowStock(bankId)` - groups below `bank.lowStockThreshold`.

**`services/notification.js`** (Doc 2 §5.4)
- Interface: `sendSms(to, template, data)`, `sendPush(userId, template, data)`, `sendEmail(to, template, data)`.
- `ConsoleNotificationService` is the default; a provider implementation is selected by `SMS_PROVIDER_KEY` at Phase D.
- `onCriticalRequest(request)` - fires when a request is created with `urgency: 'critical'`: notifies eligible donors whose group can serve the requested group (`compatibleDonorsFor`, filtered to donors past their 56-day mark and within range) plus every verified bank holding stock. **Non-blocking** - never let a notification failure fail the request creation; fire-and-log.

**`services/activityLogger.js`** (Doc 2 §5.5)
- `log({ req, action, description, targetUser, targetModel, metadata })`, deriving actor and IP from `req.user`. Call it from every mutating controller.

#### B3.2 Routes

| Method | Route | Notes |
|---|---|---|
| GET | `/api/donors/me` | profile + `age` + eligibility block + impact stats (total donations, total units, lives-impacted estimate = units × 3) |
| PATCH | `/api/donors/me` | profile / avatar; ignores `role`, `email`, `password` |
| GET | `/api/donors/me/pass` | signed QR payload (D-12) + donation history timeline + milestone badges |
| GET | `/api/donors/feed` | open requests the donor can serve - `canDonateTo` + city/radius filter, sorted urgency desc then `createdAt` desc, paginated |
| GET | `/api/banks/:id/inventory` | all 8 groups always present, each with `units`, `isLow`, `expiringSoon` |
| PATCH | `/api/banks/:id/inventory` | manual adjustment; owner bank or admin only; logs the delta |
| POST | `/api/banks/:id/checkin` | verifies the pass JWT, enforces 56-day eligibility, calls `inventory.checkIn` |
| GET | `/api/banks/:id/expiry-radar` | `?windowDays=` override |
| POST | `/api/requests` | create; rate-limited; fires `onCriticalRequest` |
| GET | `/api/requests/:id` | full record + `statusHistory` for the stepper |
| PATCH | `/api/requests/:id/status` | D-1 state machine; on `fulfilled` calls `inventory.consume` |
| GET | `/api/requests?urgency=&bank=&status=&page=&limit=` | the bank queue |
| GET | `/api/requests/match/:bloodGroup` | `?bankId=&units=` substitute matching |

#### Implementation notes

- **Eligibility is enforced, not just displayed.** `POST /checkin` must reject a donor inside the 56-day window with `422` and the date they become eligible. Doc 4 §4.1 checks the display; the write path is what actually protects the donor.
- **Status transitions** run through one `canTransition(from, to, actorRole)` function (D-1). Only the owning bank or an admin may advance `under_review → approved → dispatched → fulfilled`; only the requester may `cancel`.
- **Fulfilment is transactional** - status change and stock consumption succeed or fail together (D-6). If stock is insufficient, reject the transition with `409` and the shortfall.
- **Every mutating controller writes an ActivityLog entry.** Doc 4 §4.1 tests this explicitly.
- **Pagination on every list route** - `?page=1&limit=20`, default 20, max 100, responding with `meta: { page, limit, total, totalPages }`.

#### Verification (Doc 4 §4.1)

```bash
# 42-day expiry from a real check-in
curl -X POST localhost:5000/api/banks/$BANK/checkin -H "Authorization: Bearer $BANK_TOKEN" \
     -H 'Content-Type: application/json' -d '{"passToken":"'$PASS'","units":1}'
# -> donationhistories row with expiryDate = donationDate + 42d, inventory O- incremented by 1

# 56-day gate: immediately check the same donor in again -> 422 with nextEligibleDate

# compatibility: request AB+ at a bank with no AB+ stock
curl "localhost:5000/api/requests/match/AB%2B?bankId=$BANK&units=2"
# -> substitutes drawn only from the 8 compatible groups, exact match ranked first

# invalid transition
curl -X PATCH localhost:5000/api/requests/$REQ/status -H "Authorization: Bearer $BANK_TOKEN" \
     -H 'Content-Type: application/json' -d '{"status":"fulfilled"}'
# from pending -> 409 Invalid status transition
```

#### Exit gate

- [ ] Check-in writes a ledger row **and** increments the inventory map, in one transaction
- [ ] `expiryDate` = `donationDate + 42d` on every check-in
- [ ] `donor.lastDonationDate` updates on check-in and the eligibility date shifts by 56 days
- [ ] Check-in inside the 56-day window is rejected with the next eligible date
- [ ] `compatibleDonorsFor` and `canDonateTo` both match Appendix A4 for all 8 groups (unit-tested)
- [ ] Substitute matching returns only stocked, compatible groups, exact match first
- [ ] Expiry radar flags units inside the window and excludes those outside it
- [ ] Low-stock flagging respects the per-bank threshold
- [ ] Fulfilling a request decrements stock FEFO; insufficient stock blocks the transition
- [ ] `pending → fulfilled` is rejected; the legal chain succeeds
- [ ] A critical request triggers the notification hook (visible in the console log)
- [ ] Every mutation above produced an `activitylogs` entry
- [ ] Every list route paginates and returns `meta`
- [ ] `CHANGELOG.md` + contract doc updated

#### Prompt for this phase

> Build Phase B3 of the Jivandan backend: core domain logic. Auth and RBAC from B2 already exist - use the existing middleware, do not rewrite it.
>
> Build these services first, each independently unit-testable:
>
> 1. `services/compatibility.js` - the standard ABO/Rh red-cell matrix. Export `compatibleDonorsFor(recipientGroup)` ("which units can this patient receive") and `canDonateTo(donorGroup)` ("which patients can this donor serve") - the second is the transpose of the first, derive it, do not hand-write it twice. Also `findSubstitutes(bankId, recipientGroup, units)` returning stocked compatible groups, exact match ranked first, and otherwise ordered so rare groups are preserved.
> 2. `services/eligibility.js` - `nextEligibleDate = lastDonationDate + 56 days`; `isEligible(donor)` returning `{ eligible, nextEligibleDate, daysRemaining }`. Compute on UTC day boundaries.
> 3. `services/inventory.js` - `checkIn`, `consume` (first-expiring-first-out), and `reconcile`. The `donationhistories` ledger is the source of truth and the blood-bank `inventory` map is a denormalised cache: every mutation must update **both** inside one MongoDB transaction (respect a `USE_TRANSACTIONS` env flag with an ordered-write fallback). `checkIn` also sets `donor.lastDonationDate`.
> 4. `services/expiryRadar.js` - `sweepExpired` (mark past-expiry rows `expired` and decrement the map), `radar(bankId, windowDays)` (sweep first, then return units expiring within the window grouped by blood group with `daysToExpiry`), and `lowStock(bankId)` against the bank's `lowStockThreshold`.
> 5. `services/notification.js` - an interface with `sendSms`/`sendPush`/`sendEmail` and a console implementation, plus `onCriticalRequest(request)` fired when a request is created at `critical` urgency. It must be non-blocking: a notification failure must never fail request creation.
> 6. `services/activityLogger.js` - one `log()` helper called from every mutating controller.
>
> Then build the routes in the attached route map exactly as named. Requirements on all of them: Zod input validation, the RBAC middleware appropriate to the role, the `{ success, message, data | errors }` envelope, and `?page=&limit=` pagination with a `meta` block on every list endpoint.
>
> Enforce the request status state machine server-side through a single `canTransition(from, to, actorRole)` function: `pending → under_review → approved → dispatched → fulfilled`, with `rejected` reachable from the first three and `cancelled` available to the requester while pending or under review. Any other transition returns 409. Advancing to `fulfilled` must consume stock in the same transaction as the status change and must fail with 409 if stock is insufficient.
>
> Enforce the 56-day rule on the check-in write path, not just in the display - reject an ineligible donor with 422 and their next eligible date.
>
> *(attach: `docs/backend-contract.md` §4.2-4.4 + the status machine table)*

---

### Phase B4 - Admin, Search & Logging

**Doc 3 Step 4 · Doc 2 Phase B4**

#### Deliverables

| Method | Route | Notes |
|---|---|---|
| GET | `/api/admin/metrics` | KPIs - total donors, verified/pending banks, requests by status and urgency, units in stock by group, units expiring in 7 days, donations per week (trend series for Recharts), fulfilment rate, median time-to-fulfil |
| GET | `/api/admin/banks/pending` | paginated verification queue |
| PATCH | `/api/admin/banks/:id/verify` | `{ action: 'approve' \| 'reject', reason? }`; sets `verificationStatus`, `verifiedBy`, `verifiedAt`; notifies the bank; logs |
| GET | `/api/admin/logs` | paginated audit log, filterable by `?user=&action=&from=&to=` |
| GET | `/api/banks` | geospatial search (D-5) |

#### Implementation notes

- **`/api/admin/metrics` must be a small number of aggregation pipelines, not a loop of `find()` calls.** This endpoint is polled by the admin dashboard; write it with `$facet` so one round-trip returns every KPI.
- **Geospatial search (D-5):** `$geoNear` when `lat`/`lng` are supplied, exact `city`/`pincode` match otherwise, returning `matchedBy` either way. Filter to `verificationStatus: 'verified'` (D-4). Support `?bloodGroup=` to return only banks stocking it, and include `distanceMeters` in each result so the UI can sort and label.
- **Audit log is append-only.** No update or delete route, ever - that is the point of an audit log.
- Back-fill: confirm every mutating controller written in B2 and B3 calls `activityLogger.log`. Grep for `findOneAndUpdate`, `save(`, `deleteOne`, `insertMany` and check each call site.

#### Verification

```bash
curl -s "localhost:5000/api/banks?lat=19.0760&lng=72.8777&radius=10000" -H "Authorization: Bearer $T" | jq '.data[] | {name, distanceMeters, matchedBy}'
curl -s "localhost:5000/api/admin/metrics" -H "Authorization: Bearer $ADMIN" | jq
curl -s "localhost:5000/api/admin/logs?page=1&limit=20&action=verify_bank" -H "Authorization: Bearer $ADMIN" | jq '.meta'
```

#### Exit gate

- [ ] All four admin routes return correct data and are **admin-only** (donor/bank tokens → 403)
- [ ] Radius search returns banks inside 5/10/25 km and excludes those outside; `distanceMeters` is present and ascending
- [ ] Banks without coordinates still surface via city/pincode with `matchedBy: "city"`
- [ ] Unverified banks never appear in search results
- [ ] Verifying a bank flips `verificationStatus`, records `verifiedBy` + `verifiedAt`, notifies, and logs
- [ ] `/api/admin/logs` paginates and filters; there is no route that mutates a log
- [ ] Every mutating endpoint across B2-B4 produces exactly one log entry per action (no duplicates, no gaps)
- [ ] `/api/admin/metrics` responds in well under a second against seed-scale data
- [ ] `CHANGELOG.md` + contract doc updated

#### Prompt for this phase

> Build Phase B4 of the Jivandan backend: admin endpoints, geospatial search, and audit-log completeness.
>
> Routes: `GET /api/admin/metrics`, `GET /api/admin/banks/pending`, `PATCH /api/admin/banks/:id/verify`, `GET /api/admin/logs`, and `GET /api/banks`. All four `/api/admin/*` routes are admin-only via the existing `requireRole('admin')`.
>
> `/api/admin/metrics` returns platform KPIs in **one** aggregation using `$facet` - total donors, banks by verification status, requests grouped by status and by urgency, total units in stock per blood group, units expiring within 7 days, a donations-per-week trend series, fulfilment rate, and median time-to-fulfil. It is polled by the dashboard, so it must not fan out into many separate queries.
>
> `PATCH /api/admin/banks/:id/verify` takes `{ action: 'approve' | 'reject', reason? }`, sets `verificationStatus`/`verifiedBy`/`verifiedAt`/`rejectionReason`, notifies the bank through the existing NotificationService, and writes an activity log.
>
> `GET /api/admin/logs` is paginated and filterable by `user`, `action`, and a `from`/`to` date range. The audit log is append-only - do not add any route that updates or deletes a log entry.
>
> `GET /api/banks` supports `?lat=&lng=&radius=&city=&pincode=&bloodGroup=&page=&limit=`. Use `$geoNear` against the 2dsphere index when coordinates are supplied (radius in metres - the UI offers 5000/10000/25000) and fall back to exact city/pincode matching otherwise. Return `matchedBy: "radius" | "city"` and `distanceMeters` on every result, sorted nearest-first. Only banks with `verificationStatus: 'verified'` may appear.
>
> Finally, audit every mutating controller written so far and confirm each one calls `activityLogger.log` exactly once with actor, action, description, targetUser, and metadata. Report any that were missing it.
>
> *(attach: `docs/backend-contract.md` §4.5)*

---

### Phase B5 - Hardening, Seed & Verification

**Doc 3 Step 5 · Doc 2 Phase B5 · The gate before any frontend work**

#### Deliverables

1. **Validation on every route** - Zod schemas in `validators/`, applied through one `validate(schema)` middleware covering `body`, `params`, and `query`. Failures return `422` with a field-keyed `errors` array the frontend can map straight onto React Hook Form.
2. **Rate limiting** (Doc 2 Phase B5) - `express-rate-limit`: `/api/auth/*` 10 requests / 15 min per IP; `POST /api/requests` 20 / hour per account; a global default of 300 / 15 min.
3. **Security baseline** (D-14) - `helmet`, CORS allowlist from `CORS_ORIGINS`, `express-mongo-sanitize`, `hpp`, `express.json({ limit: '100kb' })`.
4. **Seed script** (`scripts/seed.js`) - Doc 2 §5 requires *"sample donors, blood banks with partially-filled inventories, and a few requests across all urgency levels"*. Make it deterministic and idempotent (`--reset` flag):
   - 1 super-admin from `.env`
   - 12 donors spanning all 8 groups, with a deliberate spread of `lastDonationDate`: some eligible, some mid-window, some never donated
   - 5 blood banks in real cities with real coordinates - 3 verified, 1 pending, 1 rejected - with **partially** filled inventories including at least one group at zero and one below threshold
   - 3 hospitals with coordinates
   - donation histories back-dated so at least one unit sits **inside** the 7-day expiry window, one is **already expired**, and the rest are healthy - this is what makes the radar demonstrable
   - 10 requests covering all four urgency levels and every non-terminal status, so the Kanban queue and the tracker stepper have something to render at every stage
5. **REST client collection** - `postman/Jivandan.postman_collection.json` with one request per route in Appendix A1, environment variables for `baseUrl` and per-role tokens, and a login script that captures the token automatically.
6. **Integration tests** (Doc 2 Phase B5) - Jest + Supertest + `mongodb-memory-server`, covering: auth (all roles, duplicate email, RBAC 401/403), the full request lifecycle including the rejected invalid jump, and inventory (check-in increments, fulfilment decrements FEFO, expiry sweep decrements). Plus unit tests for the compatibility matrix in both directions and the eligibility calculator.
7. **`npm run` scripts** - `dev`, `start`, `seed`, `seed:reset`, `test`, `test:watch`, `lint`.

#### Exit gate - this is the hard one

> Doc 3 Step 5: *"RUN the API and confirm **every** route in §4 works via Postman/curl."* Do not start F1 until this is literally true.

- [ ] Every route in Appendix A1 returns a correct response in the REST client, run as the right role
- [ ] Every route rejects malformed input with `422` and a field-keyed error array
- [ ] Rate limits trip and reset as configured
- [ ] CORS allows `http://localhost:5173` and rejects an unknown origin
- [ ] `npm run seed:reset && npm run seed` produces the full dataset described above, repeatably
- [ ] `npm test` is green
- [ ] The full Doc 4 §4.1 backend checklist passes, item by item
- [ ] `docs/backend-contract.md` matches the running API exactly - regenerate the route list from the Express router and diff it (Doc 3 §3.1)
- [ ] **The contract is now frozen.** Any later change updates the contract first, then re-prompts only the affected frontend slice (Doc 3 §1)

#### Prompt for this phase

> Build Phase B5 of the Jivandan backend: hardening, seed data, and verification. Do not add features.
>
> 1. Add Zod validation to **every** route via a single `validate(schema)` middleware covering body, params, and query. Validation failures return 422 with a field-keyed `errors` array.
> 2. Add `express-rate-limit`: `/api/auth/*` at 10 per 15 minutes per IP, `POST /api/requests` at 20 per hour per account, and a 300 per 15 minutes global default.
> 3. Add `helmet`, a CORS allowlist read from `CORS_ORIGINS`, `express-mongo-sanitize`, `hpp`, and a 100kb JSON body limit.
> 4. Write `scripts/seed.js` - deterministic, idempotent, with a `--reset` flag. It must create: one super-admin from `.env`; 12 donors spanning all 8 blood groups with a deliberate spread of `lastDonationDate` (some eligible now, some mid-window, some who have never donated); 5 blood banks in real cities with real `[lng, lat]` coordinates - 3 verified, 1 pending, 1 rejected - with partially filled inventories including at least one group at zero and one below threshold; 3 hospitals with coordinates; donation histories back-dated so at least one unit falls inside the 7-day expiry window and one is already expired; and 10 requests covering all four urgency levels and every non-terminal status. The frontend will be built against this data, so every screen must have something real to render.
> 5. Export a Postman collection at `postman/Jivandan.postman_collection.json` with one request per route, `baseUrl` and per-role token environment variables, and a login test script that captures the token automatically.
> 6. Add Jest + Supertest + `mongodb-memory-server` integration tests for auth (all roles, duplicate email, 401 and 403 paths), the request lifecycle (including asserting `pending → fulfilled` is rejected), and inventory (check-in increments, fulfilment decrements first-expiring-first, expiry sweep decrements). Add unit tests asserting the compatibility matrix in both directions for all 8 groups, and the 56-day eligibility calculator.
> 7. Then start the server and list every registered Express route with its method and required role, and paste that list back to me so I can diff it against the contract document.

---

## 6. Frontend Phases

> Precondition for all of F1-F5: **B5's exit gate has passed** and the seed data is loaded. Doc 4 §2: *"Run the backend seed script before starting frontend work so every screen has real data."* Doc 4 §4.2: *"All screens render with real API data, not mock/placeholder data, before calling a phase done."*

### Phase F1 - Design System Foundation

**Doc 3 Step 6 · Doc 1 Phase F1**

#### Deliverables

1. **Scaffold** - Vite + React + TypeScript + Tailwind. Outfit and Inter loaded via the Google Fonts CDN with `display=swap` and a preconnect.
2. **Tailwind theme tokens** - the full palette, the type scale, radii, and the shadow scale, defined once in `tailwind.config.ts` and surfaced as CSS custom properties in `styles/tokens.css` for the places Tailwind cannot reach (SVG strokes, Three.js materials, keyframes).

```ts
// tailwind.config.ts - theme.extend
colors: {
  crimson:   { DEFAULT: '#E63946', ink: '#C1121F' },  // ink = accessible text/fill, see A5
  burgundy:  '#800020',
  flare:     '#D90429',
  amber:     '#FFB703',
  emerald:   { DEFAULT: '#2A9D8F', ink: '#1F7A6F' },
  navy:      '#0F172A',
  glass:     'rgba(255,255,255,.85)',
},
fontFamily: {
  display: ['Outfit', 'Sora', 'Space Grotesk', 'system-ui', 'sans-serif'],
  body:    ['Inter', 'system-ui', 'sans-serif'],
},
fontSize: {   // Doc 1 §2.2 - the only sizes allowed
  xs:   ['12px', { lineHeight: '16px' }],
  sm:   ['14px', { lineHeight: '20px' }],
  base: ['16px', { lineHeight: '24px' }],
  lg:   ['20px', { lineHeight: '28px' }],
  xl:   ['28px', { lineHeight: '34px' }],
  '2xl':['40px', { lineHeight: '46px' }],
  '3xl':['56px', { lineHeight: '60px' }],
},
borderRadius: { card: '16px' },   // Doc 1 §6 F1 - 16px card standard
```

3. **Base component kit** (`components/ui/`) - `GlassCard`, `Button` (primary-crimson / ghost / danger / success), `Input`, `Select`, `Textarea`, `BloodGroupChip` (all 8), `UrgencyBadge` (with the pulse variant), `SkeletonLoader`, `EmptyState`, `Toast`.
4. **Motion primitives** (`components/motion/`) - `StaggerList`, `FadeIn`, `CountUp`, `PulseRing`, and a `MotionProvider` wrapping the app in `<MotionConfig reducedMotion="user">`.
5. **The 3D hero, built in isolation** - Doc 1 §6 and Doc 3 §3.1 both insist on this: build it on a throwaway route (`/dev/hero`), measure it, and only integrate once it performs. *"Large first-attempt 3D scenes are the most common source of rework."*

#### The glassmorphism rule, encoded

Doc 1 §2.4 is emphatic that glass belongs **only** on floating surfaces. Encode it so it cannot drift:

```css
/* styles/tokens.css */
.glass-surface {
  backdrop-filter: blur(16px);
  background: rgba(255,255,255,.85);
  border: 1px solid rgba(255,255,255,.30);
  box-shadow: 0 1px 2px rgba(15,23,42,.04),
              0 8px 24px rgba(15,23,42,.08),
              0 24px 64px rgba(15,23,42,.10);   /* layered, never a hard drop shadow */
}
:root:not([data-theme="light"]) .glass-surface { /* dark-mode variant on navy */ }
```

`GlassCard` is used by exactly four things: modals, the sticky top nav once scrolled, toasts, and the landing hero's floating stat panel. **Every other card is a solid surface.** Add this as a comment in `GlassCard` and as a line in `docs/design-system.md`, because it is the single easiest rule for an AI tool to violate on the next prompt.

#### 3D hero specification

- Low-poly blood-drop or DNA-helix centrepiece; glass material (`MeshTransmissionMaterial` from drei); slow auto-rotation; gentle mouse parallax. Doc 1 §2.3: *"Not spinning for spinning's sake."*
- `React.lazy` + `Suspense` so the 3D bundle never blocks landing LCP; a static gradient-mesh poster renders behind it.
- **Kill switches, all three:** `prefers-reduced-motion` → static pose, no rotation; viewport under 768px → poster only; `navigator.hardwareConcurrency <= 4` → poster only.
- `dpr={[1, 1.5]}`, `frameloop="demand"` when idle, geometry disposed on unmount.
- **Budgets:** the 3D chunk under 250 KB gzipped, 55+ fps on a mid-range laptop, landing LCP under 2.5 s on a throttled Fast 3G profile.

#### Exit gate

- [ ] No component uses a raw hex colour or an off-scale font size - everything comes from a token
- [ ] Dark mode uses `#0F172A`, verifiably not Tailwind's `gray-900` (Doc 1 §7)
- [ ] `UrgencyBadge` pulses on `critical` and is visibly static on the other three (Doc 4 §4.2)
- [ ] Glass appears on modals, sticky nav and toasts only - nowhere else
- [ ] `CountUp` animates on mount and does **not** re-trigger on unrelated re-renders (Doc 4 §4.2) - memoise on the value, not the render
- [ ] `prefers-reduced-motion: reduce` disables count-ups, pulse, and 3D rotation (Doc 4 §4.2)
- [ ] The 3D hero holds 55+ fps in isolation and stays inside the bundle budget
- [ ] The palette pairings in Appendix A5 are applied - no crimson body text on white

#### Prompt for this phase

> Build Phase F1 of the Jivandan frontend: the design system foundation only. No product screens yet.
>
> Scaffold Vite + React + TypeScript + Tailwind. Load Outfit and Inter from the Google Fonts CDN with preconnect and `display=swap`.
>
> Define the complete theme in `tailwind.config.ts` and mirror it as CSS custom properties in `styles/tokens.css` for SVG strokes, keyframes, and Three.js materials. Use exactly the palette, type scale (12/14/16/20/28/40/56), 16px card radius, and layered shadow scale in the attached design-system document. Add `crimson.ink #C1121F` and `emerald.ink #1F7A6F` as the accessible text/fill variants - `#E63946` is only 4.17:1 on white and fails WCAG AA for body text, so it is for large text, icons, borders and decorative fills only. Numerals in stats use `tabular-nums`.
>
> Build `components/ui/`: GlassCard, Button (primary-crimson / ghost / danger / success), Input, Select, Textarea, BloodGroupChip (all 8 groups), UrgencyBadge with a pulsing variant for `critical` only, SkeletonLoader, EmptyState, Toast.
>
> Build `components/motion/`: StaggerList, FadeIn, CountUp, PulseRing, and a MotionProvider wrapping the app in Framer Motion's `<MotionConfig reducedMotion="user">`.
>
> Glassmorphism rule, enforce it strictly: `backdrop-filter: blur(16px)`, a 1px `rgba(255,255,255,.3)` border, and a soft multi-layer shadow - never a hard drop shadow. Apply it **only** to floating surfaces: modals, the sticky nav once scrolled, and toasts. Every other card is a solid surface. Put this rule in a comment inside GlassCard.
>
> Finally, build the 3D hero **in isolation** on a throwaway `/dev/hero` route - do not integrate it into a page yet. A low-poly blood drop with a glass transmission material, slow auto-rotation, gentle mouse parallax. It must be lazy-loaded behind Suspense with a static gradient-mesh poster fallback, and must fall back to the poster when `prefers-reduced-motion` is set, when the viewport is under 768px, or when `navigator.hardwareConcurrency <= 4`. Use `dpr={[1, 1.5]}`, dispose geometry on unmount, and keep the 3D chunk under 250KB gzipped. Report the measured frame rate and chunk size.
>
> Hard constraints: no purple-to-blue gradient, no centered hero with a three-icon feature grid, no emoji icons - lucide-react only, consistently sized and weight-matched. No untouched default shadcn spacing.
>
> *(attach: `docs/design-system.md`)*

---

### Phase F2 - Auth & Role Shells

**Doc 3 Step 7 · Doc 1 Phase F2 · Wired to the real `/api/auth` routes**

#### Deliverables

- **API layer** - `api/client.ts` (fetch wrapper: base URL from `VITE_API_BASE_URL`, bearer token injection, envelope unwrapping, `ApiError` on `success: false`, 401 → sign-out) and a TanStack Query `QueryClient` with sane defaults (`staleTime` 30 s, one retry, no refetch on window focus for polled queries).
- **Types** - `types/api.d.ts` mirroring the contract exactly, hand-written from `docs/backend-contract.md` (or generated from the Zod validators if you export them). The frontend must never guess a field name.
- `/auth/login` and `/auth/register` - glass card form over the rich background, with the **`RoleSwitcherTabs`** (Donor / Blood Bank / Hospital / Admin). The selected role drives both the register form's field set and the login payload's `role` (D-7).
- Role-conditional registration fields - donor: dob, gender, blood group, contact; bank: city/state/pincode/address, licence number, map-picked coordinates; hospital: address, registration number, coordinates. Validated with React Hook Form + Zod, mapping the backend's 422 `errors` array onto field errors.
- **Auth state** - `useAuth` hook, token persistence per the D-10 decision, `<ProtectedRoute role={...}>` guards, redirect-to-intended-route after login.
- **Three distinct app shells** (Doc 1 §7: *"Is the layout meaningfully different between the Donor app and the Admin console?"*):
  - **Donor** - mobile-first, bottom tab bar under 768px, warm crimson accents, generous spacing.
  - **Blood Bank / Hospital** - desktop-first, persistent left sidebar, denser, operational.
  - **Admin** - densest, cooler surfaces, data-grid oriented, top command bar.
- Global toast system (`sonner`, restyled to `.glass-surface`) and the skeleton loader set.

#### Exit gate

- [ ] Registration succeeds for donor, blood bank and hospital against the live API; the field set changes with the role tab
- [ ] Backend 422 errors land on the correct form fields
- [ ] Login works for all four roles and routes each to its own shell
- [ ] A donor visiting `/admin/dashboard` is blocked client-side **and** the API returns 403 - verify both
- [ ] Refreshing the page keeps the session; logout clears it fully
- [ ] The three shells are visibly different in density and navigation pattern, not one shell recoloured
- [ ] Toasts use glass; the shells' own cards do not

#### Prompt for this phase

> Build Phase F2 of the Jivandan frontend: authentication and the role-aware app shells, wired to the **live** backend at `VITE_API_BASE_URL`. Use the F1 design system - do not create new tokens or new base components.
>
> 1. `api/client.ts` - a typed fetch wrapper that injects the bearer token, unwraps the `{ success, message, data, errors, meta }` envelope, throws a typed `ApiError` carrying the field-keyed `errors` array, and signs the user out on 401. Configure a TanStack Query client with `staleTime` 30s and one retry.
> 2. `types/api.d.ts` - TypeScript types transcribed from the attached contract document. Do not invent or rename a single field; if something you need is missing from the contract, stop and ask.
> 3. `/auth/login` and `/auth/register` - a glass card form over a rich background, with RoleSwitcherTabs for Donor / Blood Bank / Hospital / Admin. The selected role changes the registration field set (donor: dob, gender, blood group, contact; blood bank: address/city/state/pincode, licence number, coordinates; hospital: address, registration number, coordinates) and is sent as `role` in the login payload - the backend needs it to pick the right collection. Validate with React Hook Form + Zod and map the backend's 422 `errors` array onto the matching fields.
> 4. `useAuth` with token persistence, a `<ProtectedRoute role={...}>` guard, and redirect-to-intended-route after login.
> 5. Three genuinely distinct app shells: **Donor** - mobile-first, bottom tab bar below 768px, warm crimson accents, generous spacing. **Blood Bank / Hospital** - desktop-first, persistent left sidebar, denser and operational. **Admin** - densest, cooler surfaces, data-grid oriented, top command bar. These must differ in layout and density, not just in colour.
> 6. A global toast system restyled to the glass surface spec, plus the skeleton loader set used by later phases.
>
> Every screen must work against real seeded accounts. Do not add mock data anywhere.
>
> *(attach: `docs/backend-contract.md` §4.1)*

---

### Phase F3 - Donor Experience

**Doc 3 Step 8 · Doc 1 Phase F3 · Wired to `/api/donors/*`**

#### `/donor/dashboard`

- **Eligibility countdown ring** - an animated SVG ring (`stroke-dashoffset`, per Doc 1 §2.3, **not** Recharts) showing progress through the 56-day window, with the day count in the centre in `tabular-nums`. Eligible → full emerald ring reading "Eligible to donate". Ineligible → partial crimson ring with the date. Data from `GET /api/donors/me`.
- **Impact stats row** - `StatCounter` count-ups for total donations, units given, and estimated lives impacted.
- **Nearby urgent requests feed** - from `GET /api/donors/feed`, polled at 30 s. Each row: `BloodGroupChip`, `UrgencyBadge` (pulsing when critical), distance, hospital, units needed, time posted. Staggered entrance on mount.
- Quick actions: view pass, find a bank, raise a request.
- Distinct loading (skeleton), empty ("no urgent requests near you"), and error (retry) states - Doc 4 §4.2 requires all three to be visibly distinct.

#### `/donor/pass`

- **`DonorPassCard`** - the signed QR from `GET /api/donors/me/pass` (`qrcode.react`), donor name, blood group, donor ID, and the pass's validity. Presented as a premium physical card: burgundy gradient face, subtle noise texture, tilt-on-hover.
- **Donation history timeline** - vertical, newest first, each entry showing bank, units, date, and expiry status of those units.
- **Milestone badges** - first donation, 5th, 10th, 25th; lifesaver tiers. Earned badges are full-colour, unearned are outlined and dimmed.
- QR must stay scannable: a solid white quiet zone, minimum 200px, and **no glass or blur behind it** - this is a real failure mode when the glass rule is over-applied.

#### Exit gate

- [ ] The eligibility ring matches `nextEligibleDate` from the API for an eligible donor, a mid-window donor, and a never-donated donor (all three exist in the seed data)
- [ ] The ring animates from 0 on mount and respects reduced motion
- [ ] Stat counters count up once on mount and do not re-trigger on feed refresh
- [ ] The feed shows only requests this donor's blood group can serve - cross-check against Appendix A4 using an O− and an AB+ seed donor
- [ ] Critical entries pulse; low/medium/high do not
- [ ] The QR scans successfully with a phone camera at 375px width
- [ ] Loading, empty and error states are all visibly distinct on both screens
- [ ] The whole donor flow is usable end-to-end at a 375px viewport (Doc 4 §4.2)

#### Prompt for this phase

> Build Phase F3 of the Jivandan frontend: the donor experience, wired to the live `/api/donors/*` routes. Reuse the F1 design system and F2 shells.
>
> **`/donor/dashboard`** - (a) an eligibility countdown ring: hand-built animated SVG using `stroke-dashoffset`, **not** a chart library, showing progress through the 56-day window with the remaining day count centred in tabular numerals; emerald and full when eligible, partial crimson with the eligible date when not; data from `GET /api/donors/me`. (b) An impact stats row using animated count-ups for total donations, units given, and estimated lives impacted. (c) A nearby-urgent-requests feed from `GET /api/donors/feed`, polled every 30 seconds via TanStack Query `refetchInterval`, each row showing blood group chip, urgency badge (pulsing only when critical), distance, hospital, units needed and time posted, entering with a stagger. (d) Quick actions for view pass, find a bank, and raise a request.
>
> **`/donor/pass`** - the digital donor pass. Render the signed QR payload from `GET /api/donors/me/pass` using `qrcode.react`, on a card that reads as a premium physical object: burgundy gradient face, subtle noise texture, tilt-on-hover. The QR needs a solid white quiet zone, a minimum of 200px, and **no glass or blur behind it** - it must stay scannable. Below it, a vertical donation-history timeline (newest first: bank, units, date, expiry status) and a milestone badge set (first / 5th / 10th / 25th donation, lifesaver tiers) with earned badges in full colour and unearned ones outlined and dimmed.
>
> Every data-driven area needs three visibly distinct states - skeleton loaders while loading (not spinners), a designed empty state, and an error state with retry. Mobile-first: the entire flow must be usable at 375px.
>
> *(attach: `docs/backend-contract.md` §4.2)*

---

### Phase F4 - Blood Bank & Emergency Flow

**Doc 3 Step 9 · Doc 1 Phase F4 · Wired to `/api/banks/*` and `/api/requests/*`**

#### `/bank/dashboard` - live stock matrix + expiry radar

- **8-group stock matrix** - one `StockLevelRing` (or fill bar) per group, animated `stroke-dashoffset`, colour-coded against `lowStockThreshold`: emerald healthy, amber low, flare critical/zero. Counts in `tabular-nums`, count-up on mount and on change. Polled at 15 s.
- **Expiry radar** - from `/api/banks/:id/expiry-radar`, sorted soonest-first, each row showing group, units, days-to-expiry, and an amber→flare severity ramp. Doc 1 calls this a "radar", so treat it as a live watchlist, not a table dump.
- Low-stock alert strip when any group is below threshold.

#### `/bank/requests` - Kanban queue

- Columns by urgency: Critical / High / Medium / Low. The **Critical column pulses** (Doc 1 §3). Cards show requester, group, units, age of request, and a substitute hint from `/api/requests/match/:bloodGroup` when the exact group is short.
- Advancing status via the card action calls `PATCH /api/requests/:id/status`; the UI offers **only the legal next transitions** (D-1) so an invalid jump is impossible to attempt.
- Optimistic update with rollback on the backend's 409.

#### `/bank/checkin` - donor check-in

- Camera QR scanner (`@zxing/browser`), with a manual donor-ID entry fallback for when camera permission is denied - do not let the whole flow depend on camera access.
- On a successful scan: show the donor's identity and **eligibility status** before anything is recorded. If ineligible, block the submit and show the next eligible date (the backend enforces this too, but the operator should never get that far).
- Donation logging form → `POST /api/banks/:id/checkin`; on success show the computed expiry date and the updated stock count.

#### `/request/new` - emergency request form

- Multi-step (React Hook Form + Zod, one Zod schema per step): patient & hospital details → blood group & units → urgency → bank selection → review & submit.
- **Urgency selector with live colour feedback** (Doc 1 §3): the surrounding surface shifts amber → flare and the pulse begins as the user selects `critical`, so the weight of the choice is felt before submitting.
- Bank selection reuses the F5 search component if built, or a simple nearby list; show each bank's stock for the requested group inline.
- Progress indicator; back-navigation preserves entered data.

#### `/request/:id/track` - live tracker

- **`StatusStepper`**, animated: Submitted → Review → Approved → Dispatched → Fulfilled, driven by `statusHistory` so each completed step shows its real timestamp. The active step pulses; completed steps fill emerald; a rejected or cancelled request branches out of the line rather than continuing along it.
- Polled at 5 s, **stopping once the status is terminal** - an endlessly polling tracker on a fulfilled request is a battery and quota leak.
- Shows the assigned bank, contact, and units.

#### Exit gate

- [ ] The stock matrix shows all 8 groups always, including groups at zero, with correct threshold colouring
- [ ] Stock rings animate on change, not only on mount
- [ ] The expiry radar shows the seeded near-expiry unit and excludes the healthy ones
- [ ] The Critical Kanban column pulses; the other three do not
- [ ] Only legal status transitions are offered; a forced illegal one is refused by the API with 409 and the UI rolls back
- [ ] QR check-in works with a real phone camera, and the manual fallback works with the camera blocked
- [ ] Checking in an ineligible donor is blocked with the next eligible date shown
- [ ] A successful check-in immediately updates the stock matrix
- [ ] The urgency selector visibly changes the surface as urgency rises
- [ ] The tracker advances within 5 s of a bank changing the status in another window - this is the Doc 3 Step 11 demonstration
- [ ] Polling stops on a terminal status
- [ ] Bank screens are usable at 1440px and degrade sensibly on tablet

#### Prompt for this phase

> Build Phase F4 of the Jivandan frontend: blood bank operations and the emergency request flow, wired to the live `/api/banks/*` and `/api/requests/*` routes.
>
> **`/bank/dashboard`** - a live 8-group stock matrix, one animated SVG ring or fill bar per blood group using `stroke-dashoffset` (not Recharts), colour-coded against the bank's `lowStockThreshold`: emerald healthy, amber low, flare critical or zero. Counts in tabular numerals, animating on mount and on change. Poll every 15 seconds. Beside it, an expiry radar from `/api/banks/:id/expiry-radar` sorted soonest-first with an amber-to-flare severity ramp, presented as a live watchlist rather than a plain table. Show a low-stock alert strip when any group is below threshold. All eight groups always render, including groups at zero.
>
> **`/bank/requests`** - a Kanban queue with columns by urgency (Critical / High / Medium / Low) where the **Critical column pulses**. Cards show requester, blood group, units, request age, and a substitute hint from `/api/requests/match/:bloodGroup` when the exact group is short. Status advances via `PATCH /api/requests/:id/status`, and the UI must offer **only the legal next transitions** from the attached state machine so an invalid jump cannot be attempted. Update optimistically and roll back on a 409.
>
> **`/bank/checkin`** - a camera QR scanner using `@zxing/browser`, with a manual donor-ID entry fallback for when camera permission is denied. On scan, show the donor's identity and eligibility **before** recording anything; if they are inside the 56-day window, block submission and show their next eligible date. Then a donation logging form posting to `POST /api/banks/:id/checkin`, showing the computed 42-day expiry date and the updated stock count on success.
>
> **`/request/new`** - a multi-step form (React Hook Form + Zod, one schema per step): patient and hospital details, then blood group and units, then urgency, then bank selection, then review and submit. The urgency selector must give live colour feedback - the surrounding surface shifts amber to flare and begins pulsing as `critical` is selected. Show each candidate bank's stock for the requested group inline. Keep entered data when navigating back.
>
> **`/request/:id/track`** - an animated StatusStepper for Submitted → Review → Approved → Dispatched → Fulfilled, driven by the request's `statusHistory` so each completed step shows its real timestamp. The active step pulses, completed steps fill emerald, and a rejected or cancelled request branches out of the line rather than continuing along it. Poll every 5 seconds and **stop polling once the status is terminal**.
>
> These are desktop-first, data-dense screens - optimise for 1440px and degrade sensibly to tablet. Skeleton loaders, designed empty states, and retryable error states everywhere.
>
> *(attach: `docs/backend-contract.md` §4.3-4.4 + the status machine table)*

---

### Phase F5 - Search, Admin Console & Polish

**Doc 3 Step 10 · Doc 1 Phase F5**

#### `/search` - geospatial search

- Split view: map (react-leaflet) plus a result list; on mobile, a toggle between the two.
- `RadiusSlider` with snap stops at **5 / 10 / 25 km** (Doc 1 §3), redrawing a radius circle on the map live.
- Filters: blood group, minimum units, verified-only (always on per D-4), open-now.
- Clustered pins (`leaflet.markercluster`); pin colour reflects stock status for the selected blood group. Hovering a list row highlights its pin and vice versa.
- Browser geolocation with a graceful fallback to city search when permission is denied - this is a common denial, so design for it rather than treating it as an error.
- Results show `distanceMeters` formatted, stock for the selected group, and verification badge.

#### `/admin/dashboard` - control centre

- **KPI cards** with count-ups from `GET /api/admin/metrics`.
- **Charts (Recharts, and only here - D-15)**: donations-per-week trend line, demand-by-blood-group bar, requests-by-status donut. Themed to the palette; no default Recharts colours.
- **Verification queue** - pending banks from `/api/admin/banks/pending`, each expandable to licence details, with approve/reject actions calling `PATCH /api/admin/banks/:id/verify`; reject requires a reason.
- **Audit log `DataTable`** - sortable, filterable by actor/action/date range, server-paginated against `/api/admin/logs`. Virtualise the rows; this table grows without bound.

#### Polish pass - the three sweeps

**Responsive** (Doc 4 §4.2)
- 375px: every donor flow usable end-to-end, nothing clipped, no horizontal scroll.
- 768px: bank screens readable; tables become cards or scroll inside their own container.
- 1440px: bank and admin dashboards use the width rather than centring in a narrow column.

**Motion / reduced-motion** (Doc 1 §2.3, Doc 4 §4.2)
- With `prefers-reduced-motion: reduce`, verify each of: 3D auto-rotation stops, urgency pulse stops, count-ups render final values instantly, page transitions become instant, stagger becomes simultaneous, marquee tickers stop. Test by toggling the OS setting, not only the devtools emulation.

**Accessibility**
- Contrast: apply Appendix A5 and verify with an automated check. This is where `crimson.ink` earns its place.
- Every interactive element reachable by keyboard with a visible focus ring (a crimson ring at 2px offset, never `outline: none`).
- `aria-live="polite"` on the request tracker and stock matrix so status changes are announced; `aria-live="assertive"` on critical alerts only.
- Blood groups and urgency levels must not be conveyed by colour alone - the chip text and badge label carry it.
- Form errors linked via `aria-describedby`; the QR scanner has a labelled manual alternative.
- Landmarks, one `h1` per page, a descending heading order, and a skip-to-content link.

#### Exit gate

- [ ] Radius search returns results consistent with the API for all three radii
- [ ] Denying geolocation degrades to city search rather than a dead screen
- [ ] Pin clustering works with all seeded banks; hover linking works both directions
- [ ] Admin charts render seeded data, themed to the palette, with no default Recharts colours
- [ ] Approving a pending bank removes it from the queue and makes it appear in `/search`
- [ ] The audit log table sorts, filters and paginates server-side
- [ ] All three responsive breakpoints pass
- [ ] Every animation listed above genuinely stops under reduced motion
- [ ] Automated contrast check passes AA for body text on every surface
- [ ] Full keyboard traversal of the donor and bank flows with no traps
- [ ] Doc 1 §7's six-question checklist is answered "yes" on every point

#### Prompt for this phase

> Build Phase F5 of the Jivandan frontend: geospatial search, the admin console, and the final polish pass.
>
> **`/search`** - a split map-and-list view using react-leaflet (mobile toggles between the two). A radius slider snapping to 5, 10 and 25 km that redraws a radius circle on the map live, plus filters for blood group, minimum units and open-now. Clustered pins via `leaflet.markercluster`, pin colour reflecting stock for the selected blood group, and two-way hover highlighting between list rows and pins. Request browser geolocation but degrade gracefully to city search when permission is denied - treat denial as a normal path, not an error. Show formatted distance, stock for the selected group, and a verification badge on each result. Only verified banks appear.
>
> **`/admin/dashboard`** - KPI cards with count-ups from `GET /api/admin/metrics`; Recharts visuals **only here** (donations-per-week trend line, demand-by-blood-group bar, requests-by-status donut), themed to our palette with no default Recharts colours; a verification queue from `/api/admin/banks/pending` with expandable licence details and approve/reject actions calling `PATCH /api/admin/banks/:id/verify` where reject requires a reason; and a sortable, filterable, server-paginated audit log table against `/api/admin/logs`, with virtualised rows.
>
> **Then run three sweeps across the whole app:**
>
> *Responsive* - 375px: every donor flow usable end-to-end with no horizontal scroll or clipping. 768px: bank screens readable, tables becoming cards or scrolling inside their own container. 1440px: bank and admin dashboards genuinely using the width, not centred in a narrow column.
>
> *Reduced motion* - with `prefers-reduced-motion: reduce`, verify individually that 3D auto-rotation stops, urgency pulses stop, count-ups render their final value instantly, page transitions become instant, staggers become simultaneous, and tickers stop.
>
> *Accessibility* - AA contrast on every surface using the accessible ink variants; a visible crimson focus ring on every interactive element and never `outline: none`; `aria-live="polite"` on the request tracker and stock matrix and `assertive` on critical alerts only; blood group and urgency never conveyed by colour alone; form errors linked with `aria-describedby`; a labelled manual alternative to the QR scanner; landmarks, one `h1` per page, descending heading order, and a skip-to-content link.
>
> Report anything that fails a sweep rather than silently working around it.
>
> *(attach: `docs/backend-contract.md` §4.3 + §4.5, `docs/design-system.md`)*

---

## 7. Phase Q - End-to-End QA

**Doc 3 Step 11 · Doc 4 §4**

### Q.1 The signature flow (Doc 3 Step 11)

Run this with two browser windows side by side - a donor/hospital in one, a bank in the other.

1. Register a new donor; confirm the eligibility ring reads "eligible" (no prior donation).
2. As a hospital, raise a **critical** request for a group the target bank is short of. Confirm the notification hook fires in the backend log.
3. As the donor, confirm the request appears in `/donor/feed` - and only if the donor's group can serve it.
4. As the bank, see it land in the **pulsing Critical column** and see the substitute suggestion.
5. Advance `under_review → approved → dispatched`, watching the requester's tracker step forward **live within 5 seconds** in the other window, with real timestamps.
6. Attempt an illegal jump; confirm 409 and a UI rollback.
7. Check the donor in at the bank via QR; confirm the ledger row, the 42-day expiry, the stock increment, and the donor's eligibility ring flipping to a 56-day countdown.
8. Mark the request `fulfilled`; confirm FEFO stock decrement and the completed stepper.
9. As admin, confirm every one of those actions appears in the audit log with the right actor.

### Q.2 Backend checklist (Doc 4 §4.1, verbatim)

- [ ] Register succeeds for all 4 roles; duplicate email is rejected
- [ ] Login issues a valid JWT; protected routes reject missing/invalid tokens
- [ ] RBAC: a donor token cannot hit admin-only routes (expect 403)
- [ ] Creating a donation auto-sets `expiryDate = donationDate + 42 days`
- [ ] Donor eligibility date correctly reflects the 56-day gap from `lastDonationDate`
- [ ] Compatibility matching returns correct substitute groups when an exact match is out of stock
- [ ] Expiry radar correctly flags units within the configured window
- [ ] Every mutating action produces a corresponding `activitylogs` entry
- [ ] Request status transitions follow the defined order and reject invalid jumps (e.g. `pending → fulfilled` directly)

### Q.3 Frontend checklist (Doc 4 §4.2, verbatim)

- [ ] All screens in Doc 1 §3 render with real API data, not mock/placeholder data
- [ ] Loading, empty, and error states are visibly distinct on every data-driven screen
- [ ] Critical urgency badges visibly pulse; other urgency levels do not
- [ ] Stat counters animate on first mount and don't re-trigger needlessly on unrelated re-renders
- [ ] `prefers-reduced-motion` actually disables the 3D auto-rotation and pulse animations when set
- [ ] Mobile viewport (375px) is usable end-to-end for the donor flows; desktop (1440px) for bank/admin dashboards
- [ ] Colour contrast on crimson/burgundy surfaces meets at least WCAG AA for body text

### Q.4 Anti-generic design review (Doc 1 §7)

- [ ] Does the landing page have a genuine focal point (3D piece or bold typographic hero), not a stock template layout?
- [ ] Are urgency badges colour-coded per spec, and does Critical actually pulse?
- [ ] Do stat numbers animate on mount instead of appearing static?
- [ ] Is glass used sparingly (floating surfaces only) rather than on every card?
- [ ] Does dark mode actually use Dark Slate Navy, not a generic gray-900?
- [ ] Is the layout meaningfully different between the Donor app (mobile-first, warm) and the Admin console (dense, data-grid, cooler)?

### Q.5 If a screen still looks generic (Doc 3 §4)

Do **not** regenerate the screen. Send a scoped correction instead - a full regeneration re-rolls work that was already good:

> This still reads as a generic AI-generated layout. Specifically: [name the exact issue, e.g. "the hero is centered text over a flat gradient"]. Fix ONLY that: [describe the desired replacement, referencing the design-system document]. Keep everything else in this file as-is.

---

## 8. Phase D - Deployment

**Doc 4 §5**

| Area | Tasks |
|---|---|
| **Backend** | Containerise or deploy to Render / Railway / Fly.io. Set production env vars. **CORS allowlist restricted to the deployed frontend origin only.** `NODE_ENV=production`. Health check wired to the platform's probe. Enable the `node-cron` expiry sweep. |
| **Database** | Switch to a MongoDB Atlas production cluster. IP allowlisting or VPC peering. **Daily backups on.** Confirm every index from B1 exists in production (`db.collection.getIndexes()`). |
| **Frontend** | Build with the production `VITE_API_BASE_URL`. Deploy the static build to Vercel / Netlify / Cloudflare Pages. SPA fallback rewrite so deep links like `/request/:id/track` resolve. |
| **Secrets** | Fresh `JWT_SECRET` and `SESSION_SECRET` - **never reuse dev secrets** (Doc 4 §5). Rotating `JWT_SECRET` invalidates every issued donor-pass QR (D-12), so do it before issuing real passes. |
| **Notifications** | Connect the real SMS/push provider behind the `NotificationService` interface stubbed at B3 (Doc 2 §5.4). |
| **Verify** | Smoke-test the full donor-to-fulfilment flow (Q.1) against production **before announcing launch** (Doc 4 §5). |

**Additional pre-launch items** not in the documents but worth doing: error tracking (Sentry) on both tiers; uptime monitoring on `/api/health`; a documented restore-from-backup drill; and a data-retention position on donor health data, since this is medical information.

---

## 9. Phase R - Realtime (optional, post-QA)

Only after Q passes. Add Socket.IO on the backend with rooms `request:<id>`, `bank:<id>`, `donor:<id>`, emitting on the same events that already write ActivityLog entries. On the frontend, swap `refetchInterval` for socket-driven `queryClient.invalidateQueries`, keeping polling as the fallback when the socket is disconnected. The REST contract does not change, so nothing built in F1-F5 needs rewriting.

---

## Appendix A1 - Complete route map (Doc 2 §4, amended)

Amendments from §2 are marked. Keep this table synchronised with `docs/backend-contract.md`.

### Auth
| Method | Route | Roles | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | public | role-aware; admin excluded (D-3); cross-collection email check (D-7) |
| POST | `/api/auth/login` | public | body takes `role` (D-7) |
| POST | `/api/auth/logout` | any | |
| POST | `/api/auth/forgot-password` | public | **added** (D-11) |
| POST | `/api/auth/reset-password` | public | `{ token, newPassword }` (D-11) |
| GET | `/api/auth/me` | any | **added**, optional |

### Donor
| Method | Route | Roles | Notes |
|---|---|---|---|
| GET | `/api/donors/me` | donor | profile + eligibility + impact stats |
| PATCH | `/api/donors/me` | donor | profile / avatar |
| GET | `/api/donors/me/pass` | donor | signed QR payload + history (D-12) |
| GET | `/api/donors/feed` | donor | uses `canDonateTo` (D-13) |

### Blood Bank / Inventory
| Method | Route | Roles | Notes |
|---|---|---|---|
| GET | `/api/banks/:id/inventory` | any auth | all 8 groups always present |
| PATCH | `/api/banks/:id/inventory` | owning bank, admin | logs the delta |
| POST | `/api/banks/:id/checkin` | owning bank | verifies pass JWT; enforces 56-day rule |
| GET | `/api/banks/:id/expiry-radar` | owning bank, admin | `?windowDays=` |
| GET | `/api/banks` | any auth | geo search (D-5); verified only (D-4) |

### Blood Requests
| Method | Route | Roles | Notes |
|---|---|---|---|
| POST | `/api/requests` | donor, hospital | rate-limited; fires critical hook |
| GET | `/api/requests/:id` | requester, assigned bank, admin | includes `statusHistory` |
| PATCH | `/api/requests/:id/status` | assigned bank, admin, requester (cancel only) | D-1 state machine |
| GET | `/api/requests?urgency=&bank=&status=` | bank, admin | paginated queue |
| GET | `/api/requests/match/:bloodGroup` | bank, hospital, admin | `?bankId=&units=` |

### Admin
| Method | Route | Roles | Notes |
|---|---|---|---|
| GET | `/api/admin/metrics` | admin | single `$facet` aggregation |
| GET | `/api/admin/banks/pending` | admin | paginated |
| PATCH | `/api/admin/banks/:id/verify` | admin | `{ action, reason? }` (D-4) |
| GET | `/api/admin/logs` | admin | paginated, filterable, append-only |

### System
| Method | Route | Roles |
|---|---|---|
| GET | `/api/health` | public |

---

## Appendix A2 - Response envelope & pagination

```jsonc
// success
{ "success": true,  "message": "OK", "data": { }, "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 } }
// failure
{ "success": false, "message": "Validation failed",
  "errors": [ { "field": "units", "message": "must be at least 1" } ] }
```

| Status | Used for |
|---|---|
| 200 / 201 | success / created |
| 400 | malformed request |
| 401 | missing or invalid token |
| 403 | authenticated but wrong role, or unverified bank |
| 404 | not found |
| 409 | conflict - duplicate email, invalid status transition, insufficient stock |
| 422 | validation failure, ineligible donor |
| 429 | rate limited |
| 500 | unhandled - envelope only, never a stack trace in production |

Pagination on every list route: `?page=1&limit=20`, default 20, maximum 100.

---

## Appendix A3 - Request status state machine (D-1)

| From | Allowed to | Who may |
|---|---|---|
| `pending` | `under_review`, `rejected`, `cancelled` | bank/admin; requester may cancel |
| `under_review` | `approved`, `rejected`, `cancelled` | bank/admin; requester may cancel |
| `approved` | `dispatched`, `rejected` | bank/admin |
| `dispatched` | `fulfilled` | bank/admin |
| `fulfilled` | - terminal | - |
| `rejected` | - terminal | - |
| `cancelled` | - terminal | - |

UI stepper labels: `pending`=Submitted · `under_review`=Review · `approved`=Approved · `dispatched`=Dispatched · `fulfilled`=Fulfilled.

---

## Appendix A4 - Blood compatibility matrix (D-13)

**`compatibleDonorsFor(recipient)`** - which units a patient of this group may receive:

| Recipient | Compatible donor groups |
|---|---|
| `O-` | O− |
| `O+` | O−, O+ |
| `A-` | O−, A− |
| `A+` | O−, O+, A−, A+ |
| `B-` | O−, B− |
| `B+` | O−, O+, B−, B+ |
| `AB-` | O−, A−, B−, AB− |
| `AB+` | all eight (universal recipient) |

**`canDonateTo(donor)`** - the transpose; derive it in code, do not hand-write it:

| Donor | Can serve recipients |
|---|---|
| `O-` | all eight (universal donor) |
| `O+` | O+, A+, B+, AB+ |
| `A-` | A−, A+, AB−, AB+ |
| `A+` | A+, AB+ |
| `B-` | B−, B+, AB−, AB+ |
| `B+` | B+, AB+ |
| `AB-` | AB−, AB+ |
| `AB+` | AB+ |

Substitution ranking: exact match first, then compatible groups ordered so rare stock is preserved - never issue O− where O+ would serve.

---

## Appendix A5 - Accessible colour pairings

Doc 4 §4.2 requires *"colour contrast on crimson/burgundy surfaces meets at least WCAG AA for body text."* Measured against the Doc 1 §2.1 palette:

| Pairing | Ratio | Verdict |
|---|---|---|
| `#E63946` crimson on white | **4.17 : 1** | fails AA body (4.5), passes AA large (3.0) |
| white on `#E63946` crimson | **4.17 : 1** | same - fails for normal-size button labels |
| `#800020` burgundy on white | **10.8 : 1** | passes AAA |
| `#D90429` flare on white | **5.25 : 1** | passes AA body |
| white on `#D90429` flare | **5.25 : 1** | passes AA body |
| `#2A9D8F` emerald on white | **3.32 : 1** | large text only |
| `#FFB703` amber on white | **1.75 : 1** | fill only, never text |
| `#0F172A` navy on `#FFB703` amber | **10.2 : 1** | passes AAA - the right way to use amber |
| white on `#0F172A` navy | **17.9 : 1** | passes AAA |
| `#E63946` crimson on `#0F172A` navy | **4.28 : 1** | fails AA body in dark mode |

**Rules that follow:**

- Add **`crimson.ink #C1121F`** - 6.22 : 1 on white in both directions. Use it for crimson-coloured body text and for button fills carrying white labels. Keep `#E63946` for large headings, icons, borders, rings and decorative fills.
- Add **`emerald.ink #1F7A6F`** for emerald text - 5.16 : 1 on white.
- **Amber is a fill colour only**, always with navy text on it.
- **Emergency Flare works for white text** at 5.25 : 1 - the correct choice for critical badges with white labels.
- In dark mode, use a lightened crimson (**`#FF6B6B`**, 6.43 : 1 on navy) for crimson text.

None of this changes the brand palette - it adds accessible ink variants alongside it, which is what makes the Doc 4 checklist item pass without repainting the product.

---

## Appendix A6 - Environment variables

### `backend/.env` (Doc 2 §7, extended)

| Variable | Purpose | Source |
|---|---|---|
| `MONGO_URI` | MongoDB connection string | Doc 2 §7 |
| `JWT_SECRET` | JWT signing secret (also signs donor passes - D-12) | Doc 2 §7 |
| `SESSION_SECRET` | express-session secret | Doc 2 §7 |
| `PORT` | API port (5000) | Doc 2 §7 |
| `NODE_ENV` | development / production | Doc 2 §7 |
| `SMS_PROVIDER_KEY` | stub for the urgency notification hook | Doc 2 §7 |
| `CORS_ORIGINS` | comma-separated allowlist | D-14 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seeded super-admin | D-3 |
| `EXPIRY_RADAR_DAYS` | radar window, default 7 | Doc 2 §5.2 |
| `LOW_STOCK_THRESHOLD` | default per-bank threshold, default 10 | Doc 2 §5.2 |
| `DONATION_INTERVAL_DAYS` | 56 - configurable, never hard-coded | Doc 2 §5.3 |
| `UNIT_SHELF_LIFE_DAYS` | 42 - configurable, never hard-coded | Doc 2 §3.4 |
| `USE_TRANSACTIONS` | true when Mongo runs as a replica set | D-6 |
| `JWT_EXPIRES_IN` | 7d | - |
| `PASS_EXPIRES_IN` | 365d | D-12 |

### `frontend/.env` (Doc 4 §2)

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | e.g. `http://localhost:5000` |
| `VITE_MAP_TILE_URL` | Leaflet tile source (D-9) |

Put `56` and `42` in config from day one. They read as constants, but they are policy - regions differ, and hunting them out of controllers later is exactly the kind of avoidable rework this plan exists to prevent.

---

## Appendix A7 - Doc 3 step → phase index

| Doc 3 Step | Phase | Source sections |
|---|---|---|
| - | P0 | Doc 4 §2, Doc 3 §3.1 |
| 1 | B1 | Doc 2 §3, §5 (first half), Phase B1 |
| 2 | B2 | Doc 2 §4.1, §5, Phase B2 |
| 3 | B3 | Doc 2 §4.2-4.4, §5.1-5.4, Phase B3 |
| 4 | B4 | Doc 2 §4.5, §5.5, Phase B4 |
| 5 | B5 | Doc 2 Phase B5, Doc 4 §4.1 |
| 6 | F1 | Doc 1 §2, §4, Phase F1 |
| 7 | F2 | Doc 1 §3, Phase F2 |
| 8 | F3 | Doc 1 §3, Phase F3 |
| 9 | F4 | Doc 1 §3, Phase F4 |
| 10 | F5 | Doc 1 §3, Phase F5 |
| 11 | Q | Doc 3 §2 step 11, Doc 4 §4 |
| - | D | Doc 4 §5 |
| - | R | D-8 |

---

## Appendix A8 - Standing rules for every prompt in this plan

From Doc 3 §3.1-3.3, these apply to every phase regardless of which tool you use:

1. **One phase per prompt.** Never let a single prompt span backend and frontend - Doc 3 calls mixed-scope prompts *"the #1 cause of mismatched API contracts."*
2. **Attach the relevant section table, not the whole document** (Doc 3 §3.2).
3. **After every backend phase, ask the tool to list the resulting routes** and paste them back, so `docs/backend-contract.md` stays accurate (Doc 3 §3.1).
4. **Smoke-test before advancing.** Every phase here has an exit gate for exactly this reason.
5. **Build animation-heavy and 3D components in isolation first**, confirm performance, then integrate (Doc 3 §3.1).
6. **Keep the contract and design tokens as files in the repo**, re-read each session rather than re-pasted (Doc 3 §3.1, §3.3).
7. **Update `CHANGELOG.md` after every phase** - agentic multi-file changes are hard to eyeball diff-by-diff (Doc 3 §3.2).
8. **Correct drift with scoped fixes**, never full regeneration (Doc 3 §4).
9. **If the contract must change after F1 starts:** update `docs/backend-contract.md` first, then re-prompt only the affected frontend slice (Doc 3 §1).
