'use strict';

/**
 * Seed script (Doc 2 section 5 / Phase B5).
 *
 * Deterministic and idempotent. The frontend is built against this data, so
 * every screen must have something real to render: eligible AND mid-window AND
 * never-donated donors, banks at every verification state, groups at zero and
 * below threshold, a unit inside the expiry window and one already expired,
 * and requests at every urgency and every non-terminal status.
 *
 *   npm run seed          add anything missing
 *   npm run seed:reset    wipe the domain collections first
 */

const mongoose = require('mongoose');
const env = require('../src/config/env');
const db = require('../src/config/db');
const {
  Donor, BloodBank, Hospital, Admin, BloodRequest, DonationHistory, ActivityLog,
} = require('../src/models');
const {
  BLOOD_GROUPS, VERIFICATION, REQUEST_STATUS, DONATION_STATUS, COLLECTIONS,
} = require('../src/config/constants');
const { addDays } = require('../src/utils/dates');
const inventoryService = require('../src/services/inventory');

const RESET = process.argv.includes('--reset');
const PASSWORD = process.env.SEED_PASSWORD || 'Passw0rd!';
const now = new Date();

const log = (...a) => console.log('[seed]', ...a);

/* ------------------------------------------------------------------ data */

const BANKS = [
  {
    name: 'Sahyadri Blood Centre', email: 'sahyadri@bank.test', contact: '02026001100',
    address: '14 Karve Road, Kothrud', city: 'Pune', state: 'Maharashtra', pincode: '411038',
    coordinates: [73.8077, 18.5074], licenseNumber: 'MH-PUN-0142',
    verificationStatus: VERIFICATION.VERIFIED, lowStockThreshold: 10,
  },
  {
    name: 'Dadar Central Blood Bank', email: 'dadar@bank.test', contact: '02224301200',
    address: '3 Senapati Bapat Marg, Dadar West', city: 'Mumbai', state: 'Maharashtra', pincode: '400028',
    coordinates: [72.8410, 19.0176], licenseNumber: 'MH-MUM-0771',
    verificationStatus: VERIFICATION.VERIFIED, lowStockThreshold: 15,
  },
  {
    name: 'Indiranagar Life Bank', email: 'indiranagar@bank.test', contact: '08041500900',
    address: '100ft Road, Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560038',
    coordinates: [77.6408, 12.9784], licenseNumber: 'KA-BLR-0310',
    verificationStatus: VERIFICATION.VERIFIED, lowStockThreshold: 12,
  },
  {
    name: 'Navi Mumbai Blood Services', email: 'navimumbai@bank.test', contact: '02227800400',
    address: 'Sector 15, Vashi', city: 'Navi Mumbai', state: 'Maharashtra', pincode: '400703',
    coordinates: [73.0169, 19.0771], licenseNumber: 'MH-NVM-0088',
    verificationStatus: VERIFICATION.PENDING, lowStockThreshold: 10,
  },
  {
    name: 'Unverified Plasma Depot', email: 'depot@bank.test', contact: '02011112222',
    address: '9 Industrial Estate', city: 'Pune', state: 'Maharashtra', pincode: '411019',
    verificationStatus: VERIFICATION.REJECTED, rejectionReason: 'Licence could not be validated',
    lowStockThreshold: 10,
  },
];

const HOSPITALS = [
  {
    name: 'Ruby Hall Clinic', email: 'rubyhall@hospital.test', contact: '02066455000',
    address: '40 Sassoon Road', city: 'Pune', state: 'Maharashtra', pincode: '411001',
    coordinates: [73.8778, 18.5314], registrationNumber: 'HOSP-MH-2201',
    verificationStatus: VERIFICATION.VERIFIED,
  },
  {
    name: 'Lilavati Hospital', email: 'lilavati@hospital.test', contact: '02226751000',
    address: 'A-791 Bandra Reclamation', city: 'Mumbai', state: 'Maharashtra', pincode: '400050',
    coordinates: [72.8258, 19.0509], registrationNumber: 'HOSP-MH-0455',
    verificationStatus: VERIFICATION.VERIFIED,
  },
  {
    name: 'Manipal Hospital Old Airport Road', email: 'manipal@hospital.test', contact: '08025023344',
    address: '98 Old Airport Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560017',
    coordinates: [77.6484, 12.9591], registrationNumber: 'HOSP-KA-1120',
    verificationStatus: VERIFICATION.PENDING,
  },
];

