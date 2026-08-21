# जीवनदान / Jivandan

**A real-time blood donation and inventory network.**

Live stock across every blood bank, compatibility matching when the exact group
runs out, and a request you can watch move from submitted to fulfilled.

The problem it addresses is not a shortage of donors - it is that nobody can see
the stock. A hospital rings around; a bank has two units of O− expiring in three
days and no one to give them to. Jivandan makes the inventory visible and
matches against it.

---

## What it does

**Donors** get a 56-day eligibility countdown, a scannable digital pass, and
only the requests their blood group can actually serve.

**Blood banks** get a live eight-group stock matrix, an expiry radar for units
approaching their 42-day shelf life, unit check-in, and a request queue ordered
by urgency.

**Hospitals** raise an emergency request in four steps and watch it advance,
with substitute blood groups surfaced automatically when stock is short.

**Administrators** get a bank verification queue, platform metrics, and an
append-only audit log of every state change.

---

## Tech

| Layer | Stack |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind, TanStack Query, React Router, Leaflet, Recharts, Framer Motion |
| Backend | Node 18+, Express, MongoDB via Mongoose, JWT, Zod, Helmet, express-rate-limit |
| Tests | Jest + Supertest, `mongodb-memory-server` |

---

## Quick start

You do **not** need MongoDB installed - the backend ships a disposable in-memory
one that runs as a single-node replica set, so transactions work.

```bash
# terminal 1 - database
cd backend
npm install
npm run db                 # prints a MONGO_URI; leave this running

# terminal 2 - API
cd backend
cp .env.example .env       # paste the printed MONGO_URI into it
npm run seed:reset
npm run dev                # http://localhost:5000

# terminal 3 - web
cd frontend
npm install
cp .env.example .env
npm run dev                # http://localhost:5173
```

Confirm the API is alive:

```bash
curl -s localhost:5000/api/health
# {"success":true,...,"data":{"status":"ok","db":"connected",...}}
```

For a persistent database, point `MONGO_URI` at a real MongoDB or an Atlas
cluster and skip `npm run db`.

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

> Sign-in needs the **role** as well as the email and password. The API rejects a
> login whose role does not match the account, so pick the right tab.

The seed is shaped so every screen has something real to render: donors at all
three eligibility states, banks at all three verification states, groups that are
healthy / low / empty, a batch inside the 7-day expiry window and one already
expired, and requests at every urgency and every non-terminal status.

---

## Layout

```
backend/     REST API          - see backend/README.md
frontend/    React SPA         - see frontend/README.md
docs/        implementation plan and the API contract
```

```
backend/src/
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

The interesting logic lives in `services/`, not in controllers:

| Service | Responsibility |
|---|---|
| `compatibility.js` | ABO/Rh matrix; substitute ranking that preserves rare stock |
| `eligibility.js` | 56-day donor interval, computed on UTC day boundaries |
| `inventory.js` | check-in, FEFO consumption, manual adjustment, reconciliation |
| `expiryRadar.js` | 42-day expiry sweep, near-expiry radar, low-stock flagging |
| `requestLifecycle.js` | the request status machine and the tracker stepper payload |
| `notification.js` | urgency hook behind a swappable provider interface |
| `activityLogger.js` | one audit entry per state-changing action |

---

## API

28 routes. `npm run routes` in `backend/` prints the full map; the contract is
in [`docs/backend-contract.md`](docs/backend-contract.md).

| Area | Routes |
|---|---|
| Health | `GET /api/health` |
| Auth | `POST /api/auth/register`, `/login`, `/logout`, `/forgot-password`, `/reset-password` · `GET /api/auth/me` |
| Donors | `GET /api/donors/me`, `/me/pass`, `/feed` · `PATCH /api/donors/me` |
| Banks | `GET /api/banks/`, `/:id`, `/:id/inventory`, `/:id/expiry-radar` · `PATCH /api/banks/:id/inventory` · `POST /api/banks/:id/checkin`, `/:id/reconcile` |
| Requests | `GET /api/requests/`, `/:id`, `/match/:bloodGroup` · `POST /api/requests/` · `PATCH /api/requests/:id/status` |
| Admin | `GET /api/admin/metrics`, `/logs`, `/banks/pending` · `PATCH /api/admin/banks/:id/verify` |

Every response uses the same envelope:

```json
{ "success": true, "message": "OK", "data": { } }
```

### Domain rules the API enforces

- **56 days** between donations, computed on UTC day boundaries so a timezone
  cannot make a donor eligible a day early.
- **42-day** shelf life per unit, swept nightly and again on read, with a 7-day
  near-expiry radar.
- **FEFO** consumption - first to expire, first out - so nothing expires on the
  shelf while newer stock is issued.
- **Compatibility** in both directions: who can receive this group, and which
  groups can serve this request, ranked so rare stock is spent last.
- **Status machine** - a request cannot jump from `pending` straight to
  `fulfilled`; every transition is validated and written to the audit log.

---

## Configuration

Neither `.env` is committed. Each app ships a `.env.example` listing every key
with a safe placeholder - copy it and fill in real values locally.

The backend validates its environment at boot and refuses to start on a missing
or malformed key, so a bad value fails immediately and loudly rather than at the
first request that needs it.

Keys worth knowing (`backend/.env`):

| Key | Meaning |
|---|---|
| `MONGO_URI` | connection string; the database name must be in the path |
| `JWT_SECRET` / `SESSION_SECRET` | signing secrets |
| `CORS_ORIGINS` | comma-separated allowed origins |
| `DONATION_INTERVAL_DAYS` | 56 |
| `UNIT_SHELF_LIFE_DAYS` | 42 |
| `EXPIRY_RADAR_DAYS` | 7 |
| `LOW_STOCK_THRESHOLD` | units below which a group flags low |
| `USE_TRANSACTIONS` | needs a replica set; `npm run db` provides one |
| `DNS_SERVERS` | override the resolver when `mongodb+srv://` cannot look up SRV |

