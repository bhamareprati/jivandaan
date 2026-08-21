'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, paginated } = require('../utils/apiResponse');
const { readPaging, buildMeta } = require('../utils/paginate');
const env = require('../config/env');
const {
  Donor, BloodBank, Hospital, BloodRequest, DonationHistory, ActivityLog,
} = require('../models');
const {
  BLOOD_GROUPS, VERIFICATION, ACTIONS, COLLECTIONS, DONATION_STATUS, REQUEST_STATUS,
} = require('../config/constants');
const notification = require('../services/notification');
const activityLogger = require('../services/activityLogger');

/** Doc 2 section 4.5. */

/* -------------------------------------------- GET /api/admin/metrics */

/**
 * Platform KPIs in as few round-trips as possible.
 *
 * This endpoint is polled by the admin dashboard, so the counts are gathered
 * with $facet rather than a dozen sequential queries.
 */
const getMetrics = asyncHandler(async (_req, res) => {
  const now = new Date();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const twelveWeeksAgo = new Date(now.getTime() - 12 * weekMs);
  const expiryHorizon = new Date(now.getTime() + env.EXPIRY_RADAR_DAYS * 24 * 60 * 60 * 1000);

  const [requestFacets] = await BloodRequest.aggregate([
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byUrgency: [{ $group: { _id: '$urgency', count: { $sum: 1 } } }],
        byBloodGroup: [
          { $group: { _id: '$bloodGroup', count: { $sum: 1 }, units: { $sum: '$units' } } },
          { $sort: { count: -1 } },
        ],
        total: [{ $count: 'value' }],
        fulfilment: [
          { $match: { status: REQUEST_STATUS.FULFILLED, fulfilledAt: { $ne: null } } },
          { $project: { ms: { $subtract: ['$fulfilledAt', '$createdAt'] } } },
          { $group: { _id: null, values: { $push: '$ms' }, count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const [donationFacets] = await DonationHistory.aggregate([
    {
      $facet: {
        stockByGroup: [
          { $match: { status: DONATION_STATUS.AVAILABLE, expiryDate: { $gt: now } } },
          { $group: { _id: '$bloodGroup', units: { $sum: '$unitsRemaining' } } },
        ],
        expiringSoon: [
          {
            $match: {
              status: DONATION_STATUS.AVAILABLE,
              expiryDate: { $gt: now, $lte: expiryHorizon },
            },
          },
          { $group: { _id: null, units: { $sum: '$unitsRemaining' }, batches: { $sum: 1 } } },
        ],
        expired: [
          { $match: { status: DONATION_STATUS.EXPIRED } },
          { $group: { _id: null, batches: { $sum: 1 } } },
        ],
        weeklyTrend: [
          { $match: { donationDate: { $gte: twelveWeeksAgo } } },
          {
            $group: {
              _id: {
                year: { $isoWeekYear: '$donationDate' },
                week: { $isoWeek: '$donationDate' },
              },
              donations: { $sum: 1 },
              units: { $sum: '$units' },
            },
          },
          { $sort: { '_id.year': 1, '_id.week': 1 } },
        ],
        total: [{ $count: 'value' }],
      },
    },
  ]);

  const [bankFacets] = await BloodBank.aggregate([
    { $facet: { byVerification: [{ $group: { _id: '$verificationStatus', count: { $sum: 1 } } }] } },
  ]);

  const [donorCount, hospitalCount] = await Promise.all([
    Donor.estimatedDocumentCount(),
    Hospital.estimatedDocumentCount(),
  ]);

  const asMap = (rows, key = 'count') =>
    Object.fromEntries((rows || []).map((r) => [r._id, r[key]]));

  const stockByGroup = Object.fromEntries(BLOOD_GROUPS.map((g) => [g, 0]));
  for (const r of donationFacets.stockByGroup) stockByGroup[r._id] = r.units;

  const fulfil = requestFacets.fulfilment[0];
  let medianHours = null;
  if (fulfil && fulfil.values.length) {
    const sorted = fulfil.values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianMs =
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    medianHours = Math.round((medianMs / 3600000) * 10) / 10;
  }

  const statusMap = asMap(requestFacets.byStatus);
  const totalRequests = requestFacets.total.length ? requestFacets.total[0].value : 0;
  const fulfilled = statusMap[REQUEST_STATUS.FULFILLED] || 0;

  return ok(res, {
    generatedAt: now,
    users: {
      donors: donorCount,
      hospitals: hospitalCount,
      banks: asMap(bankFacets.byVerification),
    },
    requests: {
      total: totalRequests,
      byStatus: statusMap,
      byUrgency: asMap(requestFacets.byUrgency),
      byBloodGroup: requestFacets.byBloodGroup.map((r) => ({
        bloodGroup: r._id,
        requests: r.count,
        units: r.units,
      })),
      fulfilmentRate: totalRequests ? Math.round((fulfilled / totalRequests) * 1000) / 10 : 0,
      medianTimeToFulfilHours: medianHours,
    },
    inventory: {
      totalUnits: Object.values(stockByGroup).reduce((s, v) => s + v, 0),
      byBloodGroup: stockByGroup,
      expiringWithinDays: env.EXPIRY_RADAR_DAYS,
      unitsExpiringSoon: donationFacets.expiringSoon.length
        ? donationFacets.expiringSoon[0].units
        : 0,
      batchesExpired: donationFacets.expired.length ? donationFacets.expired[0].batches : 0,
    },
    donations: {
      total: donationFacets.total.length ? donationFacets.total[0].value : 0,
      weeklyTrend: donationFacets.weeklyTrend.map((w) => ({
        year: w._id.year,
        week: w._id.week,
        label: `${w._id.year}-W${String(w._id.week).padStart(2, '0')}`,
        donations: w.donations,
        units: w.units,
      })),
    },
  });
});

/* -------------------------------------- GET /api/admin/banks/pending */

const listPendingBanks = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPaging(req.query);
  const filter = { verificationStatus: VERIFICATION.PENDING };

  const [items, total] = await Promise.all([
    BloodBank.find(filter).sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
    BloodBank.countDocuments(filter),
  ]);

  return paginated(
    res,
    items.map((b) => ({
      id: String(b._id),
      name: b.name,
      email: b.email,
      contact: b.contact,
      address: b.address,
      city: b.city,
      state: b.state,
      pincode: b.pincode,
      licenseNumber: b.licenseNumber || null,
      location: b.location || null,
      createdAt: b.createdAt,
      waitingDays: Math.floor((Date.now() - new Date(b.createdAt)) / 86400000),
    })),
    buildMeta({ page, limit, total })
  );
});

/* --------------------------------- PATCH /api/admin/banks/:id/verify */

const verifyBank = asyncHandler(async (req, res) => {
  const { action, reason } = req.body;

  const bank = await BloodBank.findById(req.params.id);
  if (!bank) throw ApiError.notFound('Blood bank not found');

  const previous = bank.verificationStatus;
  bank.verificationStatus =
    action === 'approve' ? VERIFICATION.VERIFIED : VERIFICATION.REJECTED;
  bank.verifiedBy = req.user.id;
  bank.verifiedAt = new Date();
  bank.rejectionReason = action === 'reject' ? reason : undefined;

  await bank.save();

  await notification.onBankVerified(bank, action, reason);

  await activityLogger.log({
    req,
    action: ACTIONS.BANK_VERIFY,
    description: `${action === 'approve' ? 'Approved' : 'Rejected'} blood bank "${bank.name}"`,
    targetUser: bank._id,
    targetModel: COLLECTIONS.BANKS,
    metadata: { bankId: String(bank._id), from: previous, to: bank.verificationStatus, reason: reason || null },
  });

  return ok(res, { bank: bank.toJSON() }, `Blood bank ${bank.verificationStatus}`);
});

/* ----------------------------------------------- GET /api/admin/logs */

/**
 * The audit trail. Append-only by design -- there is deliberately no route
 * anywhere in this API that updates or deletes a log entry.
 */
const listLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPaging(req.query);
  const { user, action, from, to } = req.query;

  const filter = {};
  if (user) filter.user = user;
  if (action) filter.action = action;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  const [items, total] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ActivityLog.countDocuments(filter),
  ]);

  return paginated(
    res,
    items.map((l) => ({
      id: String(l._id),
      user: String(l.user),
      userModel: l.userModel,
      action: l.action,
      description: l.description,
      targetUser: l.targetUser ? String(l.targetUser) : null,
      targetModel: l.targetModel || null,
      metadata: l.metadata || null,
      ip: l.ip || null,
      createdAt: l.createdAt,
    })),
    { ...buildMeta({ page, limit, total }), availableActions: Object.values(ACTIONS) }
  );
});

module.exports = { getMetrics, listPendingBanks, verifyBank, listLogs };
