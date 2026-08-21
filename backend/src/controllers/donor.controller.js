'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, paginated } = require('../utils/apiResponse');
const { readPaging, buildMeta } = require('../utils/paginate');
const jwtUtil = require('../utils/jwt');
const { Donor, BloodRequest, DonationHistory } = require('../models');
const {
  ACTIONS,
  COLLECTIONS,
  REQUEST_STATUS,
  URGENCY_RANK,
  DONATION_STATUS,
} = require('../config/constants');
const eligibility = require('../services/eligibility');
const compatibility = require('../services/compatibility');
const activityLogger = require('../services/activityLogger');

/** Doc 2 section 4.2. */

/** Lifetime totals for the dashboard's animated counters. */
async function impactStats(donorId) {
  const rows = await DonationHistory.aggregate([
    { $match: { donor: donorId } },
    {
      $group: {
        _id: null,
        totalDonations: { $sum: 1 },
        totalUnits: { $sum: '$units' },
        firstDonation: { $min: '$donationDate' },
        lastDonation: { $max: '$donationDate' },
      },
    },
  ]);

  const s = rows[0] || { totalDonations: 0, totalUnits: 0, firstDonation: null, lastDonation: null };

  return {
    totalDonations: s.totalDonations,
    totalUnits: s.totalUnits,
    // One donated unit is commonly separated into components serving up to
    // three patients. Presented as an estimate, not a count.
    livesImpactedEstimate: s.totalUnits * 3,
    firstDonation: s.firstDonation,
    lastDonation: s.lastDonation,
  };
}

/** Milestone badges for the digital pass. */
function badgesFor(totalDonations) {
  const tiers = [
    { id: 'first_drop', label: 'First Drop', at: 1 },
    { id: 'lifesaver', label: 'Lifesaver', at: 5 },
    { id: 'guardian', label: 'Guardian', at: 10 },
    { id: 'champion', label: 'Champion', at: 25 },
    { id: 'legend', label: 'Legend', at: 50 },
  ];
  return tiers.map((t) => ({
    ...t,
    earned: totalDonations >= t.at,
    remaining: Math.max(0, t.at - totalDonations),
  }));
}

/* ---------------------------------------------------- GET /api/donors/me */

const getMe = asyncHandler(async (req, res) => {
  const donor = req.user.doc;
  const stats = await impactStats(donor._id);

  return ok(res, {
    profile: donor.toJSON(),
    eligibility: eligibility.forDonor(donor),
    impact: stats,
    canDonateTo: compatibility.canDonateTo(donor.bloodgroup),
  });
});

/* -------------------------------------------------- PATCH /api/donors/me */

const updateMe = asyncHandler(async (req, res) => {
  const { coordinates, ...fields } = req.body;
  const donor = await Donor.findById(req.user.id);
  if (!donor) throw ApiError.notFound('Donor not found');

  Object.assign(donor, fields);
  if (coordinates) donor.location = { type: 'Point', coordinates };

  await donor.save();

  await activityLogger.log({
    req,
    action: ACTIONS.PROFILE_UPDATE,
    description: `Updated profile fields: ${Object.keys(fields).join(', ') || 'location'}`,
    targetUser: donor._id,
    targetModel: COLLECTIONS.DONORS,
    metadata: { fields: Object.keys(fields) },
  });

  return ok(res, { profile: donor.toJSON() }, 'Profile updated');
});

/* ----------------------------------------------- GET /api/donors/me/pass */

/**
 * The digital donor pass.
 *
 * The QR carries a signed, long-lived token (plan decision D-12) so a printed
 * pass keeps working; check-in verifies the signature and then re-reads the
 * donor from the database rather than trusting anything in the token.
 */