---

## Scripts

| Command | Where | What it does |
|---|---|---|
| `npm run dev` | both | dev server with reload |
| `npm run db` | backend | disposable in-memory MongoDB replica set |
| `npm run db:check` | backend | diagnoses the DB connection layer by layer |
| `npm run seed` / `seed:reset` | backend | add what is missing / wipe then seed |
| `npm run verify` | backend | boots a throwaway DB and walks the entire API |
| `npm run routes` | backend | prints every registered route |
| `npm test` | backend | Jest + Supertest |
| `npm run build` | frontend | typecheck and production bundle |
| `npm run typecheck` | frontend | `tsc --noEmit` |

### Verification

`npm run verify` spins up an in-memory replica set, seeds it, and exercises all
53 behaviours the QA checklist calls for - including the ones easy to get subtly
wrong: the 42-day expiry arithmetic, the 56-day rule on the write path, the
compatibility matrix in both directions, FEFO consumption, the rejected
`pending → fulfilled` jump, and one audit entry per mutation. It needs nothing
installed and leaves nothing behind.

```
53/53 checks passed
```

---

## Troubleshooting

**`querySrv ECONNREFUSED`** - Node asked the system resolver for the SRV record
and the local stub resolver does not answer SRV, so `mongodb+srv://` never
starts. Set `DNS_SERVERS=8.8.8.8,1.1.1.1`. Do **not** work around it by listing
the shard hosts directly: that bypasses the SRV name Atlas uses for SNI routing
on shared tiers, appears to work, then fails intermittently with a TLS alert.

**`querySrv ENOTFOUND <fragment-of-your-password>`** - the password contains a
character that must be percent-encoded. `@` is the usual culprit and must be
`%40`, otherwise the driver splits the URI at the wrong `@` and treats part of
the password as the hostname.

**`bad auth : authentication failed`** - TLS succeeded, so DNS and the network
are fine; the credentials are wrong. Check Atlas → Database Access.

**TLS alert number 80** - Atlas returns this when the connecting IP is not in
the cluster's Network Access list.

**The database name is missing.** Atlas copies the string as
`...mongodb.net/?appName=...`, with nothing between the `/` and the `?`. The
driver then silently uses a database called `test`. Put the name in:
`...mongodb.net/jivandan?retryWrites=true&w=majority`.

`npm run db:check` walks these four layers separately and names the one that
failed, rather than the driver's catch-all error that blames the IP allowlist
whatever the real cause.

---

## Not built here

Per the build sequence, these come after the frontend or at deploy time:

- **Real SMS/push delivery.** `services/notification.js` defines the interface
  and ships a console implementation; swap it via `SMS_PROVIDER_KEY`.
- **WebSockets.** The frontend polls (5s tracker, 15s stock, 30s feed).
  Socket.IO is an optional post-QA addition that changes no REST contract.

---

## Copyright

© anilratn 2026. All rights reserved.
