'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginated } = require('../utils/apiResponse');
const { readPaging, buildMeta } = require('../utils/paginate');
const jwtUtil = require('../utils/jwt');
const { BloodBank } = require('../models');
const { VERIFICATION, BLOOD_GROUPS } = require('../config/constants');
const inventoryService = require('../services/inventory');
const expiryRadarService = require('../services/expiryRadar');

/** Doc 2 section 4.3. */

/* ------------------------------------- GET /api/banks/:id/inventory */

const getInventory = asyncHandler(async (req, res) => {
  const matrix = await inventoryService.getMatrix(req.params.id);
  const low = await expiryRadarService.lowStock(req.params.id);
  return ok(res, { ...matrix, lowStock: low.groups });
});

/* ----------------------------------- PATCH /api/banks/:id/inventory */

const patchInventory = asyncHandler(async (req, res) => {
  const result = await inventoryService.adjust({
    bankId: req.params.id,
    changes: req.body.inventory,
    reason: req.body.reason,
    req,
  });
  return ok(res, result, 'Inventory updated');
});

/* -------------------------------------- POST /api/banks/:id/checkin */

/**
 * Donor check-in.
 *
 * The QR token is verified for signature only; the donor is then re-read from
 * the database (plan decision D-12). The 56-day interval is enforced inside
 * inventoryService.checkIn, on the write path -- displaying eligibility on a
 * dashboard is not the same as preventing an ineligible donation.
 */
const checkin = asyncHandler(async (req, res) => {
  const { passToken, donorId, units, donationDate, notes } = req.body;

  let resolvedDonorId = donorId;

  if (passToken) {
    let payload;
    try {
      payload = jwtUtil.verify(passToken, 'donor-pass');
    } catch (err) {
      throw ApiError.unprocessable(
        err.name === 'TokenExpiredError'
          ? 'That donor pass has expired; ask the donor to refresh it in the app'
          : 'That QR code is not a valid Jivandan donor pass',
        [{ field: 'passToken', message: 'signature verification failed' }]
      );
    }
    resolvedDonorId = payload.sub;
  }

  const result = await inventoryService.checkIn({
    bankId: req.params.id,
    donorId: resolvedDonorId,
    units,
    donationDate,
    notes,
    req,
  });

  return created(res, result, 'Donation recorded');
});

/* --------------------------------- GET /api/banks/:id/expiry-radar */

const getExpiryRadar = asyncHandler(async (req, res) => {
  const data = await expiryRadarService.fullRadar(req.params.id, {
    windowDays: req.query.windowDays,
    req,
  });
  return ok(res, data);
});

/* ----------------------------------------------- POST reconcile (admin) */

const reconcile = asyncHandler(async (req, res) => {
  const result = await inventoryService.reconcile(req.params.id, { req });
  return ok(res, result, result.corrected ? 'Inventory reconciled' : 'Inventory already in sync');
});

/* ------------------------------------------------------ GET /api/banks */

/**
 * Geospatial search (plan decision D-5).
 *
 * Radius search when coordinates are supplied, exact city/pincode otherwise.
 * `matchedBy` tells the frontend which path produced each row so it can label
 * results honestly. Only verified banks are ever returned (D-4).
 */
const searchBanks = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPaging(req.query);
  const { lat, lng, radius, city, pincode, bloodGroup, minUnits } = req.query;

  const base = { verificationStatus: VERIFICATION.VERIFIED };
  if (bloodGroup) {
    base[`inventory.${bloodGroup}`] = { $gte: minUnits || 1 };
  } else if (minUnits) {
    base.$or = BLOOD_GROUPS.map((g) => ({ [`inventory.${g}`]: { $gte: minUnits } }));
  }

  const usingRadius = lat !== undefined && lng !== undefined;
  let items = [];
  let total = 0;

  if (usingRadius) {
    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distanceMeters',
          maxDistance: radius,
          query: base,
          spherical: true,
        },
      },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: limit }],
          count: [{ $count: 'total' }],
        },
      },
    ];
    const [agg] = await BloodBank.aggregate(pipeline);
    total = agg.count.length ? agg.count[0].total : 0;
    items = agg.rows.map((b) => ({ ...b, matchedBy: 'radius' }));
  } else {
    const filter = { ...base };
    if (city) filter.city = new RegExp(`^${String(city).trim()}$`, 'i');
    if (pincode) filter.pincode = String(pincode).trim();

    const [rows, count] = await Promise.all([
      BloodBank.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      BloodBank.countDocuments(filter),
    ]);
    total = count;
    items = rows.map((b) => ({ ...b, distanceMeters: null, matchedBy: 'city' }));
  }

  const shaped = items.map((b) => {
    const inventory = {};
    for (const g of BLOOD_GROUPS) inventory[g] = (b.inventory && b.inventory[g]) || 0;
    return {
      id: String(b._id),
      name: b.name,
      contact: b.contact,
      address: b.address,
      city: b.city,
      state: b.state,
      pincode: b.pincode,
      location: b.location || null,
      distanceMeters: b.distanceMeters === undefined ? null : b.distanceMeters,
      matchedBy: b.matchedBy,
      verificationStatus: b.verificationStatus,
      lowStockThreshold: b.lowStockThreshold,
      inventory,
      totalUnits: Object.values(inventory).reduce((s, v) => s + v, 0),
      unitsForRequestedGroup: bloodGroup ? inventory[bloodGroup] : null,
    };
  });

  return paginated(res, shaped, {
    ...buildMeta({ page, limit, total }),
    searchMode: usingRadius ? 'radius' : 'city',
    radiusMeters: usingRadius ? radius : null,
  });
});

/* ------------------------------------------------- GET /api/banks/:id */

const getBank = asyncHandler(async (req, res) => {
  const bank = await BloodBank.findById(req.params.id);
  if (!bank) throw ApiError.notFound('Blood bank not found');
  const matrix = await inventoryService.getMatrix(bank._id);
  return ok(res, { bank: bank.toJSON(), inventory: matrix });
});

module.exports = {
  getInventory,
  patchInventory,
  checkin,
  getExpiryRadar,
  reconcile,
  searchBanks,
  getBank,
};
