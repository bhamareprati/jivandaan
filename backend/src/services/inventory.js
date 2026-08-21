'use strict';

const { BloodBank, Donor, DonationHistory } = require('../models');
const { BLOOD_GROUPS, DONATION_STATUS, ACTIONS, COLLECTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { withTransaction, sessionOpt } = require('./txn');
const eligibilityService = require('./eligibility');
const activityLogger = require('./activityLogger');
const compatibility = require('./compatibility');

/**
 * Stock movement (plan decision D-6).
 *
 * `donationhistories` is the ledger and the source of truth: each row is a
 * batch with its own expiry. `blood-banks.inventory` is a denormalised Map so
 * the 8-group matrix is a single-document read. Every mutation here updates
 * BOTH, inside one transaction where the deployment supports it.
 */

function inventoryToObject(bank) {
  const out = {};
  for (const g of BLOOD_GROUPS) {
    const v = bank.inventory && typeof bank.inventory.get === 'function'
      ? bank.inventory.get(g)
      : bank.inventory && bank.inventory[g];
    out[g] = Number(v) || 0;
  }
  return out;
}

/** Atomic $inc on one blood-group key, floored at zero. */
async function bumpInventory(bankId, bloodGroup, delta, session) {
  const field = `inventory.${bloodGroup}`;

  if (delta < 0) {
    // Guarded decrement: refuses to run if it would drive the count negative.
    const res = await BloodBank.updateOne(
      { _id: bankId, [field]: { $gte: -delta } },
      { $inc: { [field]: delta } },
      sessionOpt(session)
    );
    if (res.matchedCount === 0) {
      throw ApiError.conflict(
        `Inventory for ${bloodGroup} is lower than the ${-delta} unit(s) being removed`
      );
    }
    return res;
  }

  return BloodBank.updateOne({ _id: bankId }, { $inc: { [field]: delta } }, sessionOpt(session));
}

/* --------------------------------------------------------------- check-in */

/**
 * Record a donation: ledger row in, inventory up, donor's clock reset.
 *
 * Enforces the 56-day interval on the write path -- displaying it on the
 * dashboard is not the same as preventing the write (Doc 4 section 4.1).
 */
async function checkIn({ bankId, donorId, units = 1, donationDate, notes, req, actor }) {
  const [bank, donor] = await Promise.all([
    BloodBank.findById(bankId),
    Donor.findById(donorId),
  ]);

  if (!bank) throw ApiError.notFound('Blood bank not found');
  if (!donor) throw ApiError.notFound('Donor not found');

  const when = donationDate ? new Date(donationDate) : new Date();

  const eligibility = eligibilityService.forDonor(donor, when);
  if (!eligibility.eligible) {
    throw ApiError.unprocessable(
      `Donor is not yet eligible. Next eligible on ${eligibility.nextEligibleDate.toISOString().slice(0, 10)}.`,
      [
        {
          field: 'donorId',
          message: `${eligibility.daysRemaining} day(s) remaining in the ${eligibility.intervalDays}-day interval`,
          nextEligibleDate: eligibility.nextEligibleDate,
        },
      ]
    );
  }

  const result = await withTransaction(async (session) => {
    const [donation] = await DonationHistory.create(
      [
        {
          donor: donor._id,
          bloodBank: bank._id,
          bloodGroup: donor.bloodgroup,
          units,
          unitsRemaining: units,
          donationDate: when,
          status: DONATION_STATUS.AVAILABLE,
          notes,
        },
      ],
      sessionOpt(session)
    );

    await bumpInventory(bank._id, donor.bloodgroup, units, session);

    await Donor.updateOne(
      { _id: donor._id },
      { $set: { lastDonationDate: when } },
      sessionOpt(session)
    );

    await activityLogger.log({
      req,
      actor,
      action: ACTIONS.DONATION_CHECKIN,
      description: `Logged ${units} unit(s) of ${donor.bloodgroup} from ${donor.name}`,
      targetUser: donor._id,
      targetModel: COLLECTIONS.DONORS,
      metadata: {
        bankId: String(bank._id),
        donationId: String(donation._id),
        bloodGroup: donor.bloodgroup,
        units,
        expiryDate: donation.expiryDate,
      },
      session,
    });

    return donation;
  });

  const fresh = await BloodBank.findById(bankId);

  return {
    donation: result.toJSON(),
    donor: {
      id: donor._id,
      name: donor.name,
      bloodgroup: donor.bloodgroup,
      lastDonationDate: when,
      eligibility: eligibilityService.getEligibility(when),
    },
    inventory: inventoryToObject(fresh),
  };
}

/* -------------------------------------------------------------- consuming */

/**
 * Consume `units` of `bloodGroup` from a bank, first-expiring-first-out.
 *
 * FEFO matters: issuing the freshest unit first is how blood banks end up
 * discarding the older ones.
 */
async function consume({ bankId, bloodGroup, units, requestId, session }) {
  const rows = await DonationHistory.find({
    bloodBank: bankId,
    bloodGroup,
    status: DONATION_STATUS.AVAILABLE,
    unitsRemaining: { $gt: 0 },
    expiryDate: { $gt: new Date() },
  })
    .sort({ expiryDate: 1, donationDate: 1 })
    .session(session || null);

  const totalAvailable = rows.reduce((s, r) => s + r.unitsRemaining, 0);
  if (totalAvailable < units) {
    throw ApiError.conflict(
      `Insufficient stock: ${bloodGroup} has ${totalAvailable} unit(s) available, ${units} required`,
      [{ field: 'units', message: `shortfall of ${units - totalAvailable} unit(s)`, bloodGroup }]
    );
  }

  let remaining = units;
  const consumedFrom = [];

  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(row.unitsRemaining, remaining);

    row.unitsRemaining -= take;
    if (row.unitsRemaining === 0) {
      row.status = DONATION_STATUS.USED;
      row.consumedByRequest = requestId || undefined;
    }
    await row.save(sessionOpt(session));

    consumedFrom.push({ donation: row._id, bloodGroup, units: take });
    remaining -= take;
  }

  await bumpInventory(bankId, bloodGroup, -units, session);

  return consumedFrom;
}

