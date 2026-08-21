# Jivandan - Backend Contract (as built)

Single source of truth for the API. Generated from the running server and verified by `npm run verify` (53/53) and `npm test` (84/84).

**This contract is frozen for the duration of the frontend build.** If something must change, change it here first, then re-prompt only the affected frontend slice (Doc 3 §1).

Base URL: `http://localhost:5000` · All routes prefixed `/api`

---

## 1. Response envelope

Every response, success or failure:

```jsonc
// success
{ "success": true, "message": "OK", "data": { /* ... */ } }

// paginated list
{ "success": true, "message": "OK", "data": [ /* ... */ ],
  "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 } }

// failure
{ "success": false, "message": "Validation failed",
  "errors": [ { "field": "units", "message": "must be at least 1", "code": "too_small" } ] }
```

`errors` is field-keyed so a 422 maps directly onto React Hook Form fields.

| Status | Meaning |
|---|---|
| 200 / 201 | success / created |
| 400 | malformed request (bad ObjectId, unparseable JSON) |
| 401 | missing, invalid or revoked token |
| 403 | authenticated but wrong role, not the owner, or bank unverified |
| 404 | not found |
| 409 | duplicate email, invalid status transition, insufficient stock |
| 422 | validation failure, ineligible donor, invalid reset token |
| 429 | rate limited |
| 500 | unhandled (envelope only; no stack trace in production) |

**Pagination** on every list route: `?page=1&limit=20`. Default 20, maximum 100.

**Auth**: `Authorization: Bearer <token>`, or the httpOnly session cookie set at login. Tokens last 7 days. A password change revokes every earlier token.

**CSRF**: a request authenticated by the **session cookie** must send `X-Requested-With: XMLHttpRequest` on any state-changing method (POST/PATCH/PUT/DELETE), or it is refused with 403. A cross-site page cannot set a custom header without a CORS preflight, which the origin allowlist refuses. Bearer-authenticated requests are exempt - an attacker's page cannot read the token, so they are not forgeable. This is what makes `COOKIE_SAMESITE=none` viable for a cross-origin deployment.

---

## 2. Enums

```ts
type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
type Role       = 'donor' | 'blood-bank' | 'hospital' | 'admin';
type Urgency    = 'low' | 'medium' | 'high' | 'critical';

type RequestStatus =
  | 'pending'       // UI label: Submitted
  | 'under_review'  // UI label: Review
  | 'approved'
  | 'dispatched'
  | 'fulfilled'     // terminal
  | 'rejected'      // terminal
  | 'cancelled';    // terminal

type VerificationStatus = 'pending' | 'verified' | 'rejected';
type DonationStatus     = 'available' | 'reserved' | 'used' | 'expired';
```

### Request status machine

```
pending ──> under_review ──> approved ──> dispatched ──> fulfilled
   │             │              │
   └──> rejected └──> rejected  └──> rejected
   │
   └──> cancelled     (requester only, while pending | under_review)
```

| From | Allowed to | Who |
|---|---|---|
| `pending` | `under_review`, `rejected`, `cancelled` | bank/admin; requester cancels |
| `under_review` | `approved`, `rejected`, `cancelled` | bank/admin; requester cancels |
| `approved` | `dispatched`, `rejected` | bank/admin |
| `dispatched` | `fulfilled` | bank/admin |
| terminal | - | - |

Anything else → `409 Invalid status transition: <from> -> <to>`.
Every response carrying a request also carries `stepper.nextStatuses`, so the UI can offer only legal moves.

### Blood compatibility

`compatibleDonorsFor(recipient)` - which units a patient may receive:

| Recipient | Compatible donors |
|---|---|
| `O-` | O− |
| `O+` | O−, O+ |
| `A-` | O−, A− |
| `A+` | O−, O+, A−, A+ |
| `B-` | O−, B− |
| `B+` | O−, O+, B−, B+ |
| `AB-` | O−, A−, B−, AB− |
| `AB+` | all eight |

