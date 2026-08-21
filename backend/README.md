# Jivandan - Backend

REST API for **जीवनदान / Jivandan**, a real-time blood donation and inventory network.

Built to Document 2 (*Backend Development - Master Prompt & Implementation Plan*), phases B1-B5. The full build order and the reasoning behind every contract decision live in [`../docs/IMPLEMENTATION_PLAN.md`](../docs/IMPLEMENTATION_PLAN.md).

---

## Quick start

You do **not** need MongoDB installed - `npm run db` starts a disposable in-memory one.

```bash
npm install

# terminal 1 - disposable MongoDB (single-node replica set, so transactions work)
npm run db

# terminal 2 - copy the printed MONGO_URI into .env, then:
cp .env.example .env      # edit MONGO_URI + secrets
npm run seed:reset
npm run dev
```

The API comes up on <http://localhost:5000>. Check it:

```bash
curl -s localhost:5000/api/health
```

For a persistent database, point `MONGO_URI` at a local MongoDB or an Atlas cluster instead and skip `npm run db`.

### Seeded accounts

Password for every seeded account: `Passw0rd!`

| Role | Email | Notes |
|---|---|---|
| admin | `admin@jivandan.in` | from `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| donor | `asha0@donor.test` | O−, never donated → eligible |
| donor | `meera2@donor.test` | A+, donated 12 days ago → mid-window |
| blood-bank | `sahyadri@bank.test` | verified, stock across all states |
| blood-bank | `navimumbai@bank.test` | awaiting verification |
| blood-bank | `depot@bank.test` | verification rejected |
| hospital | `rubyhall@hospital.test` | |

The seed is deliberately shaped so every frontend screen has something real to render: donors at all three eligibility states, banks at all three verification states, blood groups that are healthy / low / empty, a batch inside the 7-day expiry window and one already expired, and requests at every urgency and every non-terminal status.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | nodemon, reloads on change |
| `npm start` | production start |
| `npm run db` | disposable in-memory MongoDB replica set |
| `npm run db:check` | diagnose the DB connection layer by layer |
| `npm run seed` | add anything missing |
| `npm run seed:reset` | wipe the domain collections, then seed |
| `npm run verify` | **boots a throwaway DB and walks the entire API** - the Phase B5 gate |
| `npm run routes` | print every registered route, for diffing against the contract |
| `npm test` | Jest + Supertest integration and unit tests |

### `npm run db:check`

The driver's connection error is a catch-all: it blames your IP allowlist whether the real cause is DNS, TLS, credentials or the allowlist. This walks the four layers separately and names the one that failed.

```
PASS  SRV lookup resolved 3 host(s)
PASS  TCP reachable: ac-...-00-01.jx0irlo.mongodb.net:27017
FAIL  TLS handshake failed: ... alert number 80
      Atlas returns this exact alert when the connecting IP is not in
      the cluster's Network Access list.
```

Two Atlas gotchas it catches:

- **`querySrv ECONNREFUSED`** - Node asks the system resolver for the SRV record, and on a machine whose nameserver is a local stub that does not answer SRV, `mongodb+srv://` never starts. Set `DNS_SERVERS=8.8.8.8,1.1.1.1`. Do **not** "fix" this by listing the shard hosts directly: that bypasses the SRV name Atlas uses for SNI routing on shared tiers, appears to work, and then fails intermittently with a TLS alert.
- **No database name in the URI.** Atlas copies the string as `...mongodb.net/?appName=...`, with nothing between the `/` and the `?`. The driver then uses a database called `test`. Put the name in: `...mongodb.net/jivandan?retryWrites=true&w=majority`.

### `npm run verify`

Document 3, step 5: *"RUN the API and confirm every route in the route map works."*

This spins up an in-memory replica set, seeds it, and exercises all 53 behaviours the Document 4 QA checklist calls for - including the ones that are easy to get subtly wrong: the 42-day expiry arithmetic, the 56-day rule on the write path, the compatibility matrix in both directions, FEFO consumption, the rejected `pending → fulfilled` jump, and one audit-log entry per mutation. It needs nothing installed and leaves nothing behind.

```
53/53 checks passed
```

---

## Architecture

```
src/
├── config/        env (validated at boot), db connection, domain constants
├── models/        7 Mongoose models, collection names pinned explicitly
├── services/      the domain logic - see below
├── controllers/   thin: parse, delegate to a service, respond
├── routes/        one router per resource; RBAC + validation declared here
├── middleware/    auth, rbac, validate, sanitize, rateLimit, errorHandler
├── validators/    Zod schemas, one per route
├── utils/         response envelope, ApiError, pagination, jwt, dates
└── jobs/          nightly expiry sweep
```

The interesting logic is deliberately in `services/`, not in controllers - Document 2 §5 asks for these as *"first-class backend logic, not just CRUD"*:

| Service | Responsibility |
|---|---|
| `compatibility.js` | ABO/Rh matrix; substitute ranking that preserves rare stock |
| `eligibility.js` | 56-day donor interval, computed on UTC day boundaries |
| `inventory.js` | check-in, FEFO consumption, manual adjustment, reconciliation |
| `expiryRadar.js` | 42-day expiry sweep, near-expiry radar, low-stock flagging |
| `requestLifecycle.js` | the request status machine and the tracker stepper payload |
| `notification.js` | urgency hook behind a swappable provider interface |
| `activityLogger.js` | one audit entry per state-changing action |

