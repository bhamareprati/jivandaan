'use strict';

const { api, withAuth, makeDonor, makeBank, makeHospital, makeAdmin, stock } = require('./helpers');
const { BloodBank, BloodRequest, DonationHistory, ActivityLog } = require('../src/models');

describe('Request lifecycle (plan decision D-1)', () => {
  let bank;
  let hospital;
  let donor;

  beforeEach(async () => {
    await global.resetDb();
    bank = await makeBank();
    hospital = await makeHospital();
    donor = await makeDonor({ bloodgroup: 'O-' });
    await stock(bank.id, 'O+', 10);
  });

  async function createRequest(overrides = {}) {
    const res = await withAuth(api().post('/api/requests'), hospital.token).send({
      bloodGroup: 'O+', units: 2, urgency: 'high', bloodBank: bank.id,
      patientName: 'Test Patient', ...overrides,
    });
    if (res.status !== 201) throw new Error(`create failed: ${JSON.stringify(res.body)}`);
    return res.body.data.request.id || res.body.data.request._id;
  }

  const advance = (id, status, token = bank.token, body = {}) =>
    withAuth(api().patch(`/api/requests/${id}/status`), token).send({ status, ...body });

  test('creates a request seeded with the opening stepper state', async () => {
    const res = await withAuth(api().post('/api/requests'), hospital.token).send({
      bloodGroup: 'O+', units: 2, urgency: 'medium', bloodBank: bank.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.request.status).toBe('pending');
    expect(res.body.data.stepper.steps).toHaveLength(5);
    expect(res.body.data.stepper.steps[0].label).toBe('Submitted');
    expect(res.body.data.request.statusHistory).toHaveLength(1);
  });

  test('a critical request fires the notification hook', async () => {
    const res = await withAuth(api().post('/api/requests'), hospital.token).send({
      bloodGroup: 'O+', units: 1, urgency: 'critical', bloodBank: bank.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.notified).toBeTruthy();
    expect(res.body.data.notified.channel).toBe('console');
  });

  test('a non-critical request does not fire the hook', async () => {
    const res = await withAuth(api().post('/api/requests'), hospital.token).send({
      bloodGroup: 'O+', units: 1, urgency: 'low', bloodBank: bank.id,
    });
    expect(res.body.data.notified).toBeNull();
  });

  test('rejects pending -> fulfilled directly (Doc 4 section 4.1)', async () => {
    const id = await createRequest();
    const res = await advance(id, 'fulfilled');

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Invalid status transition/);

    const after = await BloodRequest.findById(id);
    expect(after.status).toBe('pending');
  });

  test('rejects pending -> dispatched and pending -> approved', async () => {
    const id = await createRequest();
    expect((await advance(id, 'dispatched')).status).toBe(409);
    expect((await advance(id, 'approved')).status).toBe(409);
  });

  test('walks the full legal chain and records a timestamp per step', async () => {
    const id = await createRequest();

    for (const status of ['under_review', 'approved', 'dispatched', 'fulfilled']) {
      const res = await advance(id, status);
      expect(res.status).toBe(200);
      expect(res.body.data.request.status).toBe(status);
    }

    const final = await BloodRequest.findById(id);
    expect(final.statusHistory).toHaveLength(5);
    expect(final.fulfilledAt).toBeTruthy();
    for (const h of final.statusHistory) expect(h.at).toBeTruthy();
  });

  test('fulfilment consumes stock in the same operation as the status change', async () => {
    const id = await createRequest();
    const before = await BloodBank.findById(bank.id);

    for (const s of ['under_review', 'approved', 'dispatched']) await advance(id, s);
    const res = await advance(id, 'fulfilled');

    expect(res.status).toBe(200);
    const after = await BloodBank.findById(bank.id);
    expect(after.inventory.get('O+')).toBe(before.inventory.get('O+') - 2);
    expect(res.body.data.consumed).toHaveLength(1);
  });

  test('consumes first-expiring-first-out', async () => {
    await BloodBank.updateOne({ _id: bank.id }, { $set: { 'inventory.A+': 0 } });
    const later = await stock(bank.id, 'A+', 5, { daysToExpiry: 35 });
    const sooner = await stock(bank.id, 'A+', 5, { daysToExpiry: 4 });

    const id = await createRequest({ bloodGroup: 'A+', units: 3 });
    for (const s of ['under_review', 'approved', 'dispatched']) await advance(id, s);
    const res = await advance(id, 'fulfilled');

    expect(res.status).toBe(200);
    expect(String(res.body.data.consumed[0].donation)).toBe(String(sooner._id));

    const soonerAfter = await DonationHistory.findById(sooner._id);
    const laterAfter = await DonationHistory.findById(later._id);
    expect(soonerAfter.unitsRemaining).toBe(2);
    expect(laterAfter.unitsRemaining).toBe(5);
  });

  test('insufficient stock blocks fulfilment and leaves the status untouched', async () => {
    const id = await createRequest({ bloodGroup: 'O+', units: 50 });
    for (const s of ['under_review', 'approved', 'dispatched']) await advance(id, s);

    const res = await advance(id, 'fulfilled');

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Insufficient stock/i);

    const after = await BloodRequest.findById(id);
    expect(after.status).toBe('dispatched');
    expect(after.fulfilledAt).toBeFalsy();

    const stillThere = await BloodBank.findById(bank.id);
    expect(stillThere.inventory.get('O+')).toBe(10);
  });

  test('can fulfil from a compatible substitute group', async () => {
    await stock(bank.id, 'O-', 5);
    const id = await createRequest({ bloodGroup: 'A+', units: 2 });
    for (const s of ['under_review', 'approved', 'dispatched']) await advance(id, s);

    const res = await advance(id, 'fulfilled', bank.token, { fulfillFromGroup: 'O-' });

    expect(res.status).toBe(200);
    const after = await BloodBank.findById(bank.id);
    expect(after.inventory.get('O-')).toBe(3);
  });

  test('refuses an incompatible substitute group', async () => {
    await stock(bank.id, 'AB+', 5);
    const id = await createRequest({ bloodGroup: 'O-', units: 1 });
    for (const s of ['under_review', 'approved', 'dispatched']) await advance(id, s);

    const res = await advance(id, 'fulfilled', bank.token, { fulfillFromGroup: 'AB+' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/not compatible/i);
  });

  test('a terminal request cannot move again', async () => {
    const id = await createRequest();
    for (const s of ['under_review', 'approved', 'dispatched', 'fulfilled']) await advance(id, s);

    const res = await advance(id, 'dispatched');
    expect(res.status).toBe(409);
  });

  test('a bank cannot drive a request assigned to another bank', async () => {
    const other = await makeBank();
    const id = await createRequest();

    const res = await advance(id, 'under_review', other.token);
    expect(res.status).toBe(403);
  });

  test('only the requester may cancel, and only before approval', async () => {
    const id = await createRequest();

    expect((await advance(id, 'cancelled', donor.token)).status).toBe(403);
    expect((await advance(id, 'cancelled', hospital.token)).status).toBe(200);

    const id2 = await createRequest();
    await advance(id2, 'under_review');
    await advance(id2, 'approved');
    expect((await advance(id2, 'cancelled', hospital.token)).status).toBe(409);
  });

  test('a donor cannot approve a request', async () => {
    const id = await createRequest();
    const res = await advance(id, 'under_review', donor.token);
    expect([403]).toContain(res.status);
  });

  test('only the requester, assigned bank and admin may read a request', async () => {
    const id = await createRequest();
    const stranger = await makeDonor({ bloodgroup: 'A+' });
    const admin = await makeAdmin();

    expect((await withAuth(api().get(`/api/requests/${id}`), hospital.token)).status).toBe(200);
    expect((await withAuth(api().get(`/api/requests/${id}`), bank.token)).status).toBe(200);
    expect((await withAuth(api().get(`/api/requests/${id}`), admin.token)).status).toBe(200);
    expect((await withAuth(api().get(`/api/requests/${id}`), stranger.token)).status).toBe(403);
  });

  test('the queue is filterable and paginated', async () => {
    await createRequest({ urgency: 'critical' });
    await createRequest({ urgency: 'low' });

    const res = await withAuth(
      api().get('/api/requests?urgency=critical&page=1&limit=10'), bank.token
    );

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 10 });
    expect(res.body.data.every((r) => r.urgency === 'critical')).toBe(true);
    expect(res.body.data[0].nextStatuses).toContain('under_review');
  });

  test('requesters see only their own requests', async () => {
    await createRequest();
    const otherHospital = await makeHospital();

    const mine = await withAuth(api().get('/api/requests'), hospital.token);
    const theirs = await withAuth(api().get('/api/requests'), otherHospital.token);

    expect(mine.body.data.length).toBe(1);
    expect(theirs.body.data.length).toBe(0);
  });

  test('refuses a request aimed at an unverified bank', async () => {
    const pending = await makeBank({ verify: false });
    const res = await withAuth(api().post('/api/requests'), hospital.token)
      .send({ bloodGroup: 'O+', units: 1, urgency: 'low', bloodBank: pending.id });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/not verified/i);
  });

  test('match endpoint ranks substitutes against real stock', async () => {
    await stock(bank.id, 'O-', 4);
    const res = await withAuth(
      api().get(`/api/requests/match/AB%2B?bankId=${bank.id}&units=2`), bank.token
    );

    expect(res.status).toBe(200);
    expect(res.body.data.exactAvailable).toBe(false);
    expect(res.body.data.options.map((o) => o.bloodGroup)).toEqual(
      expect.arrayContaining(['O+', 'O-'])
    );
    // O+ is commoner than O-, so it should be offered first.
    expect(res.body.data.options[0].bloodGroup).toBe('O+');
  });

  test('every mutating action leaves exactly one audit entry', async () => {
    await ActivityLog.deleteMany({});
    const id = await createRequest();
    await advance(id, 'under_review');

    expect(await ActivityLog.countDocuments({ action: 'request_create' })).toBe(1);
    expect(await ActivityLog.countDocuments({ action: 'request_status_change' })).toBe(1);

    const entry = await ActivityLog.findOne({ action: 'request_status_change' });
    expect(entry.metadata.from).toBe('pending');
    expect(entry.metadata.to).toBe('under_review');
    expect(entry.user).toBeTruthy();
    expect(entry.userModel).toBe('blood-banks');
  });
});