`canDonateTo(donor)` is the transpose (O− serves all eight; AB+ serves only AB+). The **donor feed uses `canDonateTo`**; **substitute matching uses `compatibleDonorsFor`**.

---

## 3. Business rules the API enforces

| Rule | Value | Enforced where |
|---|---|---|
| Donor re-donation interval | **56 days** | `POST /banks/:id/checkin` returns 422 with `nextEligibleDate` |
| Unit shelf life | **42 days** from `donationDate` | auto-set on every ledger row |
| Expiry radar window | **7 days** (configurable) | `GET /banks/:id/expiry-radar` |
| Low stock | below the bank's `lowStockThreshold` | `isLow` on every inventory group |
| Fulfilment | consumes stock **first-expiring-first-out**, atomically with the status change | 409 + shortfall if stock is short |
| Unverified banks | excluded from search, cannot check donors in, cannot receive requests | RBAC middleware |
| Audit | one `activitylogs` entry per state-changing action | every mutating controller |

---

## 4. Routes

Legend - **Auth**: `-` public · `any` any signed-in role · otherwise the roles allowed.

### 4.1 System

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | - | `{ status, version, env, uptimeSeconds, db, timestamp }` |

### 4.2 Auth

| Method | Route | Auth | Body / notes |
|---|---|---|---|
| POST | `/api/auth/register` | - | role-aware; see below. Returns `{ token, role, user }` |
| POST | `/api/auth/login` | - | `{ email, password, role }` → `{ token, role, user }` |
| POST | `/api/auth/logout` | any | clears the session |
| POST | `/api/auth/forgot-password` | - | `{ email, role }`. Always 200. In non-production the response also carries `resetToken` |
| POST | `/api/auth/reset-password` | - | `{ token, role, newPassword }`. Single use, 15-minute expiry |
| GET | `/api/auth/me` | any | `{ role, user, eligibility? }` |

**`role` is required on login.** Each identity collection has its own unique index on email, so the same address can exist under two roles; `role` selects the collection. The login screen's role switcher supplies it.

Registration body by role:

```jsonc
// donor
{ "role": "donor", "name", "email", "password", "contact",
  "dob": "1995-04-12", "gender": "female|male|other|prefer_not_to_say",
  "bloodgroup": "O-", "city"?, "state"?, "pincode"?, "coordinates"?: [lng, lat] }

// blood-bank
{ "role": "blood-bank", "name", "email", "password", "contact",
  "address", "city", "state", "pincode",
  "coordinates"?: [lng, lat], "licenseNumber"?, "lowStockThreshold"? }

// hospital
{ "role": "hospital", "name", "email", "password", "contact",
  "address", "city", "state", "pincode",
  "coordinates"?: [lng, lat], "registrationNumber"? }
```

`role: "admin"` is refused - admins are seeded from `.env`.
Coordinates are **[longitude, latitude]**, GeoJSON order.
Registration rejects an email already used under *any* role with 409.

### 4.3 Donor - all routes are the signed-in donor's own record

| Method | Route | Auth | Returns |
|---|---|---|---|
| GET | `/api/donors/me` | donor | `{ profile, eligibility, impact, canDonateTo }` |
| PATCH | `/api/donors/me` | donor | `{ profile }`. Accepts `name, contact, profileImageUrl, city, state, pincode, coordinates` only - any other field is a 422 |
| GET | `/api/donors/me/pass` | donor | `{ pass, eligibility, impact, badges, timeline }` |
| GET | `/api/donors/feed` | donor | paginated open requests this donor can serve |

