'use strict';

const request = require('supertest');

let app;

function getApp() {
  if (!app) app = require('../src/app')({ mongoUri: global.__MONGO_URI__ });
  return app;
}

const api = () => request(getApp());

function withAuth(req, token) {
  return req.set('Authorization', `Bearer ${token}`);
}

/* --------------------------------------------------------------- factories */

let counter = 0;
const uniq = (p) => `${p}${Date.now()}${(counter += 1)}`;

async function makeDonor(overrides = {}) {
  const body = {
    role: 'donor',
    name: 'Test Donor',
    email: `${uniq('donor')}@test.in`,
    password: 'Passw0rd!',
    contact: '9876543210',
    dob: '1995-04-12',
    gender: 'female',
    bloodgroup: 'O-',
    city: 'Pune',
    ...overrides,
  };
  const res = await api().post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`makeDonor failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.data.token, user: res.body.data.user, password: body.password, email: body.email };
}

async function makeBank(overrides = {}) {
  const { verify = true, ...rest } = overrides;
  const body = {
    role: 'blood-bank',
    name: 'Test Bank',
    email: `${uniq('bank')}@test.in`,
    password: 'Passw0rd!',
    contact: '02011112222',
    address: '1 Test Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    coordinates: [73.8567, 18.5204],
    ...rest,
  };
  const res = await api().post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`makeBank failed: ${JSON.stringify(res.body)}`);

  const id = res.body.data.user.id || res.body.data.user._id;

  if (verify) {
    const { BloodBank } = require('../src/models');
    await BloodBank.updateOne({ _id: id }, { $set: { verificationStatus: 'verified' } });
  }

  return { token: res.body.data.token, id, user: res.body.data.user, email: body.email };
}

async function makeHospital(overrides = {}) {
  const body = {
    role: 'hospital',
    name: 'Test Hospital',
    email: `${uniq('hosp')}@test.in`,
    password: 'Passw0rd!',
    contact: '02033334444',
    address: '2 Test Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411002',
    ...overrides,
  };
  const res = await api().post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`makeHospital failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.data.token, id: res.body.data.user.id || res.body.data.user._id };
}

async function makeAdmin() {
  const { Admin } = require('../src/models');
  const email = `${uniq('admin')}@test.in`;
  await Admin.create({ name: 'Test Admin', email, password: 'Passw0rd!', isSuperAdmin: true });
  const res = await api().post('/api/auth/login').send({ email, password: 'Passw0rd!', role: 'admin' });
  if (res.status !== 200) throw new Error(`makeAdmin login failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.data.token, id: res.body.data.user.id || res.body.data.user._id };
}

/** Put units on the shelf without going through the 56-day check-in guard. */
async function stock(bankId, bloodGroup, units, { daysToExpiry = 30 } = {}) {
  const { DonationHistory, Donor, BloodBank } = require('../src/models');
  const env = require('../src/config/env');
  const { addDays } = require('../src/utils/dates');

  const donor = await Donor.create({
    name: 'Stock Donor',
    email: `${uniq('stock')}@test.in`,
    password: 'Passw0rd!',
    contact: '9000000000',
    dob: new Date('1990-01-01'),
    gender: 'other',
    bloodgroup: bloodGroup,
  });

  const donationDate = addDays(new Date(), daysToExpiry - env.UNIT_SHELF_LIFE_DAYS);

  const row = await DonationHistory.create({
    donor: donor._id,
    bloodBank: bankId,
    bloodGroup,
    units,
    unitsRemaining: units,
    donationDate,
    expiryDate: addDays(donationDate, env.UNIT_SHELF_LIFE_DAYS),
  });

  await BloodBank.updateOne({ _id: bankId }, { $inc: { [`inventory.${bloodGroup}`]: units } });
  return row;
}

module.exports = { api, withAuth, getApp, makeDonor, makeBank, makeHospital, makeAdmin, stock };
