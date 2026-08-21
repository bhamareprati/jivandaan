'use strict';

/**
 * Phase B5 exit gate (Doc 3 step 5):
 *   "RUN the API and confirm every route in the route map works."
 *
 * Boots an in-memory MongoDB replica set (a replica set specifically, so the
 * transactional inventory path in plan decision D-6 is genuinely exercised),
 * seeds it, then walks the whole contract as each role and asserts the
 * behaviour the QA checklist in Doc 4 section 4.1 calls for.
 *
 *   npm run verify
 */

const path = require('path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const results = [];
let mongo;
let app;
let request;

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const mark = passed ? '  PASS' : '  FAIL';
  console.log(`${mark}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail);
    return true;
  } catch (err) {
    record(name, false, err.message);
    return false;
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function assertStatus(res, expected, label) {
  if (res.status !== expected) {
    const body = JSON.stringify(res.body).slice(0, 300);
    throw new Error(`${label}: expected ${expected}, got ${res.status} -- ${body}`);
  }
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  console.log('\nStarting in-memory MongoDB replica set (first run downloads a binary)...');
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = mongo.getUri('jivandan_verify');

  process.env.NODE_ENV = 'development';
  process.env.MONGO_URI = uri;
  process.env.JWT_SECRET = 'verify-only-jwt-secret-not-for-production-use';
  process.env.SESSION_SECRET = 'verify-only-session-secret-not-for-production';
  process.env.ADMIN_EMAIL = 'admin@jivandan.in';
  process.env.ADMIN_PASSWORD = 'Passw0rd!';
  process.env.USE_TRANSACTIONS = 'true';
  process.env.RATE_LIMIT_ENABLED = 'false';
  process.env.ENABLE_CRON = 'false';
  process.env.BCRYPT_ROUNDS = '4';

  // Required before anything reads config.
  const db = require('../src/config/db');
  const txn = require('../src/services/txn');
  await db.connect(uri);
  txn.setSupported(await db.supportsTransactions());
  console.log(`Replica set ready. Transactions: ${txn.isEnabled() ? 'ENABLED' : 'disabled'}\n`);

  console.log('Seeding...');
  // In-process: spawning seed.js as a child from here deadlocks, because this
  // parent already holds a Mongoose connection and execFileSync blocks its
  // event loop while the child competes for the same server.
  const seed = require(path.resolve(__dirname, 'seed.js'));
  await seed({ reset: true, quiet: true });
  console.log('Seeded.\n');

  request = require('supertest');
  app = require('../src/app')({ mongoUri: uri });
}

/* ------------------------------------------------------------------ main */

const api = (method, url) => request(app)[method](url);
const auth = (r, token) => r.set('Authorization', `Bearer ${token}`);

async function main() {
  await boot();

  const {
    Donor, BloodBank, Hospital, BloodRequest, DonationHistory, ActivityLog,
  } = require('../src/models');

  const tokens = {};
  const ids = {};

  console.log('='.repeat(72));
  console.log('  SYSTEM');
  console.log('='.repeat(72));

  await check('GET  /api/health', async () => {
    const res = await api('get', '/api/health');
    assertStatus(res, 200, 'health');
    assert(res.body.data.db === 'connected', 'db not connected');
    return `db=${res.body.data.db}`;
  });

  await check('GET  /api/unknown -> 404 envelope', async () => {
    const res = await api('get', '/api/nope');
    assertStatus(res, 404, '404');
    assert(res.body.success === false, 'envelope missing success:false');
    return res.body.message.slice(0, 40);
  });

  console.log('\n' + '='.repeat(72));
  console.log('  AUTH & RBAC  (Doc 4 section 4.1)');
  console.log('='.repeat(72));

  await check('POST /api/auth/register  donor', async () => {
    const res = await api('post', '/api/auth/register').send({
      role: 'donor', name: 'Verify Donor', email: 'verify.donor@test.in',
      password: 'Passw0rd!', contact: '9876500011', dob: '1994-02-11',
      gender: 'female', bloodgroup: 'O-', city: 'Pune',
    });
    assertStatus(res, 201, 'register donor');
    tokens.newDonor = res.body.data.token;
    ids.newDonor = res.body.data.user.id || res.body.data.user._id;
    assert(!('password' in res.body.data.user), 'password leaked in response');
    return 'token issued, password not serialised';
  });

  await check('POST /api/auth/register  blood-bank', async () => {
    const res = await api('post', '/api/auth/register').send({
      role: 'blood-bank', name: 'Verify Bank', email: 'verify.bank@test.in',
      password: 'Passw0rd!', contact: '02011110000', address: '1 Test Road',
      city: 'Pune', state: 'Maharashtra', pincode: '411001', coordinates: [73.85, 18.52],
    });
    assertStatus(res, 201, 'register bank');
    ids.newBank = res.body.data.user.id || res.body.data.user._id;
    return 'created (verificationStatus=pending)';
  });

  await check('POST /api/auth/register  hospital', async () => {
    const res = await api('post', '/api/auth/register').send({
      role: 'hospital', name: 'Verify Hospital', email: 'verify.hospital@test.in',
      password: 'Passw0rd!', contact: '02022220000', address: '2 Test Road',
      city: 'Pune', state: 'Maharashtra', pincode: '411002',
    });
    assertStatus(res, 201, 'register hospital');
    return 'created';
  });

  await check('POST /api/auth/register  admin role refused', async () => {
    const res = await api('post', '/api/auth/register').send({
      role: 'admin', name: 'Sneaky', email: 'sneaky@test.in', password: 'Passw0rd!',
    });
    assert(res.status === 403 || res.status === 422, `expected 403/422, got ${res.status}`);
    return `blocked with ${res.status}`;
  });

  await check('POST /api/auth/register  duplicate email -> 409 (cross-collection)', async () => {
    // Registered above as a donor; now try the same address as a blood bank.
    const res = await api('post', '/api/auth/register').send({
      role: 'blood-bank', name: 'Clash', email: 'verify.donor@test.in',
      password: 'Passw0rd!', contact: '02033330000', address: '3 Test Road',
      city: 'Pune', state: 'Maharashtra', pincode: '411003',
    });
    assertStatus(res, 409, 'duplicate email');
    return 'donor email rejected for a bank registration';
  });

  await check('POST /api/auth/register  invalid body -> 422 field errors', async () => {
    const res = await api('post', '/api/auth/register').send({
      role: 'donor', name: 'X', email: 'not-an-email', password: 'short',
    });
    assertStatus(res, 422, 'validation');
    assert(Array.isArray(res.body.errors) && res.body.errors.length, 'no errors array');
    assert(res.body.errors[0].field, 'errors are not field-keyed');
    return `${res.body.errors.length} field errors`;
  });

  await check('POST /api/auth/login  all four roles', async () => {
    const creds = [
      ['donor', 'asha0@donor.test'],
      ['blood-bank', 'sahyadri@bank.test'],
      ['hospital', 'rubyhall@hospital.test'],
      ['admin', 'admin@jivandan.in'],
    ];
    for (const [role, email] of creds) {
      const res = await api('post', '/api/auth/login').send({ email, password: 'Passw0rd!', role });
      assertStatus(res, 200, `login ${role}`);
      assert(res.body.data.token, `no token for ${role}`);
      tokens[role] = res.body.data.token;
      ids[role] = res.body.data.user.id || res.body.data.user._id;
    }
    return 'donor, blood-bank, hospital, admin';
  });

  await check('POST /api/auth/login  wrong password -> 401', async () => {
    const res = await api('post', '/api/auth/login')
      .send({ email: 'asha0@donor.test', password: 'WrongPass1!', role: 'donor' });
    assertStatus(res, 401, 'bad password');
    assert(res.body.message === 'Invalid credentials', 'message leaks which half failed');
    return 'generic "Invalid credentials"';
  });

  await check('GET  /api/donors/me  no token -> 401', async () => {
    const res = await api('get', '/api/donors/me');
    assertStatus(res, 401, 'no token');
    return 'rejected';
  });

  await check('GET  /api/donors/me  bad token -> 401', async () => {
    const res = await auth(api('get', '/api/donors/me'), 'not.a.real.token');
    assertStatus(res, 401, 'bad token');
    return 'rejected';
  });

  await check('RBAC  donor token -> /api/admin/metrics -> 403', async () => {
    const res = await auth(api('get', '/api/admin/metrics'), tokens.donor);
    assertStatus(res, 403, 'rbac');
    return 'forbidden as specified';
  });

  await check('RBAC  bank token -> /api/admin/logs -> 403', async () => {
    const res = await auth(api('get', '/api/admin/logs'), tokens['blood-bank']);
    assertStatus(res, 403, 'rbac');
    return 'forbidden';
  });

  await check('POST /api/auth/forgot + reset-password round trip', async () => {
    const f = await api('post', '/api/auth/forgot-password')
      .send({ email: 'asha0@donor.test', role: 'donor' });
    assertStatus(f, 200, 'forgot');
    const token = f.body.data && f.body.data.resetToken;
    assert(token, 'no reset token surfaced in dev mode');

    const r = await api('post', '/api/auth/reset-password')
      .send({ token, role: 'donor', newPassword: 'NewPassw0rd!' });
    assertStatus(r, 200, 'reset');

    const again = await api('post', '/api/auth/reset-password')
      .send({ token, role: 'donor', newPassword: 'Another1!' });
    assertStatus(again, 422, 'token reuse');

    const login = await api('post', '/api/auth/login')
      .send({ email: 'asha0@donor.test', password: 'NewPassw0rd!', role: 'donor' });
    assertStatus(login, 200, 'login with new password');
    tokens.donor = login.body.data.token;
    return 'single-use token honoured';
  });

  await check('GET  /api/auth/me', async () => {
    const res = await auth(api('get', '/api/auth/me'), tokens.donor);
    assertStatus(res, 200, 'me');
    assert(res.body.data.eligibility, 'no eligibility block for donor');
    return `role=${res.body.data.role}`;
  });

  console.log('\n' + '='.repeat(72));
  console.log('  DONOR');
  console.log('='.repeat(72));

  await check('GET  /api/donors/me  eligibility + impact', async () => {
    const res = await auth(api('get', '/api/donors/me'), tokens.donor);
    assertStatus(res, 200, 'donors/me');
    const e = res.body.data.eligibility;
    assert(typeof e.eligible === 'boolean', 'no eligible flag');
    assert(e.intervalDays === 56, `interval is ${e.intervalDays}, expected 56`);
    assert(res.body.data.impact, 'no impact stats');
    return `eligible=${e.eligible} interval=${e.intervalDays}d`;
  });

  await check('56-day gap is computed from lastDonationDate', async () => {
    const donor = await Donor.findOne({ email: 'meera2@donor.test' }); // 12 days ago
    const res = await api('post', '/api/auth/login')
      .send({ email: donor.email, password: 'Passw0rd!', role: 'donor' });
    const me = await auth(api('get', '/api/donors/me'), res.body.data.token);
    const e = me.body.data.eligibility;
    assert(e.eligible === false, 'mid-window donor reported eligible');
    assert(e.daysRemaining >= 43 && e.daysRemaining <= 45,
      `daysRemaining=${e.daysRemaining}, expected ~44`);
    const expected = new Date(donor.lastDonationDate.getTime() + 56 * 86400000);
    const got = new Date(e.nextEligibleDate);
    assert(Math.abs(got - expected) < 86400000, 'nextEligibleDate is not last + 56d');
    tokens.midWindowDonor = res.body.data.token;
    return `${e.daysRemaining}d remaining, next=${e.nextEligibleDate.slice(0, 10)}`;
  });

  await check('PATCH /api/donors/me', async () => {
    const res = await auth(api('patch', '/api/donors/me'), tokens.donor)
      .send({ contact: '9999911111', city: 'Pune' });
    assertStatus(res, 200, 'patch me');
    assert(res.body.data.profile.contact === '9999911111', 'contact not updated');
    return 'profile updated + logged';
  });

  await check('PATCH /api/donors/me  rejects role escalation', async () => {
    const res = await auth(api('patch', '/api/donors/me'), tokens.donor).send({ role: 'admin' });
    assertStatus(res, 422, 'strict schema');
    return 'unknown field refused by strict schema';
  });

  await check('GET  /api/donors/me/pass  signed QR + timeline', async () => {
    const res = await auth(api('get', '/api/donors/me/pass'), tokens.donor);
    assertStatus(res, 200, 'pass');
    const p = res.body.data.pass;
    assert(p.qrPayload && p.qrPayload.split('.').length === 3, 'qrPayload is not a JWT');
    assert(Array.isArray(res.body.data.badges), 'no badges');
    assert(Array.isArray(res.body.data.timeline), 'no timeline');
    ids.passToken = p.qrPayload;
    return `jwt payload, ${res.body.data.timeline.length} history entries`;
  });

  await check('GET  /api/donors/feed  respects canDonateTo direction', async () => {
    const res = await auth(api('get', '/api/donors/feed?limit=50'), tokens.donor);
    assertStatus(res, 200, 'feed');
    const { canDonateTo } = require('../src/services/compatibility');
    const donor = await Donor.findOne({ email: 'asha0@donor.test' });
    const allowed = canDonateTo(donor.bloodgroup);
    for (const item of res.body.data) {
      assert(allowed.includes(item.bloodGroup),
        `feed showed ${item.bloodGroup} to an ${donor.bloodgroup} donor`);
    }
    assert(res.body.meta.totalPages >= 1, 'no pagination meta');
    return `${donor.bloodgroup} donor sees only ${allowed.join('/')} (${res.body.data.length} items)`;
  });

  console.log('\n' + '='.repeat(72));
  console.log('  BLOOD BANK & INVENTORY');
  console.log('='.repeat(72));

  const bank = await BloodBank.findOne({ email: 'sahyadri@bank.test' });
  ids.bank = String(bank._id);

  await check('GET  /api/banks/:id/inventory  all 8 groups always present', async () => {
    const res = await auth(api('get', `/api/banks/${ids.bank}/inventory`), tokens['blood-bank']);
    assertStatus(res, 200, 'inventory');
    assert(res.body.data.groups.length === 8, `got ${res.body.data.groups.length} groups`);
    const empty = res.body.data.groups.filter((g) => g.isEmpty).length;
    const low = res.body.data.groups.filter((g) => g.isLow).length;
    assert(empty >= 1, 'seed should include an empty group');
    assert(low >= 1, 'seed should include a low group');
    return `8 groups, ${empty} empty, ${low} low`;
  });

  await check('GET  /api/banks/:id/expiry-radar  flags the 7-day window only', async () => {
    const res = await auth(api('get', `/api/banks/${ids.bank}/expiry-radar`), tokens['blood-bank']);
    assertStatus(res, 200, 'radar');
    const d = res.body.data;
    assert(d.batches.length > 0, 'radar found nothing; seed should include near-expiry units');
    for (const b of d.batches) {
      assert(b.daysToExpiry >= 0 && b.daysToExpiry <= d.windowDays,
        `batch at ${b.daysToExpiry}d is outside the ${d.windowDays}d window`);
    }
    assert(d.lowStock, 'no depletion block');
    return `${d.batches.length} batches at risk, window=${d.windowDays}d`;
  });

  await check('Expiry sweep removed already-expired units from the count', async () => {
    const expired = await DonationHistory.countDocuments({ status: 'expired' });
    assert(expired >= 1, 'seed should contain an expired batch');
    const rows = await DonationHistory.find({ status: 'expired' });
    for (const r of rows) assert(r.unitsRemaining === 0, 'expired row still holds units');
    return `${expired} expired batch(es), all zeroed`;
  });

  await check('PATCH /api/banks/:id/inventory  owner only', async () => {
    const res = await auth(api('patch', `/api/banks/${ids.bank}/inventory`), tokens['blood-bank'])
      .send({ inventory: { 'AB-': 5 }, reason: 'verification run' });
    assertStatus(res, 200, 'adjust');
    assert(res.body.data.inventory['AB-'] === 5, 'not applied');

    const foreign = await auth(
      api('patch', `/api/banks/${ids.bank}/inventory`), tokens.donor
    ).send({ inventory: { 'AB-': 99 } });
    assert(foreign.status === 403, `donor got ${foreign.status}, expected 403`);
    return 'applied for owner, 403 for a donor';
  });

  await check('POST /api/banks/:id/checkin  QR pass -> ledger + stock + 42d expiry', async () => {
    const before = await BloodBank.findById(ids.bank);
    const beforeUnits = before.inventory.get('O-') || 0;

    const res = await auth(api('post', `/api/banks/${ids.bank}/checkin`), tokens['blood-bank'])
      .send({ passToken: ids.passToken, units: 2 });
    assertStatus(res, 201, 'checkin');

    const d = res.body.data.donation;
    const gap = Math.round(
      (new Date(d.expiryDate) - new Date(d.donationDate)) / 86400000
    );
    assert(gap === 42, `expiry gap is ${gap} days, expected 42`);

    const after = await BloodBank.findById(ids.bank);
    const afterUnits = after.inventory.get('O-') || 0;
    assert(afterUnits === beforeUnits + 2,
      `stock went ${beforeUnits} -> ${afterUnits}, expected +2`);

    const donor = await Donor.findById(res.body.data.donor.id);
    assert(donor.lastDonationDate, 'lastDonationDate not set on the donor');
    return `ledger+stock in step, expiry=+${gap}d, donor clock reset`;
  });

  await check('POST /api/banks/:id/checkin  56-day rule enforced on the WRITE path', async () => {
    const res = await auth(api('post', `/api/banks/${ids.bank}/checkin`), tokens['blood-bank'])
      .send({ passToken: ids.passToken, units: 1 });
    assertStatus(res, 422, 'ineligible checkin');
    assert(/not yet eligible/i.test(res.body.message), 'wrong message');
    assert(res.body.errors[0].nextEligibleDate, 'no next eligible date returned');
    return 'second check-in refused with the next eligible date';
  });

  await check('POST /api/banks/:id/checkin  forged QR rejected', async () => {
    const res = await auth(api('post', `/api/banks/${ids.bank}/checkin`), tokens['blood-bank'])
      .send({ passToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZWQifQ.bad' });
    assertStatus(res, 422, 'forged pass');
    return 'signature verification failed as expected';
  });

  await check('POST /api/banks/:id/reconcile  ledger is the source of truth', async () => {
    // Deliberately corrupt the cached count, then repair it from the ledger.
    await BloodBank.updateOne({ _id: ids.bank }, { $set: { 'inventory.O+': 999 } });
    const res = await auth(api('post', `/api/banks/${ids.bank}/reconcile`), tokens['blood-bank']);
    assertStatus(res, 200, 'reconcile');
    assert(res.body.data.corrected >= 1, 'reconcile found no drift');
    assert(res.body.data.inventory['O+'] !== 999, 'drift not corrected');
    return `${res.body.data.corrected} group(s) corrected from the ledger`;
  });

  await check('GET  /api/banks  radius search (verified only, sorted by distance)', async () => {
    const res = await auth(
      api('get', '/api/banks?lat=18.5204&lng=73.8567&radius=25000'), tokens.donor
    );
    assertStatus(res, 200, 'geo search');
    assert(res.body.meta.searchMode === 'radius', 'not in radius mode');
    let prev = -1;
    for (const b of res.body.data) {
      assert(b.verificationStatus === 'verified', `unverified bank ${b.name} in results`);
      assert(b.distanceMeters >= prev, 'results not sorted nearest-first');
      assert(b.distanceMeters <= 25000, `${b.name} is beyond the radius`);
      prev = b.distanceMeters;
      assert(b.matchedBy === 'radius', 'matchedBy not set');
    }
    return `${res.body.data.length} banks within 25km, verified only`;
  });

  await check('GET  /api/banks  city fallback when no coordinates', async () => {
    const res = await auth(api('get', '/api/banks?city=Mumbai'), tokens.donor);
    assertStatus(res, 200, 'city search');
    assert(res.body.meta.searchMode === 'city', 'not in city mode');
    for (const b of res.body.data) assert(b.matchedBy === 'city', 'matchedBy wrong');
    return `${res.body.data.length} banks in Mumbai`;
  });

  await check('GET  /api/banks?bloodGroup= filters to banks holding stock', async () => {
    const res = await auth(api('get', '/api/banks?city=Pune&bloodGroup=O%2B&minUnits=1'), tokens.donor);
    assertStatus(res, 200, 'group filter');
    for (const b of res.body.data) {
      assert(b.unitsForRequestedGroup >= 1, `${b.name} has no O+ but was returned`);
    }
    return `${res.body.data.length} Pune banks with O+ in stock`;
  });

  console.log('\n' + '='.repeat(72));
  console.log('  COMPATIBILITY MATCHING  (Doc 2 section 5.1)');
  console.log('='.repeat(72));

  await check('Matrix is correct in both directions for all 8 groups', async () => {
    const c = require('../src/services/compatibility');
    const expected = {
      'O-': ['O-'],
      'O+': ['O-', 'O+'],
      'A-': ['O-', 'A-'],
      'A+': ['O-', 'O+', 'A-', 'A+'],
      'B-': ['O-', 'B-'],
      'B+': ['O-', 'O+', 'B-', 'B+'],
      'AB-': ['O-', 'A-', 'B-', 'AB-'],
      'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
    };
    for (const [group, donors] of Object.entries(expected)) {
      const got = c.compatibleDonorsFor(group).sort();
      assert(JSON.stringify(got) === JSON.stringify(donors.slice().sort()),
        `compatibleDonorsFor(${group}) = ${got}`);
    }
    assert(c.canDonateTo('O-').length === 8, 'O- is not a universal donor');
    assert(c.canDonateTo('AB+').join() === 'AB+', 'AB+ should only serve AB+');
    assert(c.compatibleDonorsFor('AB+').length === 8, 'AB+ is not a universal recipient');
    // Transpose consistency.
    for (const d of Object.keys(expected)) {
      for (const r of Object.keys(expected)) {
        assert(c.canDonateTo(d).includes(r) === c.compatibleDonorsFor(r).includes(d),
          `directions disagree for ${d} -> ${r}`);
      }
    }
    return 'all 64 pairs agree in both directions';
  });

  await check('GET  /api/requests/match/:bloodGroup  substitutes when exact is short', async () => {
    // Zero out AB+ so the exact match is unavailable, forcing substitution.
    await BloodBank.updateOne({ _id: ids.bank }, { $set: { 'inventory.AB+': 0, 'inventory.O+': 6 } });
    const res = await auth(
      api('get', `/api/requests/match/AB%2B?bankId=${ids.bank}&units=2`), tokens['blood-bank']
    );
    assertStatus(res, 200, 'match');
    const d = res.body.data;
    assert(d.exactAvailable === false, 'exact should be unavailable');
    const compat = require('../src/services/compatibility').compatibleDonorsFor('AB+');
    for (const o of d.options) {
      assert(compat.includes(o.bloodGroup), `${o.bloodGroup} is not AB+ compatible`);
    }
    assert(d.options.length > 0, 'no substitutes offered despite compatible stock');
    return `${d.options.length} compatible substitutes, best=${d.options[0].bloodGroup}`;
  });

  console.log('\n' + '='.repeat(72));
  console.log('  REQUEST LIFECYCLE  (plan decision D-1)');
  console.log('='.repeat(72));

  await check('POST /api/requests  critical fires the notification hook', async () => {
    const res = await auth(api('post', '/api/requests'), tokens.hospital).send({
      bloodGroup: 'O+', units: 2, urgency: 'critical',
      bloodBank: ids.bank, patientName: 'Verify Patient', hospitalName: 'Verify Hospital',
    });
    assertStatus(res, 201, 'create request');
    ids.request = res.body.data.request.id || res.body.data.request._id;
    assert(res.body.data.notified, 'critical hook did not run');
    assert(res.body.data.stepper.steps.length === 5, 'stepper does not have 5 steps');
    return `notified ${res.body.data.notified.donorsNotified} donors, ${res.body.data.notified.banksNotified} banks`;
  });

  await check('PATCH status  pending -> fulfilled is REJECTED (Doc 4 section 4.1)', async () => {
    const res = await auth(api('patch', `/api/requests/${ids.request}/status`), tokens['blood-bank'])
      .send({ status: 'fulfilled' });
    assertStatus(res, 409, 'illegal jump');
    assert(/Invalid status transition/i.test(res.body.message), 'wrong message');
    return res.body.message;
  });

  await check('PATCH status  legal chain review -> approved -> dispatched', async () => {
    for (const status of ['under_review', 'approved', 'dispatched']) {
      const res = await auth(
        api('patch', `/api/requests/${ids.request}/status`), tokens['blood-bank']
      ).send({ status });
      assertStatus(res, 200, `-> ${status}`);
      assert(res.body.data.request.status === status, 'status not applied');
    }
    return 'pending -> under_review -> approved -> dispatched';
  });

  await check('PATCH status  fulfilment consumes stock FEFO in one transaction', async () => {
    const before = await BloodBank.findById(ids.bank);
    const beforeUnits = before.inventory.get('O+');

    const res = await auth(api('patch', `/api/requests/${ids.request}/status`), tokens['blood-bank'])
      .send({ status: 'fulfilled' });
    assertStatus(res, 200, 'fulfil');

    const after = await BloodBank.findById(ids.bank);
    assert(after.inventory.get('O+') === beforeUnits - 2,
      `stock ${beforeUnits} -> ${after.inventory.get('O+')}, expected -2`);
    assert(res.body.data.consumed && res.body.data.consumed.length, 'nothing recorded as consumed');
    assert(res.body.data.request.fulfilledAt, 'fulfilledAt not set');

    // FEFO: the batch drawn from must be the soonest-expiring available one.
    const drawn = await DonationHistory.findById(res.body.data.consumed[0].donation);
    const others = await DonationHistory.find({
      bloodBank: ids.bank, bloodGroup: 'O+', status: 'available', expiryDate: { $gt: new Date() },
    });
    for (const o of others) {
      assert(o.expiryDate >= drawn.expiryDate, 'a sooner-expiring batch was left behind (not FEFO)');
    }
    return `-2 units, drawn from the soonest-expiring batch`;
  });

  await check('PATCH status  terminal request cannot move again', async () => {
    const res = await auth(api('patch', `/api/requests/${ids.request}/status`), tokens['blood-bank'])
      .send({ status: 'dispatched' });
    assertStatus(res, 409, 'terminal');
    return res.body.message;
  });

  await check('PATCH status  insufficient stock blocks fulfilment with 409', async () => {
    const create = await auth(api('post', '/api/requests'), tokens.hospital)
      .send({ bloodGroup: 'AB-', units: 40, urgency: 'high', bloodBank: ids.bank });
    const rid = create.body.data.request.id || create.body.data.request._id;
    for (const status of ['under_review', 'approved', 'dispatched']) {
      await auth(api('patch', `/api/requests/${rid}/status`), tokens['blood-bank']).send({ status });
    }
    const res = await auth(api('patch', `/api/requests/${rid}/status`), tokens['blood-bank'])
      .send({ status: 'fulfilled' });
    assertStatus(res, 409, 'insufficient stock');
    assert(/insufficient stock/i.test(res.body.message), 'wrong message');

    const after = await BloodRequest.findById(rid);
    assert(after.status === 'dispatched', 'status advanced despite the failure');
    return 'stock shortfall refused, status rolled back';
  });

  await check('PATCH status  a bank cannot drive another bank\'s request', async () => {
    const other = await BloodBank.findOne({ email: 'dadar@bank.test' });
    const login = await api('post', '/api/auth/login')
      .send({ email: other.email, password: 'Passw0rd!', role: 'blood-bank' });
    const create = await auth(api('post', '/api/requests'), tokens.hospital)
      .send({ bloodGroup: 'A+', units: 1, urgency: 'low', bloodBank: ids.bank });
    const rid = create.body.data.request.id || create.body.data.request._id;
    const res = await auth(api('patch', `/api/requests/${rid}/status`), login.body.data.token)
      .send({ status: 'under_review' });
    assertStatus(res, 403, 'foreign bank');
    return 'forbidden';
  });

  await check('PATCH status  only the requester may cancel', async () => {
    const create = await auth(api('post', '/api/requests'), tokens.hospital)
      .send({ bloodGroup: 'B+', units: 1, urgency: 'low', bloodBank: ids.bank });
    const rid = create.body.data.request.id || create.body.data.request._id;

    const wrong = await auth(api('patch', `/api/requests/${rid}/status`), tokens.donor)
      .send({ status: 'cancelled' });
    assert(wrong.status === 403, `other user got ${wrong.status}, expected 403`);

    const right = await auth(api('patch', `/api/requests/${rid}/status`), tokens.hospital)
      .send({ status: 'cancelled' });
    assertStatus(right, 200, 'requester cancel');
    return 'requester may cancel, others may not';
  });

  await check('GET  /api/requests/:id  stepper carries real timestamps', async () => {
    const res = await auth(api('get', `/api/requests/${ids.request}`), tokens.hospital);
    assertStatus(res, 200, 'get request');
    const s = res.body.data.stepper;
    assert(s.steps.every((x) => x.label), 'steps missing labels');
    assert(s.steps.filter((x) => x.at).length >= 4, 'history timestamps missing');
    assert(s.isTerminal === true, 'fulfilled request not terminal');
    return `${s.steps.filter((x) => x.at).length}/5 steps timestamped`;
  });

  await check('GET  /api/requests/:id  a stranger gets 403', async () => {
    const res = await auth(api('get', `/api/requests/${ids.request}`), tokens.donor);
    assertStatus(res, 403, 'stranger');
    return 'forbidden';
  });

  await check('GET  /api/requests?urgency=  filterable, paginated queue', async () => {
    const res = await auth(api('get', '/api/requests?urgency=critical&page=1&limit=5'),
      tokens['blood-bank']);
    assertStatus(res, 200, 'queue');
    assert(res.body.meta && res.body.meta.totalPages >= 1, 'no meta block');
    for (const r of res.body.data) assert(r.urgency === 'critical', 'filter not applied');
    for (const r of res.body.data) assert(Array.isArray(r.nextStatuses), 'no nextStatuses hint');
    return `${res.body.data.length} critical, meta.total=${res.body.meta.total}`;
  });

  console.log('\n' + '='.repeat(72));
  console.log('  ADMIN & AUDIT');
  console.log('='.repeat(72));

  await check('GET  /api/admin/metrics', async () => {
    const res = await auth(api('get', '/api/admin/metrics'), tokens.admin);
    assertStatus(res, 200, 'metrics');
    const d = res.body.data;
    assert(d.users && d.requests && d.inventory && d.donations, 'missing KPI sections');
    assert(Object.keys(d.inventory.byBloodGroup).length === 8, 'stock not reported for 8 groups');
    assert(Array.isArray(d.donations.weeklyTrend), 'no trend series for the chart');
    return `${d.users.donors} donors, ${d.requests.total} requests, ${d.inventory.totalUnits} units`;
  });

  await check('GET  /api/admin/banks/pending', async () => {
    const res = await auth(api('get', '/api/admin/banks/pending'), tokens.admin);
    assertStatus(res, 200, 'pending');
    assert(res.body.data.length >= 1, 'seed should include a pending bank');
    ids.pendingBank = res.body.data[0].id;
    return `${res.body.data.length} awaiting verification`;
  });

  await check('PATCH /api/admin/banks/:id/verify  approve makes it searchable', async () => {
    const beforeSearch = await auth(api('get', '/api/banks?city=Navi%20Mumbai'), tokens.donor);
    const beforeCount = beforeSearch.body.data.length;

    const res = await auth(api('patch', `/api/admin/banks/${ids.pendingBank}/verify`), tokens.admin)
      .send({ action: 'approve' });
    assertStatus(res, 200, 'verify');
    assert(res.body.data.bank.verificationStatus === 'verified', 'not verified');
    assert(res.body.data.bank.verifiedBy, 'verifiedBy not recorded');
    assert(res.body.data.bank.verifiedAt, 'verifiedAt not recorded');

    const afterSearch = await auth(api('get', '/api/banks?city=Navi%20Mumbai'), tokens.donor);
    assert(afterSearch.body.data.length === beforeCount + 1,
      'approved bank did not appear in search');
    return `verified, and search went ${beforeCount} -> ${afterSearch.body.data.length}`;
  });

  await check('PATCH /api/admin/banks/:id/verify  reject requires a reason', async () => {
    const res = await auth(api('patch', `/api/admin/banks/${ids.newBank}/verify`), tokens.admin)
      .send({ action: 'reject' });
    assertStatus(res, 422, 'reject without reason');
    return 'refused without a reason';
  });

  await check('GET  /api/admin/logs  paginated + filterable', async () => {
    const res = await auth(api('get', '/api/admin/logs?page=1&limit=10'), tokens.admin);
    assertStatus(res, 200, 'logs');
    assert(res.body.data.length > 0, 'no log entries');
    assert(res.body.meta.total > 0, 'no meta.total');

    const filtered = await auth(api('get', '/api/admin/logs?action=bank_verify'), tokens.admin);
    for (const l of filtered.body.data) assert(l.action === 'bank_verify', 'filter not applied');
    return `${res.body.meta.total} entries, filter works`;
  });

  await check('Every mutating action produced an audit entry (Doc 4 section 4.1)', async () => {
    const required = [
      'register', 'login', 'password_reset', 'profile_update', 'inventory_adjust',
      'donation_checkin', 'inventory_reconcile', 'request_create',
      'request_status_change', 'bank_verify',
    ];
    const present = await ActivityLog.distinct('action');
    const missing = required.filter((a) => !present.includes(a));
    assert(missing.length === 0, `no audit entries for: ${missing.join(', ')}`);
    return `${present.length} distinct actions logged, all ${required.length} required present`;
  });

  await check('Audit log is append-only (no mutating route exists)', async () => {
    const routes = [];
    const stack = app._router.stack;
    const walk = (layers, prefix = '') => {
      for (const l of layers) {
        if (l.route) {
          for (const m of Object.keys(l.route.methods)) {
            routes.push(`${m.toUpperCase()} ${prefix}${l.route.path}`);
          }
        } else if (l.handle && l.handle.stack) {
          const src = l.regexp && l.regexp.source;
          const seg = src ? src.replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/') : '';
          walk(l.handle.stack, prefix + (seg && seg !== '/' ? seg : ''));
        }
      }
    };
    walk(stack);
    const bad = routes.filter((r) => /logs/.test(r) && !/^GET/.test(r));
    assert(bad.length === 0, `mutating log routes found: ${bad.join(', ')}`);
    return `${routes.length} routes registered, none mutate logs`;
  });

  /* ---------------------------------------------------------------- done */

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log('\n' + '='.repeat(72));
  console.log(`  ${passed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}`);
  console.log('='.repeat(72) + '\n');

  if (failed) {
    for (const r of results.filter((x) => !x.passed)) {
      console.log(`  FAILED: ${r.name}\n          ${r.detail}`);
    }
    console.log('');
  }

  await require('../src/config/db').disconnect();
  await mongo.stop();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\n[verify] harness error:', err);
  try {
    await require('../src/config/db').disconnect();
    if (mongo) await mongo.stop();
  } catch (_e) { /* ignore */ }
  process.exit(1);
});