```jsonc
// eligibility (also on GET /auth/me for donors)
{ "eligible": false, "nextEligibleDate": "2026-10-02T…", "daysRemaining": 44,
  "lastDonationDate": "2026-08-07T…", "intervalDays": 56,
  "progress": 0.214,            // 0..1 through the window -- drives the dashboard ring
  "reason": "44 day(s) remaining in the 56-day interval" }

// impact -- for the animated counters
{ "totalDonations": 3, "totalUnits": 5, "livesImpactedEstimate": 15,
  "firstDonation": "…", "lastDonation": "…" }

// pass -- qrPayload is the exact string to encode in the QR image
{ "qrPayload": "eyJhbGciOi…", "donorId", "name", "bloodgroup", "memberSince" }

// badges
[ { "id": "first_drop", "label": "First Drop", "at": 1, "earned": true, "remaining": 0 }, … ]
```

`GET /api/donors/feed` query: `page, limit, city, lat, lng, radius, urgency`.
Sorted urgency-desc then oldest-first. `meta` adds `donorBloodGroup` and `servableGroups`.
Each item: `{ id, bloodGroup, units, urgency, status, hospitalName, patientName, requiredBy, createdAt, bank, isExactMatch }`.

### 4.4 Blood bank & inventory

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/banks` | any | geospatial search |
| GET | `/api/banks/:id` | any | `{ bank, inventory }` |
| GET | `/api/banks/:id/inventory` | any | the 8-group matrix |
| PATCH | `/api/banks/:id/inventory` | owner, admin | `{ inventory: { "A+": 12 }, reason? }` |
| POST | `/api/banks/:id/checkin` | owner (verified) | `{ passToken \| donorId, units?, donationDate?, notes? }` |
| GET | `/api/banks/:id/expiry-radar` | owner, admin | `?windowDays=` |
| POST | `/api/banks/:id/reconcile` | owner, admin | rebuilds the cached counts from the ledger |

```jsonc
// GET /api/banks/:id/inventory -- all eight groups ALWAYS present, including zeros
{ "bankId", "bankName", "verificationStatus", "lowStockThreshold": 10,
  "expiryWindowDays": 7, "totalUnits": 32,
  "groups": [
    { "bloodGroup": "O+", "units": 14, "isLow": false, "isEmpty": false,
      "expiringSoon": 0, "canServe": ["O+","A+","B+","AB+"] }, … ],
  "inventory": { "A+": 12, "A-": 0, … },
  "lowStock": [ { "bloodGroup": "B+", "units": 2, "threshold": 10,
                  "shortfall": 8, "severity": "warning" } ] }

// GET /api/banks/:id/expiry-radar
{ "bankId", "bankName", "windowDays": 7, "shelfLifeDays": 42, "totalUnitsAtRisk": 4,
  "byGroup":  [ { "bloodGroup": "O-", "units": 2, "soonestDays": 2 } ],
  "batches":  [ { "donationId", "bloodGroup": "O-", "units": 2,
                  "donationDate", "expiryDate", "daysToExpiry": 2,
                  "donorName", "severity": "critical" } ],   // severity: <=2d critical, else warning
  "lowStock": { "bankId", "threshold": 10, "groups": [ … ], "isDepleted": true } }

// POST /api/banks/:id/checkin -> 201
{ "donation": { …, "expiryDate": "donationDate + 42d" },
  "donor": { "id", "name", "bloodgroup", "lastDonationDate", "eligibility" },
  "inventory": { "O-": 4, … } }
```

Check-in verifies the QR signature, then re-reads the donor from the database - nothing in the token is trusted beyond identifying whom to look up. An ineligible donor is refused:

```jsonc
// 422
{ "success": false,
  "message": "Donor is not yet eligible. Next eligible on 2026-10-14.",
  "errors": [ { "field": "donorId",
                "message": "54 day(s) remaining in the 56-day interval",
                "nextEligibleDate": "2026-10-14T…" } ] }
