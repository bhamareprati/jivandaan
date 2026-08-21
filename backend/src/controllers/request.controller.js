'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created, paginated } = require('../utils/apiResponse');
const { readPaging, buildMeta } = require('../utils/paginate');
const { BloodRequest, BloodBank, Donor } = require('../models');
const {
  ROLES,
  ACTIONS,
  COLLECTIONS,
  REQUEST_STATUS,
  VERIFICATION,
  URGENCY_RANK,
} = require('../config/constants');
const compatibility = require('../services/compatibility');
const eligibilityService = require('../services/eligibility');
const inventoryService = require('../services/inventory');
const lifecycle = require('../services/requestLifecycle');
const notification = require('../services/notification');
const activityLogger = require('../services/activityLogger');
const { withTransaction, sessionOpt } = require('../services/txn');

/** Doc 2 section 4.4. */

function requesterModelFor(role) {
  if (role === ROLES.DONOR) return COLLECTIONS.DONORS;
  if (role === ROLES.HOSPITAL) return COLLECTIONS.HOSPITALS;
  throw ApiError.forbidden('Only donors and hospitals may raise a blood request');
}

/** Read an id off a ref that may or may not have been populated. */
function refId(value) {
  if (!value) return null;
  return String(value._id || value);
}

/** Requester, assigned bank and admins may read a request; nobody else. */
function assertCanView(request, user) {
  if (user.role === ROLES.ADMIN) return;
  const isRequester = refId(request.requester) === user.id;
  const isBank = refId(request.bloodBank) === user.id;
  if (!isRequester && !isBank) {
    throw ApiError.forbidden('You do not have access to this request');
  }
}

/* -------------------------------------------------- POST /api/requests */

const createRequest = asyncHandler(async (req, res) => {
  const requesterModel = requesterModelFor(req.user.role);
  const { bloodBank, ...fields } = req.body;

  let bank = null;
  if (bloodBank) {
    bank = await BloodBank.findById(bloodBank);
    if (!bank) throw ApiError.notFound('Blood bank not found');
    if (bank.verificationStatus !== VERIFICATION.VERIFIED) {
      throw ApiError.unprocessable('That blood bank is not verified and cannot accept requests', [
        { field: 'bloodBank', message: `verification status is ${bank.verificationStatus}` },
      ]);
    }
  }

  const request = await BloodRequest.create({
    ...fields,
    requester: req.user.id,
    requesterModel,
    bloodBank: bank ? bank._id : null,
    status: REQUEST_STATUS.PENDING,
    statusHistory: [
      {
        status: REQUEST_STATUS.PENDING,
        changedBy: req.user.id,
        changedByModel: requesterModel,
        at: new Date(),
      },
    ],
  });

  await activityLogger.log({
    req,
    action: ACTIONS.REQUEST_CREATE,
    description: `Raised a ${request.urgency} request for ${request.units} unit(s) of ${request.bloodGroup}`,
    targetUser: request._id,
    targetModel: COLLECTIONS.REQUESTS,
    metadata: {
      requestId: String(request._id),
      bloodGroup: request.bloodGroup,
      units: request.units,
      urgency: request.urgency,
      bankId: bank ? String(bank._id) : null,
    },
  });

  // Urgency-driven notification hook (Doc 2 section 5.4). Deliberately not
  // awaited into the response path -- a provider outage must not fail a
  // critical request. Errors are swallowed inside the service.
  let notified = null;
  if (request.urgency === 'critical') {
    notified = await dispatchCriticalHook(request);
  }

  const substitutes = bank
    ? compatibility.rankSubstitutes(bank.inventory, request.bloodGroup, request.units)
    : null;

  return created(
    res,
    {
      request: request.toJSON(),
      stepper: lifecycle.buildStepper(request),
      substitutes,
      notified,
    },
    'Request created'
  );
});

/**
 * Find who should hear about a critical request and hand off to the
 * notification service: donors whose group can serve it and who have cleared
 * the 56-day interval, plus verified banks holding compatible stock.
 */