/**
 * Twelve donors spanning all eight groups, with a deliberate spread of
 * lastDonationDate so the eligibility ring has all three states to render.
 *   daysAgo: null = never donated, >=56 = eligible, <56 = mid-window
 */
const DONORS = [
  { name: 'Asha Kulkarni',   bloodgroup: 'O-',  daysAgo: null, gender: 'female', city: 'Pune' },
  { name: 'Rohan Deshpande', bloodgroup: 'O+',  daysAgo: 70,   gender: 'male',   city: 'Pune' },
  { name: 'Meera Iyer',      bloodgroup: 'A+',  daysAgo: 12,   gender: 'female', city: 'Mumbai' },
  { name: 'Vikram Shetty',   bloodgroup: 'B+',  daysAgo: 58,   gender: 'male',   city: 'Mumbai' },
  { name: 'Fatima Sheikh',   bloodgroup: 'AB+', daysAgo: 30,   gender: 'female', city: 'Pune' },
  { name: 'Arjun Nair',      bloodgroup: 'A-',  daysAgo: null, gender: 'male',   city: 'Bengaluru' },
  { name: 'Sneha Patil',     bloodgroup: 'B-',  daysAgo: 95,   gender: 'female', city: 'Pune' },
  { name: 'Kabir Malhotra',  bloodgroup: 'AB-', daysAgo: 44,   gender: 'male',   city: 'Mumbai' },
  { name: 'Divya Rao',       bloodgroup: 'O+',  daysAgo: 3,    gender: 'female', city: 'Bengaluru' },
  { name: 'Imran Qureshi',   bloodgroup: 'O-',  daysAgo: 120,  gender: 'male',   city: 'Mumbai' },
  { name: 'Nandini Joshi',   bloodgroup: 'A+',  daysAgo: 55,   gender: 'female', city: 'Pune' },
  { name: 'Tarun Verma',     bloodgroup: 'B+',  daysAgo: null, gender: 'male',   city: 'Bengaluru' },
];

const CITY_COORDS = {
  Pune: [73.8567, 18.5204],
  Mumbai: [72.8777, 19.0760],
  Bengaluru: [77.5946, 12.9716],
};

/**
 * Ledger rows. `expiresInDays` drives the radar demo:
 *   negative -> already expired, 0..7 -> inside the radar window, else healthy.
 * donationDate is derived backwards from it so the 42-day rule stays true.
 */
const DONATION_PLAN = [
  { bank: 0, donor: 1,  group: 'O+',  units: 14, expiresInDays: 30 },
  { bank: 0, donor: 6,  group: 'B-',  units: 2, expiresInDays: 5 },   // radar
  { bank: 0, donor: 10, group: 'A+',  units: 12, expiresInDays: 18 },
  { bank: 0, donor: 9,  group: 'O-',  units: 2, expiresInDays: 2 },   // radar, critical
  { bank: 0, donor: 4,  group: 'AB+', units: 1, expiresInDays: -3 },  // already expired
  { bank: 1, donor: 2,  group: 'A+',  units: 6, expiresInDays: 25 },
  { bank: 1, donor: 3,  group: 'B+',  units: 5, expiresInDays: 33 },
  { bank: 1, donor: 7,  group: 'AB-', units: 1, expiresInDays: 6 },   // radar
  { bank: 1, donor: 9,  group: 'O-',  units: 3, expiresInDays: 21 },
  { bank: 2, donor: 8,  group: 'O+',  units: 7, expiresInDays: 28 },
  { bank: 2, donor: 5,  group: 'A-',  units: 2, expiresInDays: 14 },
  { bank: 2, donor: 11, group: 'B+',  units: 4, expiresInDays: 37 },
];