```

**`GET /api/banks`** query: `lat, lng, radius, city, pincode, bloodGroup, minUnits, page, limit`.

- `lat` + `lng` (must be supplied together, else 422) → `$geoNear` within `radius` **metres**. The UI offers 5000 / 10000 / 25000.
- Otherwise → exact `city` / `pincode` match.
- **Only `verificationStatus: "verified"` banks are ever returned.**

Each result: `{ id, name, contact, address, city, state, pincode, location, distanceMeters, matchedBy, verificationStatus, lowStockThreshold, inventory, totalUnits, unitsForRequestedGroup }`.
`matchedBy` is `"radius"` or `"city"`; `distanceMeters` is `null` in city mode. `meta` adds `searchMode` and `radiusMeters`.

### 4.5 Blood requests

| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/api/requests` | donor, hospital | rate-limited 20/hour per account |
| GET | `/api/requests` | any | scoped by role (see below) |
| GET | `/api/requests/:id` | requester, assigned bank, admin | otherwise 403 |
| PATCH | `/api/requests/:id/status` | bank, admin, requester (cancel only) | state machine |
| GET | `/api/requests/match/:bloodGroup` | bank, hospital, admin | `?bankId=&units=` |

```jsonc
// POST /api/requests
{ "bloodGroup": "O+", "units": 3, "urgency": "critical",
  "bloodBank"?: "<id>", "patientName"?, "hospitalName"?, "notes"?, "requiredBy"? }

// -> 201
{ "request": { … }, "stepper": { … }, "substitutes": { … } | null,
  "notified": { "channel": "console", "donorsNotified": 3, "banksNotified": 3 } | null }
```

`notified` is non-null only at `critical` urgency. A notification failure never fails the request.

```jsonc
// stepper -- on every response carrying a request
{ "steps": [ { "status": "pending", "label": "Submitted",
               "at": "2026-08-19T15:04:23Z", "complete": true, "current": false }, … ],
  "currentStatus": "dispatched", "currentLabel": "Dispatched", "currentIndex": 3,
  "isTerminal": false,
  "derailed": false, "derailedAs": null,   // true for rejected/cancelled -- branch off the line
  "nextStatuses": ["fulfilled"] }          // the ONLY moves the UI should offer

// substitutes -- from GET /requests/match/:bloodGroup and on requests with an assigned bank
{ "requestedGroup": "AB+", "unitsRequested": 2,
  "exactAvailable": false, "exactUnits": 0, "shortfall": 2, "totalCompatibleUnits": 31,
  "options": [ { "bloodGroup": "B+", "unitsAvailable": 2,
                 "isExactMatch": false, "coversRequest": true }, … ] }
```

`options` are ordered: exact match first, then those that cover the request, then commonest-first so rare stock is preserved (O− is offered last).

```jsonc
// PATCH /api/requests/:id/status
{ "status": "fulfilled", "note"?, "reason"?, "fulfillFromGroup"? }
// -> { "request", "stepper", "consumed": [ { "donation", "bloodGroup", "units" } ] }
```

`reason` is required when rejecting. `fulfillFromGroup` draws from a compatible substitute; an incompatible group is 422. Insufficient stock is 409 and the status does **not** advance.

**`GET /api/requests`** query: `page, limit, urgency, status, bank, bloodGroup, mine`. Scope:
- **donor / hospital** - only their own requests
- **blood-bank** - requests assigned to them, plus unassigned ones they could pick up
- **admin** - everything (`?bank=` to filter)

Each item adds `nextStatuses` and `isTerminal`.

### 4.6 Admin - all admin-only (403 for every other role)

| Method | Route | Notes |
|---|---|---|
| GET | `/api/admin/metrics` | one `$facet` aggregation; safe to poll |
| GET | `/api/admin/banks/pending` | paginated verification queue |
| PATCH | `/api/admin/banks/:id/verify` | `{ action: "approve" \| "reject", reason? }` |
| GET | `/api/admin/logs` | `?page,limit,user,action,from,to` |