async function dispatchCriticalHook(request) {
  try {
    const donorGroups = compatibility.compatibleDonorsFor(request.bloodGroup);
    const cutoff = eligibilityService.eligibleSinceCutoff();

    const donors = await Donor.find({
      bloodgroup: { $in: donorGroups },
      $or: [{ lastDonationDate: null }, { lastDonationDate: { $lte: cutoff } }],
    })
      .select('_id name contact bloodgroup')
      .limit(200)
      .lean();

    const banks = await BloodBank.find({
      verificationStatus: VERIFICATION.VERIFIED,
      $or: donorGroups.map((g) => ({ [`inventory.${g}`]: { $gt: 0 } })),
    })
      .select('_id name email')
      .limit(50)
      .lean();

    return await notification.onCriticalRequest(request, { donors, banks });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[notify] critical hook failed for ${request._id}: ${err.message}`);
    return null;
  }
}

/* ----------------------------------------------- GET /api/requests/:id */

const getRequest = asyncHandler(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id)
    .populate('bloodBank', 'name city contact address location verificationStatus')
    .populate('requester', 'name contact email city');

  if (!request) throw ApiError.notFound('Request not found');
  assertCanView(request, req.user);

  const substitutes =
    request.bloodBank && request.bloodBank.inventory
      ? compatibility.rankSubstitutes(request.bloodBank.inventory, request.bloodGroup, request.units)
      : null;

  return ok(res, {
    request: request.toJSON(),
    stepper: lifecycle.buildStepper(request),
    substitutes,
  });
});

/* -------------------------------------- PATCH /api/requests/:id/status */

/**
 * Advance the request.
 *
 * The transition is authorised by the state machine (plan decision D-1), and
 * reaching `fulfilled` consumes stock in the same transaction as the status
 * write, so a fulfilment can never be recorded without the units leaving the
 * shelf.
 */
const patchStatus = asyncHandler(async (req, res) => {
  const { status, note, reason, fulfillFromGroup } = req.body;

  const request = await BloodRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Request not found');

  const isRequester = refId(request.requester) === req.user.id;

  // A bank may only drive a request that is actually assigned to it.
  if (req.user.role === ROLES.BANK) {
    if (refId(request.bloodBank) !== req.user.id) {
      throw ApiError.forbidden('This request is not assigned to your blood bank');
    }
  }

  lifecycle.assertTransition(request.status, status, req.user.role, { isRequester });

  const from = request.status;
  let consumed = null;

  await withTransaction(async (session) => {
    if (status === REQUEST_STATUS.FULFILLED) {
      if (!request.bloodBank) {
        throw ApiError.conflict('This request has no assigned blood bank to draw units from');
      }

      const drawGroup = fulfillFromGroup || request.bloodGroup;
      if (!compatibility.isCompatible(drawGroup, request.bloodGroup)) {
        throw ApiError.unprocessable(
          `${drawGroup} is not compatible with a ${request.bloodGroup} recipient`,
          [{ field: 'fulfillFromGroup', message: 'incompatible blood group' }]
        );
      }

      consumed = await inventoryService.consume({
        bankId: request.bloodBank,
        bloodGroup: drawGroup,
        units: request.units,
        requestId: request._id,
        session,
      });

      request.consumedFrom = consumed;
      request.fulfilledAt = new Date();
    }

    if (status === REQUEST_STATUS.REJECTED) {
      request.rejectionReason = reason || note || null;
    }

    request.status = status;
    request.statusHistory.push({
      status,
      changedBy: req.user.id,
      changedByModel: req.user.model,
      note: note || reason,
      at: new Date(),
    });

    await request.save(sessionOpt(session));

    await activityLogger.log({
      req,
      action: ACTIONS.REQUEST_STATUS_CHANGE,
      description: `Moved request from ${from} to ${status}`,
      targetUser: request._id,
      targetModel: COLLECTIONS.REQUESTS,
      metadata: {
        requestId: String(request._id),
        from,
        to: status,
        note: note || reason || null,
        consumedFrom: consumed,
      },
      session,
    });
  });

  const populated = await BloodRequest.findById(request._id)
    .populate('bloodBank', 'name city contact')
    .populate('requester', 'name contact');

  if (populated.requester && populated.requester.contact) {
    await notification.onRequestStatusChange(populated, populated.requester.contact);
  }

  return ok(
    res,
    { request: populated.toJSON(), stepper: lifecycle.buildStepper(populated), consumed },
    `Request ${status}`
  );
});

/* --------------------------------------------------- GET /api/requests */

const listRequests = asyncHandler(async (req, res) => {
  const { page, limit, skip } = readPaging(req.query);
  const { urgency, status, bank, bloodGroup, mine } = req.query;

  const filter = {};
  if (urgency) filter.urgency = urgency;
  if (status) filter.status = status;
  if (bloodGroup) filter.bloodGroup = bloodGroup;

  if (req.user.role === ROLES.BANK) {
    // A bank sees its own queue, plus unassigned requests it could pick up.
    filter.$or = [{ bloodBank: req.user.id }, { bloodBank: null }];
  } else if (req.user.role === ROLES.ADMIN) {
    if (bank) filter.bloodBank = bank;
  } else {
    // Donors and hospitals only ever see their own.
    filter.requester = req.user.id;
  }

  if (mine && req.user.role !== ROLES.ADMIN) filter.requester = req.user.id;

  const [rows, total] = await Promise.all([
    BloodRequest.find(filter)
      .populate('bloodBank', 'name city')
      .populate('requester', 'name contact')
      .lean(),
    BloodRequest.countDocuments(filter),
  ]);

  const sorted = rows
    .sort((a, b) => {
      const ra = URGENCY_RANK[a.urgency] || 0;
      const rb = URGENCY_RANK[b.urgency] || 0;
      if (ra !== rb) return rb - ra;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .slice(skip, skip + limit)
    .map((r) => ({
      ...r,
      id: String(r._id),
      nextStatuses: lifecycle.nextStatuses(r.status),
      isTerminal: lifecycle.isTerminal(r.status),
    }));

  return paginated(res, sorted, buildMeta({ page, limit, total }));
});

/* ------------------------------- GET /api/requests/match/:bloodGroup */

/**
 * Universal compatibility matching (Doc 2 section 5.1).
 *
 * With ?bankId= it ranks that bank's actual stock; without it, it reports the
 * compatibility rules and which nearby banks could cover the request.
 */
const matchGroup = asyncHandler(async (req, res) => {
  const { bloodGroup } = req.params;
  const { bankId, units } = req.query;

  const rules = {
    requestedGroup: bloodGroup,
    compatibleDonorGroups: compatibility.compatibleDonorsFor(bloodGroup),
    canDonateTo: compatibility.canDonateTo(bloodGroup),
  };

  if (bankId) {
    const bank = await BloodBank.findById(bankId);
    if (!bank) throw ApiError.notFound('Blood bank not found');
    return ok(res, {
      ...rules,
      bank: { id: String(bank._id), name: bank.name },
      ...compatibility.rankSubstitutes(bank.inventory, bloodGroup, units),
    });
  }

  const donorGroups = rules.compatibleDonorGroups;
  const banks = await BloodBank.find({
    verificationStatus: VERIFICATION.VERIFIED,
    $or: donorGroups.map((g) => ({ [`inventory.${g}`]: { $gte: units } })),
  })
    .select('name city inventory')
    .limit(25)
    .lean();

  return ok(res, {
    ...rules,
    unitsRequested: units,
    banksWithStock: banks.map((b) => ({
      id: String(b._id),
      name: b.name,
      city: b.city,
      matches: donorGroups
        .map((g) => ({ bloodGroup: g, units: (b.inventory && b.inventory[g]) || 0 }))
        .filter((m) => m.units >= units),
    })),
  });
});

module.exports = { createRequest, getRequest, patchStatus, listRequests, matchGroup };
