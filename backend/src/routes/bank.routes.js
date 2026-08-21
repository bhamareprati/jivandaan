'use strict';

const express = require('express');
const ctrl = require('../controllers/bank.controller');
const validate = require('../middleware/validate');
const v = require('../validators/domain.validators');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requireBankOwner, requireVerifiedBank } = require('../middleware/rbac');
const { ROLES } = require('../config/constants');

const router = express.Router();

router.use(requireAuth);

// Doc 2 section 4.3.

// Geospatial search. Registered before /:id so "banks" is never read as an id.
router.get('/', validate(v.bankSearch), ctrl.searchBanks);

router.get('/:id', validate(v.idParam), ctrl.getBank);
router.get('/:id/inventory', validate(v.idParam), ctrl.getInventory);

// Writes are owner-or-admin only.
router.patch(
  '/:id/inventory',
  validate(v.inventoryPatch),
  requireBankOwner('id'),
  ctrl.patchInventory
);

// Check-in additionally requires the bank to be verified: an unverified bank
// may complete its profile but may not trade (plan decision D-4).
router.post(
  '/:id/checkin',
  validate(v.checkin),
  requireBankOwner('id'),
  requireVerifiedBank,
  ctrl.checkin
);

router.get(
  '/:id/expiry-radar',
  validate(v.expiryRadar),
  requireBankOwner('id'),
  ctrl.getExpiryRadar
);

// Repairs drift between the ledger and the cached count (plan decision D-6).
router.post(
  '/:id/reconcile',
  validate(v.idParam),
  requireRole(ROLES.BANK, ROLES.ADMIN),
  requireBankOwner('id'),
  ctrl.reconcile
);

module.exports = router;