/** Every urgency, and every non-terminal status, so the Kanban and the
 *  stepper both have something to show at each stage. */
const REQUEST_PLAN = [
  { hospital: 0, bank: 0, group: 'O-',  units: 2, urgency: 'critical', status: REQUEST_STATUS.PENDING,      patient: 'Trauma admission', ageHours: 1 },
  { hospital: 0, bank: 0, group: 'A+',  units: 3, urgency: 'high',     status: REQUEST_STATUS.UNDER_REVIEW, patient: 'S. Kamble',        ageHours: 5 },
  { hospital: 1, bank: 1, group: 'B+',  units: 2, urgency: 'medium',   status: REQUEST_STATUS.APPROVED,     patient: 'R. Dsouza',        ageHours: 26 },
  { hospital: 1, bank: 1, group: 'AB+', units: 1, urgency: 'low',      status: REQUEST_STATUS.PENDING,      patient: 'Scheduled surgery', ageHours: 50 },
  { hospital: 2, bank: 2, group: 'O+',  units: 4, urgency: 'critical', status: REQUEST_STATUS.DISPATCHED,   patient: 'ICU transfer',     ageHours: 3 },
  { hospital: 2, bank: 2, group: 'A-',  units: 1, urgency: 'high',     status: REQUEST_STATUS.UNDER_REVIEW, patient: 'M. Fernandes',     ageHours: 9 },
  { hospital: 0, bank: 1, group: 'B-',  units: 2, urgency: 'medium',   status: REQUEST_STATUS.PENDING,      patient: 'Day-care patient', ageHours: 14 },
  { hospital: 1, bank: 0, group: 'AB-', units: 1, urgency: 'critical', status: REQUEST_STATUS.APPROVED,     patient: 'Neonatal case',    ageHours: 2 },
  { donor: 0,    bank: 0, group: 'O-',  units: 1, urgency: 'high',     status: REQUEST_STATUS.PENDING,      patient: 'Family member',    ageHours: 7 },
  { donor: 4,    bank: 2, group: 'AB+', units: 2, urgency: 'low',      status: REQUEST_STATUS.PENDING,      patient: 'Elective procedure', ageHours: 72 },
];

/* ------------------------------------------------------------------ main */

async function wipe() {
  log('resetting domain collections');
  await Promise.all([
    Donor.deleteMany({}),
    BloodBank.deleteMany({}),
    Hospital.deleteMany({}),
    BloodRequest.deleteMany({}),
    DonationHistory.deleteMany({}),
    ActivityLog.deleteMany({}),
  ]);
  // Admins survive a reset unless explicitly cleared: losing the only admin
  // account mid-development is worse than a stale one.
}

async function seedAdmin() {
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD || PASSWORD;

  let admin = await Admin.findOne({ email });
  if (!admin) {
    admin = await Admin.create({
      name: 'Platform Admin', email, password, isSuperAdmin: true, contact: '08000000000',
    });
    log(`admin created: ${email}`);
  } else {
    log(`admin exists: ${email}`);
  }
  return admin;
}

async function seedBanks() {
  const out = [];
  for (const spec of BANKS) {
    let bank = await BloodBank.findOne({ email: spec.email });
    if (!bank) {
      const { coordinates, ...rest } = spec;
      bank = await BloodBank.create({
        ...rest,
        password: PASSWORD,
        location: coordinates ? { type: 'Point', coordinates } : undefined,
      });
    }
    out.push(bank);
  }
  log(`banks: ${out.length}`);
  return out;
}