const getPass = asyncHandler(async (req, res) => {
  const donor = req.user.doc;

  const history = await DonationHistory.find({ donor: donor._id })
    .sort({ donationDate: -1 })
    .populate('bloodBank', 'name city')
    .lean();

  const stats = await impactStats(donor._id);

  return ok(res, {
    pass: {
      // The literal string encoded into the QR image by the frontend.
      qrPayload: jwtUtil.signPassToken({ id: donor._id, bloodgroup: donor.bloodgroup }),
      donorId: String(donor._id),
      name: donor.name,
      bloodgroup: donor.bloodgroup,
      memberSince: donor.createdAt,
    },
    eligibility: eligibility.forDonor(donor),
    impact: stats,
    badges: badgesFor(stats.totalDonations),
    timeline: history.map((h) => ({
      donationId: String(h._id),
      bloodGroup: h.bloodGroup,
      units: h.units,
      donationDate: h.donationDate,
      expiryDate: h.expiryDate,
      status: h.status,
      bankName: h.bloodBank ? h.bloodBank.name : null,
      bankCity: h.bloodBank ? h.bloodBank.city : null,
      isExpired: h.status === DONATION_STATUS.EXPIRED,
    })),
  });
});

/* -------------------------------------------------- GET /api/donors/feed */

/**
 * Open requests this donor can actually answer.
 *
 * Uses canDonateTo, NOT compatibleDonorsFor: the question here is "which
 * patients can my blood serve", which is the transpose of "what can this
 * patient receive" (plan decision D-13). Getting this backwards silently shows
 * every donor the wrong feed.
 */
const getFeed = asyncHandler(async (req, res) => {
  const donor = req.user.doc;
  const { page, limit, skip } = readPaging(req.query);
  const { city, lat, lng, radius, urgency } = req.query;

  const servable = compatibility.canDonateTo(donor.bloodgroup);

  const filter = {
    bloodGroup: { $in: servable },
    status: { $in: [REQUEST_STATUS.PENDING, REQUEST_STATUS.UNDER_REVIEW, REQUEST_STATUS.APPROVED] },
  };
  if (urgency) filter.urgency = urgency;

  // Location narrowing runs through the bank the request is aimed at, since
  // that is where the donor would physically go.
  let bankIds = null;
  if (lat !== undefined && lng !== undefined) {
    const { BloodBank } = require('../models');
    const near = await BloodBank.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radius || 25000,
        },
      },
    }).select('_id');
    bankIds = near.map((b) => b._id);
  } else if (city || donor.city) {
    const { BloodBank } = require('../models');
    const inCity = await BloodBank.find({
      city: new RegExp(`^${String(city || donor.city).trim()}$`, 'i'),
    }).select('_id');
    bankIds = inCity.map((b) => b._id);
  }

  if (bankIds && bankIds.length) {
    filter.$or = [{ bloodBank: { $in: bankIds } }, { bloodBank: null }];
  }

  const [rows, total] = await Promise.all([
    BloodRequest.find(filter)
      .populate('bloodBank', 'name city state location')
      .lean(),
    BloodRequest.countDocuments(filter),
  ]);

  // Urgency first, then oldest -- a critical request from an hour ago outranks
  // a low-priority one from a minute ago. Sorted in memory because the rank is
  // derived, not stored.
  const sorted = rows
    .sort((a, b) => {
      const ra = URGENCY_RANK[a.urgency] || 0;
      const rb = URGENCY_RANK[b.urgency] || 0;
      if (ra !== rb) return rb - ra;
      return new Date(a.createdAt) - new Date(b.createdAt);
    })
    .slice(skip, skip + limit);

  const items = sorted.map((r) => ({
    id: String(r._id),
    bloodGroup: r.bloodGroup,
    units: r.units,
    urgency: r.urgency,
    status: r.status,
    hospitalName: r.hospitalName,
    patientName: r.patientName,
    requiredBy: r.requiredBy,
    createdAt: r.createdAt,
    bank: r.bloodBank
      ? { id: String(r.bloodBank._id), name: r.bloodBank.name, city: r.bloodBank.city }
      : null,
    isExactMatch: r.bloodGroup === donor.bloodgroup,
  }));

  return paginated(res, items, {
    ...buildMeta({ page, limit, total }),
    donorBloodGroup: donor.bloodgroup,
    servableGroups: servable,
  });
});

module.exports = { getMe, updateMe, getPass, getFeed, impactStats, badgesFor };
