'use strict';

const express = require('express');
const ctrl = require('../controllers/request.controller');
const validate = require('../middleware/validate');
const v = require('../validators/domain.validators');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { createRequestLimiter } = require('../middleware/rateLimit');
const { ROLES } = require('../config/constants');

const router = express.Router();

router.use(requireAuth);

// Doc 2 section 4.4.

// Static segments first, so "match" is never captured as an :id.
router.get('/match/:bloodGroup', validate(v.matchGroup), ctrl.matchGroup);

router.get('/', validate(v.listRequests), ctrl.listRequests);

router.post(
  '/',
  requireRole(ROLES.DONOR, ROLES.HOSPITAL),
  createRequestLimiter,
  validate(v.createRequest),
  ctrl.createRequest
);

router.get('/:id', validate(v.idParam), ctrl.getRequest);

// Authorisation for the specific transition lives in the state machine
// (services/requestLifecycle.js); this only gates who may attempt one.
router.patch(
  '/:id/status',
  requireRole(ROLES.BANK, ROLES.ADMIN, ROLES.DONOR, ROLES.HOSPITAL),
  validate(v.patchStatus),
  ctrl.patchStatus
);

module.exports = router;