async function seedHospitals() {
  const out = [];
  for (const spec of HOSPITALS) {
    let h = await Hospital.findOne({ email: spec.email });
    if (!h) {
      const { coordinates, ...rest } = spec;
      h = await Hospital.create({
        ...rest,
        password: PASSWORD,
        location: coordinates ? { type: 'Point', coordinates } : undefined,
      });
    }
    out.push(h);
  }
  log(`hospitals: ${out.length}`);
  return out;
}

async function seedDonors() {
  const out = [];
  for (let i = 0; i < DONORS.length; i += 1) {
    const spec = DONORS[i];
    const email = `${spec.name.split(' ')[0].toLowerCase()}${i}@donor.test`;

    let donor = await Donor.findOne({ email });
    if (!donor) {
      donor = await Donor.create({
        name: spec.name,
        email,
        password: PASSWORD,
        contact: `9${String(800000000 + i * 111111).slice(0, 9)}`,
        dob: new Date(Date.UTC(1985 + (i % 15), i % 12, ((i * 3) % 27) + 1)),
        gender: spec.gender,
        bloodgroup: spec.bloodgroup,
        city: spec.city,
        state: spec.city === 'Bengaluru' ? 'Karnataka' : 'Maharashtra',
        pincode: spec.city === 'Pune' ? '411001' : spec.city === 'Mumbai' ? '400001' : '560001',
        location: CITY_COORDS[spec.city]
          ? { type: 'Point', coordinates: CITY_COORDS[spec.city] }
          : undefined,
        lastDonationDate: spec.daysAgo === null ? null : addDays(now, -spec.daysAgo),
      });
    }
    out.push(donor);
  }

  const eligible = out.filter((d) => d.isEligible).length;
  log(`donors: ${out.length} (${eligible} eligible, ${out.length - eligible} in window)`);
  return out;
}

/**
 * Ledger rows are written directly rather than through inventoryService.checkIn
 * so we can back-date them past the 56-day guard, then the cached inventory Map
 * is rebuilt from the ledger by reconcile() -- which also exercises the
 * reconciliation path on every seed.
 */
async function seedDonations(banks, donors) {
  const existing = await DonationHistory.countDocuments();
  if (existing > 0) {
    log(`donations: ${existing} already present, skipping`);
    return;
  }

  const rows = DONATION_PLAN.map((p) => {
    const donationDate = addDays(now, p.expiresInDays - env.UNIT_SHELF_LIFE_DAYS);
    const expiryDate = addDays(donationDate, env.UNIT_SHELF_LIFE_DAYS);
    const expired = p.expiresInDays < 0;
    return {
      donor: donors[p.donor]._id,
      bloodBank: banks[p.bank]._id,
      bloodGroup: p.group,
      units: p.units,
      unitsRemaining: expired ? 0 : p.units,
      donationDate,
      expiryDate,
      status: expired ? DONATION_STATUS.EXPIRED : DONATION_STATUS.AVAILABLE,
    };
  });

  await DonationHistory.insertMany(rows);
  log(`donations: ${rows.length} ledger rows`);

  for (const bank of banks) {
    await inventoryService.reconcile(bank._id, {
      actor: { user: bank._id, userModel: COLLECTIONS.BANKS },
    });
  }

  // Force at least one group to zero and one below threshold at the first bank,
  // so the empty and low states are both visible in the matrix.
  const first = await BloodBank.findById(banks[0]._id);
  first.inventory.set('AB-', 0);
  first.inventory.set('B+', 2);
  await first.save();
  log('inventory reconciled from ledger (one group zeroed, one set low)');
}

