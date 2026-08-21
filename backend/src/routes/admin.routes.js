'use strict';

const express = require('express');
const ctrl = require('../controllers/admin.controller');
const validate = require('../middleware/validate');
const v = require('../validators/domain.validators');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { ROLES } = require('../config/constants');

const router = express.Router();

// Doc 2 section 4.5. Everything below is admin-only.
router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/metrics', ctrl.getMetrics);
router.get('/banks/pending', validate(v.listPending), ctrl.listPendingBanks);
router.patch('/banks/:id/verify', validate(v.verifyBank), ctrl.verifyBank);

// Read-only by design: no PATCH or DELETE exists for an audit log entry.
router.get('/logs', validate(v.listLogs), ctrl.listLogs);

module.exports = router;