### Response envelope

Every response, success or failure:

```jsonc
{ "success": true,  "message": "OK", "data": { }, "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 } }
{ "success": false, "message": "Validation failed", "errors": [ { "field": "units", "message": "must be at least 1" } ] }
```

`errors` is field-keyed so the frontend can map a 422 straight onto React Hook Form fields.

| Status | Used for |
|---|---|
| 401 | missing or invalid token |
| 403 | authenticated but wrong role, or unverified bank |
| 409 | duplicate email, invalid status transition, insufficient stock |
| 422 | validation failure, ineligible donor |
| 429 | rate limited |

---

## Things worth knowing before you change anything

These are the places where the implementation had to resolve something the source documents left open. Each is marked in the code with the matching plan decision.

**The request status enum was extended (D-1).** Document 2 §3.3 lists `pending / approved / rejected / fulfilled`, but the tracker stepper and Document 2 §4.4's own PATCH route both need `review` and `dispatched`. The reconciled enum is `pending → under_review → approved → dispatched → fulfilled`, plus `rejected` and `cancelled`. Transitions are authorised in exactly one place, `services/requestLifecycle.js` - controllers never compare statuses themselves.

**The donation ledger is the source of truth; the inventory Map is a cache (D-6).** `donationhistories` holds per-batch units with their own expiry dates. `blood-banks.inventory` is a denormalised sum so the 8-group matrix is a single-document read. Every mutation updates **both**, inside a transaction where the deployment supports one. If they ever drift, `POST /api/banks/:id/reconcile` rebuilds the Map from the ledger.

**Transactions need a replica set.** Atlas has one; a standalone `mongod` does not. `USE_TRANSACTIONS` gates this, and the server warns loudly at boot if you ask for transactions the database cannot provide. `npm run db` gives you a single-node replica set, so transactions work locally.

**Login takes a `role` (D-7).** Four collections hold credentials, each with its own unique index on email - so uniqueness is per-collection only. Registration therefore checks the address against *every* identity collection, and login uses `role` to pick the right one. The login screen already has a role switcher, so this costs the user nothing.

**Model names are collection names.** Every model is registered as `donors`, `blood-banks`, and so on - the vocabulary Document 2 already uses for `ActivityLog.userModel`. This matters because Mongoose resolves `refPath` against the *model* name, and `BloodRequest.requesterModel` stores a collection name (D-2). Registering them as `Donor` / `Hospital` makes populate fail with `MissingSchemaError`.

**A password change revokes existing tokens via a counter, not a timestamp.** JWT `iat` has one-second resolution, so a token issued and a password changed within the same second are indistinguishable. `tokenVersion` is bumped on change and stamped into each token, which has no such ambiguity.

**The 56-day rule is enforced on the write path.** `POST /api/banks/:id/checkin` rejects an ineligible donor with 422 and their next eligible date. Showing eligibility on a dashboard is not the same as preventing the donation.

**Hospitals and admins have collections that Document 2 never specified (D-2, D-3).** Document 2 names four roles but defines five collections, points `BloodRequest.requester` at `donors` only, and references an `admins` collection with no schema. Both are added, and `requester` uses a `refPath` so a request can come from either a donor or a hospital. Admin accounts are seeded from `.env` - `POST /api/auth/register` refuses the admin role outright.

**The audit log is append-only.** There is deliberately no route anywhere that updates or deletes an entry, and `npm run verify` asserts that.

---

## Environment

See [`.env.example`](.env.example) for the annotated list. Beyond Document 2 §7:

| Variable | Why |
|---|---|
| `CORS_ORIGINS` | comma-separated allowlist; production admits the deployed frontend origin only |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the seeded super-admin |
| `USE_TRANSACTIONS` | true only when MongoDB is a replica set |
| `DONATION_INTERVAL_DAYS` / `UNIT_SHELF_LIFE_DAYS` | 56 and 42 - policy, not constants; regions differ |
| `EXPIRY_RADAR_DAYS` / `LOW_STOCK_THRESHOLD` | radar window and default depletion threshold |

`src/config/env.js` fails fast on missing secrets and refuses to start in production with a development-looking `JWT_SECRET`.

---

## Manual verification

`postman/Jivandan.postman_collection.json` - 38 requests covering every route, grouped in the order you would exercise them. The four `Auth / Sign in as …` requests capture their own tokens into collection variables, so run those first and everything else is ready to go.

---

## Not built here

Per the build sequence, these come after the frontend or at deploy time:

- **Real SMS/push delivery.** `services/notification.js` defines the interface and ships a console implementation; swap it at Phase D via `SMS_PROVIDER_KEY`.
- **WebSockets.** The frontend polls (5s tracker, 15s stock, 30s feed). Socket.IO is an optional post-QA addition that changes no REST contract.

---

## Copyright

© anilratn 2026. All rights reserved.
