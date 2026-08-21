'use strict';

const env = require('../config/env');
const { BloodBank, DonationHistory } = require('../models');
const { BLOOD_GROUPS, DONATION_STATUS, ACTIONS, COLLECTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { daysBetweenUTC } = require('../utils/dates');
const inventoryService = require('./inventory');
const activityLogger = require('./activityLogger');

/**
 * Expiry & Depletion Radar (Doc 2 section 5.2).
 *
 * Units live 42 days from donation; the radar flags anything inside the last
 * `EXPIRY_RADAR_DAYS` of that, plus any blood group below the bank's low-stock
 * threshold.
 */

/**
 * Mark past-expiry rows expired and take those units out of the cached counts.
 *
 * Runs on a schedule AND lazily on every radar read, so the numbers are right
 * even when the cron is not running -- a radar that reports stale stock is
 * worse than no radar.
 */
async function sweepExpired(bankId = null, { req, actor } = {}) {
  const filter = {
    status: DONATION_STATUS.AVAILABLE,
    expiryDate: { $lte: new Date() },
  };
  if (bankId) filter.bloodBank = bankId;

  const stale = await DonationHistory.find(filter).select(
    '_id bloodBank bloodGroup unitsRemaining expiryDate'
  );

  if (!stale.length) return { expiredRows: 0, unitsRemoved: 0, byBank: {} };

  const byBank = {};
  let unitsRemoved = 0;

  for (const row of stale) {
    const bank = String(row.bloodBank);
    byBank[bank] = byBank[bank] || {};
    byBank[bank][row.bloodGroup] = (byBank[bank][row.bloodGroup] || 0) + row.unitsRemaining;
    unitsRemoved += row.unitsRemaining;
  }

  await DonationHistory.updateMany(
    { _id: { $in: stale.map((r) => r._id) } },
    { $set: { status: DONATION_STATUS.EXPIRED, unitsRemaining: 0 } }
  );

  for (const [bank, groups] of Object.entries(byBank)) {
    for (const [group, units] of Object.entries(groups)) {
      if (units > 0) {
        // Floor at zero rather than throwing: an expiry sweep must always
        // complete, even if the cached count had already drifted low.
        await BloodBank.updateOne(
          { _id: bank, [`inventory.${group}`]: { $gte: units } },
          { $inc: { [`inventory.${group}`]: -units } }
        );
      }
    }

    await activityLogger.log({
      req,
      actor: actor || { user: bank, userModel: COLLECTIONS.BANKS },
      action: ACTIONS.UNITS_EXPIRED,
      description: `Expiry sweep removed ${Object.values(groups).reduce((a, b) => a + b, 0)} unit(s)`,
      targetUser: bank,
      targetModel: COLLECTIONS.BANKS,
      metadata: { bankId: bank, groups },
    });
  }

  return { expiredRows: stale.length, unitsRemoved, byBank };
}

/**
 * Units approaching expiry at one bank, soonest first.
 *
 * @returns batches with daysToExpiry plus a per-group rollup for the dashboard.
 */
async function radar(bankId, { windowDays = env.EXPIRY_RADAR_DAYS, req, actor } = {}) {
  const bank = await BloodBank.findById(bankId);
  if (!bank) throw ApiError.notFound('Blood bank not found');

  const sweep = await sweepExpired(bankId, { req, actor });

  const now = new Date();
  const horizon = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const rows = await DonationHistory.find({
    bloodBank: bank._id,
    status: DONATION_STATUS.AVAILABLE,
    unitsRemaining: { $gt: 0 },
    expiryDate: { $gt: now, $lte: horizon },
  })
    .sort({ expiryDate: 1 })
    .populate('donor', 'name bloodgroup')
    .lean();

  const batches = rows.map((r) => ({
    donationId: String(r._id),
    bloodGroup: r.bloodGroup,
    units: r.unitsRemaining,
    donationDate: r.donationDate,
    expiryDate: r.expiryDate,
    daysToExpiry: daysBetweenUTC(now, r.expiryDate),
    donorName: r.donor ? r.donor.name : null,
    severity: daysBetweenUTC(now, r.expiryDate) <= 2 ? 'critical' : 'warning',
  }));

  const byGroup = {};
  for (const b of batches) {
    if (!byGroup[b.bloodGroup]) {
      byGroup[b.bloodGroup] = { bloodGroup: b.bloodGroup, units: 0, soonestDays: b.daysToExpiry };
    }
    byGroup[b.bloodGroup].units += b.units;
    byGroup[b.bloodGroup].soonestDays = Math.min(byGroup[b.bloodGroup].soonestDays, b.daysToExpiry);
  }

  return {
    bankId: String(bank._id),
    bankName: bank.name,
    windowDays,
    shelfLifeDays: env.UNIT_SHELF_LIFE_DAYS,
    totalUnitsAtRisk: batches.reduce((s, b) => s + b.units, 0),
    sweptOnRead: sweep,
    byGroup: Object.values(byGroup).sort((a, b) => a.soonestDays - b.soonestDays),
    batches,
  };
}

/** Blood groups at or below the bank's configured threshold. */
async function lowStock(bankId) {
  const bank = await BloodBank.findById(bankId);
  if (!bank) throw ApiError.notFound('Blood bank not found');

  const counts = inventoryService.inventoryToObject(bank);
  const threshold = bank.lowStockThreshold;

  const groups = BLOOD_GROUPS.filter((g) => counts[g] < threshold).map((g) => ({
    bloodGroup: g,
    units: counts[g],
    threshold,
    shortfall: threshold - counts[g],
    severity: counts[g] === 0 ? 'critical' : 'warning',
  }));

  return { bankId: String(bank._id), threshold, groups, isDepleted: groups.length > 0 };
}

/** Combined view used by the cron job and the bank dashboard. */
async function fullRadar(bankId, opts = {}) {
  const [expiry, depletion] = await Promise.all([radar(bankId, opts), lowStock(bankId)]);
  return { ...expiry, lowStock: depletion };
}

module.exports = { sweepExpired, radar, lowStock, fullRadar };