describe('Admin (Doc 2 section 4.5)', () => {
  let admin;

  beforeEach(async () => {
    await global.resetDb();
    admin = await makeAdmin();
  });

  test('metrics returns every KPI section in one call', async () => {
    const bank = await makeBank();
    await stock(bank.id, 'O+', 5);
    await makeDonor();

    const res = await withAuth(api().get('/api/admin/metrics'), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('users');
    expect(res.body.data).toHaveProperty('requests');
    expect(res.body.data).toHaveProperty('inventory');
    expect(res.body.data).toHaveProperty('donations');
    expect(Object.keys(res.body.data.inventory.byBloodGroup)).toHaveLength(8);
    expect(res.body.data.inventory.totalUnits).toBe(5);
  });

  test('verification queue lists pending banks only', async () => {
    await makeBank({ verify: false, name: 'Pending One' });
    await makeBank({ verify: true, name: 'Already Verified' });

    const res = await withAuth(api().get('/api/admin/banks/pending'), admin.token);

    expect(res.status).toBe(200);
    expect(res.body.data.map((b) => b.name)).toEqual(['Pending One']);
    expect(res.body.data[0]).toHaveProperty('waitingDays');
  });

  test('approving a bank records who and when, and makes it searchable', async () => {
    const pending = await makeBank({ verify: false, city: 'Nagpur' });
    const donor = await makeDonor();

    const before = await withAuth(api().get('/api/banks?city=Nagpur'), donor.token);
    expect(before.body.data).toHaveLength(0);

    const res = await withAuth(
      api().patch(`/api/admin/banks/${pending.id}/verify`), admin.token
    ).send({ action: 'approve' });

    expect(res.status).toBe(200);
    expect(res.body.data.bank.verificationStatus).toBe('verified');
    expect(res.body.data.bank.verifiedBy).toBeTruthy();
    expect(res.body.data.bank.verifiedAt).toBeTruthy();

    const after = await withAuth(api().get('/api/banks?city=Nagpur'), donor.token);
    expect(after.body.data).toHaveLength(1);
  });

  test('rejection requires a reason', async () => {
    const pending = await makeBank({ verify: false });

    const noReason = await withAuth(
      api().patch(`/api/admin/banks/${pending.id}/verify`), admin.token
    ).send({ action: 'reject' });
    expect(noReason.status).toBe(422);

    const withReason = await withAuth(
      api().patch(`/api/admin/banks/${pending.id}/verify`), admin.token
    ).send({ action: 'reject', reason: 'Licence could not be validated' });
    expect(withReason.status).toBe(200);
    expect(withReason.body.data.bank.rejectionReason).toBe('Licence could not be validated');
  });

  test('audit log paginates and filters by action', async () => {
    await makeDonor();
    await makeDonor();

    const all = await withAuth(api().get('/api/admin/logs?page=1&limit=5'), admin.token);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBeGreaterThan(0);

    const filtered = await withAuth(api().get('/api/admin/logs?action=register'), admin.token);
    expect(filtered.body.data.every((l) => l.action === 'register')).toBe(true);
  });

  test('there is no route that mutates an audit log entry', async () => {
    const admin2 = await makeAdmin();
    const log = await ActivityLog.findOne();

    for (const method of ['patch', 'put', 'delete']) {
      const res = await withAuth(api()[method](`/api/admin/logs/${log._id}`), admin2.token);
      expect(res.status).toBe(404);
    }
  });
});