```jsonc
// GET /api/admin/metrics
{ "generatedAt",
  "users":     { "donors": 12, "hospitals": 3,
                 "banks": { "verified": 3, "pending": 1, "rejected": 1 } },
  "requests":  { "total": 11, "byStatus": {…}, "byUrgency": {…},
                 "byBloodGroup": [ { "bloodGroup", "requests", "units" } ],
                 "fulfilmentRate": 9.1, "medianTimeToFulfilHours": 0.4 },
  "inventory": { "totalUnits": 57, "byBloodGroup": { "A+": 12, … },
                 "expiringWithinDays": 7, "unitsExpiringSoon": 5, "batchesExpired": 1 },
  "donations": { "total": 13,
                 "weeklyTrend": [ { "year", "week", "label": "2026-W33",
                                    "donations", "units" } ] } }   // <- Recharts series
```

Rejecting a bank **requires** `reason` (422 without it). Approving makes the bank appear in `GET /api/banks` immediately.

The audit log is **append-only** - there is no route anywhere that updates or deletes an entry. Log actions: `register, login, logout, password_reset_request, password_reset, profile_update, inventory_adjust, donation_checkin, inventory_reconcile, units_expired, request_create, request_status_change, bank_verify` (also returned in `meta.availableActions`).

---

## 5. Rate limits

| Scope | Limit |
|---|---|
| `/api/auth/*` | 10 per 15 min per IP |
| `POST /api/requests` | 20 per hour per account |
| everything under `/api` | 300 per 15 min |

Exceeding a limit returns 429 in the standard envelope.

---

## 6. Data model (as built)

Seven collections. Model names equal collection names, because Mongoose resolves `refPath` against the model name and `BloodRequest.requesterModel` stores a collection name.

| Collection | Notes vs. Doc 2 §3 |
|---|---|
| `donors` | as specified, plus `age` / `nextEligibleDate` / `isEligible` / `daysUntilEligible` virtuals and optional `location` |
| `blood-banks` | plus `verificationStatus`, `licenseNumber`, `verifiedBy`, `verifiedAt`, `rejectionReason`, `location` (2dsphere), `lowStockThreshold` |
| `hospitals` | **added** - Doc 2 names the role but defines no collection |
| `admins` | **added** - referenced by `ActivityLog.userModel` but never specified |
| `bloodrequests` | `requester` is a `refPath` over `requesterModel` (`donors` \| `hospitals`); status enum extended; plus `statusHistory`, `fulfilledAt`, `consumedFrom` |
| `donationhistories` | plus `status` and `unitsRemaining`, without which expiry could never decrement the cached counts |
| `activitylogs` | `userModel` extended with `hospitals` |

**`donationhistories` is the source of truth for stock**; `blood-banks.inventory` is a denormalised `Map<BloodGroup, Number>` kept in step by the inventory service so the 8-group matrix is a single-document read. Both are written together inside a transaction where the deployment supports one; `POST /api/banks/:id/reconcile` repairs any drift.

---

## 7. Seeded data (`npm run seed:reset`)

Password for every account: `Passw0rd!`

| Role | Email | Shape |
|---|---|---|
| admin | `admin@jivandan.in` | super-admin |
| donor | `asha0@donor.test` | O−, never donated → **eligible** |
| donor | `meera2@donor.test` | A+, 12 days ago → **mid-window** |
| donor | `rohan1@donor.test` | O+, 70 days ago → eligible |
| blood-bank | `sahyadri@bank.test` | **verified**, Pune, stock healthy + low + empty |
| blood-bank | `dadar@bank.test` | verified, Mumbai |
| blood-bank | `indiranagar@bank.test` | verified, Bengaluru |
| blood-bank | `navimumbai@bank.test` | **pending** verification |
| blood-bank | `depot@bank.test` | **rejected** |
| hospital | `rubyhall@hospital.test` | Pune |

12 donors across all 8 groups, 12 ledger batches (one already expired, two inside the 7-day radar window), and 10 requests covering every urgency and every non-terminal status.
