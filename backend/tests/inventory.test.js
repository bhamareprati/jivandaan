'use strict';

const { api, withAuth, makeDonor, makeBank, makeAdmin, stock } = require('./helpers');
const { BloodBank, DonationHistory, Donor } = require('../src/models');
const env = require('../src/config/env');
const { addDays } = require('../src/utils/dates');

describe('Inventory: ledger and cached count stay in step (plan decision D-6)', () => {
  let bank;
  let donor;

  beforeEach(async () => {
    await global.resetDb();
    bank = await makeBank();
    donor = await makeDonor({ bloodgroup: 'O-' });
  });

  test('a new bank starts with all eight groups at zero', async () => {
    const res = await withAuth(api().get(`/api/banks/${bank.id}/inventory`), bank.token);
    expect(res.status).toBe(200);
    expect(res.body.data.groups).toHaveLength(8);
    expect(res.body.data.totalUnits).toBe(0);
    expect(res.body.data.groups.every((g) => g.isEmpty)).toBe(true);
  });

  test('check-in writes a ledger row AND increments the cached count', async () => {
    const pass = await withAuth(api().get('/api/donors/me/pass'), donor.token);
    const passToken = pass.body.data.pass.qrPayload;

    const res = await withAuth(api().post(`/api/banks/${bank.id}/checkin`), bank.token)
      .send({ passToken, units: 3 });

    expect(res.status).toBe(201);

    const rows = await DonationHistory.find({ bloodBank: bank.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(3);
    expect(rows[0].unitsRemaining).toBe(3);
    expect(rows[0].status).toBe('available');

    const fresh = await BloodBank.findById(bank.id);
    expect(fresh.inventory.get('O-')).toBe(3);
  });

  test('expiryDate is auto-set to donationDate + 42 days', async () => {
    const pass = await withAuth(api().get('/api/donors/me/pass'), donor.token);
    const res = await withAuth(api().post(`/api/banks/${bank.id}/checkin`), bank.token)
      .send({ passToken: pass.body.data.pass.qrPayload, units: 1 });

    const d = res.body.data.donation;
    const gap = Math.round((new Date(d.expiryDate) - new Date(d.donationDate)) / 86400000);
    expect(gap).toBe(env.UNIT_SHELF_LIFE_DAYS);
    expect(gap).toBe(42);
  });

  test('check-in resets the donor clock, and a second one is refused', async () => {
    const pass = await withAuth(api().get('/api/donors/me/pass'), donor.token);
    const passToken = pass.body.data.pass.qrPayload;

    const first = await withAuth(api().post(`/api/banks/${bank.id}/checkin`), bank.token)
      .send({ passToken, units: 1 });
    expect(first.status).toBe(201);

    const updated = await Donor.findById(donor.user.id || donor.user._id);
    expect(updated.lastDonationDate).toBeTruthy();

    const second = await withAuth(api().post(`/api/banks/${bank.id}/checkin`), bank.token)
      .send({ passToken, units: 1 });

    expect(second.status).toBe(422);
    expect(second.body.message).toMatch(/not yet eligible/i);
    expect(second.body.errors[0].nextEligibleDate).toBeTruthy();

    // And nothing was written.
    expect(await DonationHistory.countDocuments({ bloodBank: bank.id })).toBe(1);
  });

  test('a forged pass token is rejected', async () => {
    const res = await withAuth(api().post(`/api/banks/${bank.id}/checkin`), bank.token)
      .send({ passToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.nope' });
    expect(res.status).toBe(422);
  });

  test('an unverified bank cannot take a check-in', async () => {
    const pending = await makeBank({ verify: false });
    const d2 = await makeDonor({ bloodgroup: 'A+' });
    const pass = await withAuth(api().get('/api/donors/me/pass'), d2.token);

    const res = await withAuth(api().post(`/api/banks/${pending.id}/checkin`), pending.token)
      .send({ passToken: pass.body.data.pass.qrPayload, units: 1 });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/verification/i);
  });

  test('one bank cannot check a donor in against another bank', async () => {
    const other = await makeBank();
    const pass = await withAuth(api().get('/api/donors/me/pass'), donor.token);

    const res = await withAuth(api().post(`/api/banks/${bank.id}/checkin`), other.token)
      .send({ passToken: pass.body.data.pass.qrPayload, units: 1 });

    expect(res.status).toBe(403);
  });

  test('expiry radar flags units inside the window and excludes the rest', async () => {
    await stock(bank.id, 'A+', 2, { daysToExpiry: 3 });   // inside
    await stock(bank.id, 'B+', 4, { daysToExpiry: 30 });  // healthy
    await stock(bank.id, 'O+', 1, { daysToExpiry: 6 });   // inside

    const res = await withAuth(api().get(`/api/banks/${bank.id}/expiry-radar`), bank.token);

    expect(res.status).toBe(200);
    const groups = res.body.data.byGroup.map((g) => g.bloodGroup).sort();
    expect(groups).toEqual(['A+', 'O+']);
    expect(res.body.data.totalUnitsAtRisk).toBe(3);
    for (const b of res.body.data.batches) {
      expect(b.daysToExpiry).toBeLessThanOrEqual(res.body.data.windowDays);
    }
  });

  test('the radar sweeps already-expired units out of the count on read', async () => {
    await stock(bank.id, 'A+', 5, { daysToExpiry: -2 });

    let fresh = await BloodBank.findById(bank.id);
    expect(fresh.inventory.get('A+')).toBe(5);

    await withAuth(api().get(`/api/banks/${bank.id}/expiry-radar`), bank.token);

    fresh = await BloodBank.findById(bank.id);
    expect(fresh.inventory.get('A+')).toBe(0);

    const row = await DonationHistory.findOne({ bloodBank: bank.id, bloodGroup: 'A+' });
    expect(row.status).toBe('expired');
    expect(row.unitsRemaining).toBe(0);
  });

  test('low stock is flagged against the bank threshold', async () => {
    await BloodBank.updateOne({ _id: bank.id }, { $set: { lowStockThreshold: 5 } });
    await stock(bank.id, 'A+', 3);
    await stock(bank.id, 'B+', 9);

    const res = await withAuth(api().get(`/api/banks/${bank.id}/inventory`), bank.token);
    const byGroup = Object.fromEntries(res.body.data.groups.map((g) => [g.bloodGroup, g]));

    expect(byGroup['A+'].isLow).toBe(true);
    expect(byGroup['B+'].isLow).toBe(false);
    expect(byGroup['O-'].isEmpty).toBe(true);
  });

  test('reconcile repairs drift between the cache and the ledger', async () => {
    await stock(bank.id, 'A+', 4);
    await BloodBank.updateOne({ _id: bank.id }, { $set: { 'inventory.A+': 99 } });

    const res = await withAuth(api().post(`/api/banks/${bank.id}/reconcile`), bank.token);

    expect(res.status).toBe(200);
    expect(res.body.data.corrected).toBeGreaterThanOrEqual(1);
    expect(res.body.data.inventory['A+']).toBe(4);
  });

  test('manual adjustment is applied and audited', async () => {
    const res = await withAuth(api().patch(`/api/banks/${bank.id}/inventory`), bank.token)
      .send({ inventory: { 'AB+': 7 }, reason: 'stock take' });

    expect(res.status).toBe(200);
    expect(res.body.data.inventory['AB+']).toBe(7);
    expect(res.body.data.applied['AB+']).toEqual({ from: 0, to: 7, delta: 7 });

    const { ActivityLog } = require('../src/models');
    expect(await ActivityLog.countDocuments({ action: 'inventory_adjust' })).toBe(1);
  });

  test('a donor cannot write to a bank inventory', async () => {
    const res = await withAuth(api().patch(`/api/banks/${bank.id}/inventory`), donor.token)
      .send({ inventory: { 'AB+': 99 } });
    expect(res.status).toBe(403);
  });
});

describe('Geospatial search (plan decision D-5)', () => {
  beforeEach(async () => {
    await global.resetDb();
  });

  test('radius search returns only verified banks, nearest first', async () => {
    const near = await makeBank({ name: 'Near', coordinates: [73.8567, 18.5204] });
    await makeBank({ name: 'Far', coordinates: [72.8777, 19.0760] });
    await makeBank({ name: 'Unverified Near', coordinates: [73.8570, 18.5210], verify: false });

    const donor = await makeDonor();
    const res = await withAuth(
      api().get('/api/banks?lat=18.5204&lng=73.8567&radius=25000'), donor.token
    );

    expect(res.status).toBe(200);
    expect(res.body.meta.searchMode).toBe('radius');

    const names = res.body.data.map((b) => b.name);
    expect(names).toContain('Near');
    expect(names).not.toContain('Far');
    expect(names).not.toContain('Unverified Near');

    expect(res.body.data[0].id).toBe(near.id);
    expect(res.body.data[0].distanceMeters).toBeLessThan(1000);
    expect(res.body.data[0].matchedBy).toBe('radius');
  });

  test('falls back to city matching when no coordinates are given', async () => {
    await makeBank({ name: 'Pune Bank', city: 'Pune' });
    await makeBank({ name: 'Mumbai Bank', city: 'Mumbai' });
    const donor = await makeDonor();

    const res = await withAuth(api().get('/api/banks?city=Mumbai'), donor.token);

    expect(res.body.meta.searchMode).toBe('city');
    expect(res.body.data.map((b) => b.name)).toEqual(['Mumbai Bank']);
    expect(res.body.data[0].matchedBy).toBe('city');
  });

  test('filters to banks actually holding the requested group', async () => {
    const withStock = await makeBank({ name: 'Has O+', city: 'Pune' });
    await makeBank({ name: 'Empty', city: 'Pune' });
    await stock(withStock.id, 'O+', 5);

    const donor = await makeDonor();
    const res = await withAuth(
      api().get('/api/banks?city=Pune&bloodGroup=O%2B&minUnits=1'), donor.token
    );

    expect(res.body.data.map((b) => b.name)).toEqual(['Has O+']);
    expect(res.body.data[0].unitsForRequestedGroup).toBe(5);
  });

  test('lat without lng is a validation error, not a silent full scan', async () => {
    const donor = await makeDonor();
    const res = await withAuth(api().get('/api/banks?lat=18.52'), donor.token);
    expect(res.status).toBe(422);
  });
});
