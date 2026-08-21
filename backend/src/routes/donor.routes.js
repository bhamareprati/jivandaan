'use strict';

const express = require('express');
const ctrl = require('../controllers/donor.controller');
const validate = require('../middleware/validate');
const v = require('../validators/domain.validators');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { ROLES } = require('../config/constants');

const router = express.Router();

// Doc 2 section 4.2. Every route here is the signed-in donor's own record --
// there is no /api/donors/:id, so one donor cannot read another by guessing.
router.use(requireAuth, requireRole(ROLES.DONOR));

router.get('/me', ctrl.getMe);
router.patch('/me', validate(v.updateMe), ctrl.updateMe);
router.get('/me/pass', ctrl.getPass);
router.get('/feed', validate(v.donorFeed), ctrl.getFeed);

module.exports = router;