/* ------------------------------------------------------------ adjustments */

/**
 * Manual correction of a stock count (PATCH /api/banks/:id/inventory).
 *
 * Adjustments touch only the cached Map, not the ledger, so they are recorded
 * verbatim in the audit log: an operator overriding the count is exactly the
 * kind of event an audit trail exists for.
 */
async function adjust({ bankId, changes, req, actor, reason }) {
  const bank = await BloodBank.findById(bankId);
  if (!bank) throw ApiError.notFound('Blood bank not found');

  const before = inventoryToObject(bank);
  const applied = {};

  for (const [group, value] of Object.entries(changes)) {
    if (!BLOOD_GROUPS.includes(group)) {
      throw ApiError.unprocessable(`Unknown blood group: ${group}`, [
        { field: `inventory.${group}`, message: 'not one of the eight blood groups' },
      ]);
    }
    const next = Math.max(0, Number(value));
    bank.inventory.set(group, next);
    applied[group] = { from: before[group], to: next, delta: next - before[group] };
  }

  await bank.save();

  await activityLogger.log({
    req,
    actor,
    action: ACTIONS.INVENTORY_ADJUST,
    description: `Adjusted stock for ${Object.keys(applied).join(', ')}`,
    targetUser: bank._id,
    targetModel: COLLECTIONS.BANKS,
    metadata: { bankId: String(bank._id), changes: applied, reason: reason || null },
  });

  return { inventory: inventoryToObject(bank), applied };
}

/* ---------------------------------------------------------- reconciliation */

/**
 * Rebuild the cached Map from the ledger. The safety net for D-6: if a crash
 * lands between the two writes with transactions off, this repairs the drift.
 */
async function reconcile(bankId, { req, actor } = {}) {
  const bank = await BloodBank.findById(bankId);
  if (!bank) throw ApiError.notFound('Blood bank not found');

  const rows = await DonationHistory.aggregate([
    {
      $match: {
        bloodBank: bank._id,
        status: DONATION_STATUS.AVAILABLE,
        expiryDate: { $gt: new Date() },
      },
    },
    { $group: { _id: '$bloodGroup', units: { $sum: '$unitsRemaining' } } },
  ]);

  const truth = Object.fromEntries(BLOOD_GROUPS.map((g) => [g, 0]));
  for (const r of rows) truth[r._id] = r.units;

  const before = inventoryToObject(bank);
  const drift = {};
  for (const g of BLOOD_GROUPS) {
    if (before[g] !== truth[g]) drift[g] = { was: before[g], now: truth[g] };
    bank.inventory.set(g, truth[g]);
  }

  await bank.save();

  if (Object.keys(drift).length) {
    await activityLogger.log({
      req,
      actor,
      action: ACTIONS.INVENTORY_RECONCILE,
      description: `Reconciled inventory from the donation ledger (${Object.keys(drift).length} group(s) corrected)`,
      targetUser: bank._id,
      targetModel: COLLECTIONS.BANKS,
      metadata: { bankId: String(bank._id), drift },
    });
  }

  return { inventory: truth, drift, corrected: Object.keys(drift).length };
}

/* ------------------------------------------------------------------ reads */

/**
 * The 8-group stock matrix. Always returns all eight groups, each annotated
 * with its low-stock and near-expiry state so the frontend never has to
 * recompute policy client-side.
 */
async function getMatrix(bankId, { expiringWithinDays } = {}) {
  const bank = await BloodBank.findById(bankId);
  if (!bank) throw ApiError.notFound('Blood bank not found');

  const env = require('../config/env');
  const windowDays = expiringWithinDays || env.EXPIRY_RADAR_DAYS;
  const horizon = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000);

  const soon = await DonationHistory.aggregate([
    {
      $match: {
        bloodBank: bank._id,
        status: DONATION_STATUS.AVAILABLE,
        expiryDate: { $gt: new Date(), $lte: horizon },
      },
    },
    { $group: { _id: '$bloodGroup', units: { $sum: '$unitsRemaining' } } },
  ]);
  const expiringByGroup = Object.fromEntries(soon.map((s) => [s._id, s.units]));

  const counts = inventoryToObject(bank);
  const threshold = bank.lowStockThreshold;

  const groups = BLOOD_GROUPS.map((g) => ({
    bloodGroup: g,
    units: counts[g],
    isLow: counts[g] > 0 && counts[g] < threshold,
    isEmpty: counts[g] === 0,
    expiringSoon: expiringByGroup[g] || 0,
    canServe: compatibility.canDonateTo(g),
  }));

  return {
    bankId: String(bank._id),
    bankName: bank.name,
    verificationStatus: bank.verificationStatus,
    lowStockThreshold: threshold,
    expiryWindowDays: windowDays,
    totalUnits: groups.reduce((s, g) => s + g.units, 0),
    groups,
    inventory: counts,
  };
}

module.exports = {
  checkIn,
  consume,
  adjust,
  reconcile,
  getMatrix,
  bumpInventory,
  inventoryToObject,
};