async function seedRequests(banks, hospitals, donors) {
  const existing = await BloodRequest.countDocuments();
  if (existing > 0) {
    log(`requests: ${existing} already present, skipping`);
    return;
  }

  const docs = REQUEST_PLAN.map((p) => {
    const isHospital = p.hospital !== undefined;
    const requester = isHospital ? hospitals[p.hospital] : donors[p.donor];
    const createdAt = addDays(now, -(p.ageHours / 24));

    // Walk the history up to the target status so the stepper shows real
    // timestamps at every completed step, not just the current one.
    const path = [REQUEST_STATUS.PENDING, REQUEST_STATUS.UNDER_REVIEW,
      REQUEST_STATUS.APPROVED, REQUEST_STATUS.DISPATCHED, REQUEST_STATUS.FULFILLED];
    const target = path.indexOf(p.status);
    const history = path.slice(0, target + 1).map((status, i) => ({
      status,
      at: new Date(createdAt.getTime() + i * 45 * 60 * 1000),
      changedBy: i === 0 ? requester._id : banks[p.bank]._id,
      changedByModel: i === 0
        ? (isHospital ? COLLECTIONS.HOSPITALS : COLLECTIONS.DONORS)
        : COLLECTIONS.BANKS,
    }));

    return {
      requester: requester._id,
      requesterModel: isHospital ? COLLECTIONS.HOSPITALS : COLLECTIONS.DONORS,
      bloodBank: banks[p.bank]._id,
      bloodGroup: p.group,
      units: p.units,
      urgency: p.urgency,
      patientName: p.patient,
      hospitalName: isHospital ? requester.name : null,
      status: p.status,
      statusHistory: history,
      createdAt,
      requiredBy: addDays(now, 2),
    };
  });

  await BloodRequest.insertMany(docs);
  log(`requests: ${docs.length} across all urgency levels and statuses`);
}

/**
 * Run the seed against the current connection.
 *
 * Exported so callers (scripts/verify.js, tests) can seed in-process. Spawning
 * this file as a child from a parent that already holds a Mongoose connection
 * deadlocks, because execFileSync blocks the parent's event loop while the
 * child competes for the same server.
 *
 * @param {{ reset?: boolean, quiet?: boolean }} options
 */
async function seed({ reset = false, quiet = false } = {}) {
  const say = quiet ? () => {} : log;

  if (!db.isConnected()) {
    if (!env.MONGO_URI) {
      throw new Error('MONGO_URI is not set. Copy .env.example to .env first.');
    }
    await db.connect();
  }
  say(`connected to ${mongoose.connection.name}`);

  if (reset) await wipe();

  const admin = await seedAdmin();
  const banks = await seedBanks();
  const hospitals = await seedHospitals();
  const donors = await seedDonors();
  await seedDonations(banks, donors);
  await seedRequests(banks, hospitals, donors);

  const matrix = await inventoryService.getMatrix(banks[0]._id);

  if (quiet) return { admin, banks, hospitals, donors, matrix };

  console.log('\n' + '-'.repeat(66));
  console.log('  Seed complete. Sign in with password:', PASSWORD);
  console.log('-'.repeat(66));
  console.log(`  admin        ${admin.email}`);
  console.log(`  donor        ${donors[0].email}   (${donors[0].bloodgroup}, never donated)`);
  console.log(`  donor        ${donors[2].email}   (${donors[2].bloodgroup}, mid-window)`);
  console.log(`  blood-bank   ${banks[0].email}    (verified)`);
  console.log(`  blood-bank   ${banks[3].email}    (pending verification)`);
  console.log(`  hospital     ${hospitals[0].email}`);
  console.log('-'.repeat(66));
  console.log(`  ${banks[0].name} stock:`);
  for (const g of BLOOD_GROUPS) {
    const row = matrix.groups.find((x) => x.bloodGroup === g);
    const flag = row.isEmpty ? ' (empty)' : row.isLow ? ' (low)' : '';
    console.log(`    ${g.padEnd(4)} ${String(row.units).padStart(3)}${flag}`);
  }
  console.log('-'.repeat(66) + '\n');

  return { admin, banks, hospitals, donors, matrix };
}

module.exports = seed;

// CLI entry point: only when run directly, so importing this file is side-effect free.
if (require.main === module) {
  seed({ reset: RESET })
    .then(async () => {
      await db.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[seed] failed:', err);
      await db.disconnect().catch(() => {});
      process.exit(1);
    });
}
