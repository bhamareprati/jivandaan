'use strict';

const express = require('express');
const pkg = require('../../package.json');
const db = require('../config/db');
const env = require('../config/env');
const { ok } = require('../utils/apiResponse');

const authRoutes = require('./auth.routes');
const donorRoutes = require('./donor.routes');
const bankRoutes = require('./bank.routes');
const requestRoutes = require('./request.routes');
const adminRoutes = require('./admin.routes');

const router = express.Router();

/** GET /api/health -- Doc 2 section 5. Public, and used by platform probes. */
router.get('/health', (_req, res) =>
  ok(res, {
    status: db.isConnected() ? 'ok' : 'degraded',
    version: pkg.version,
    env: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    db: db.stateLabel(),
    timestamp: new Date().toISOString(),
  })
);

router.use('/auth', authRoutes);
router.use('/donors', donorRoutes);
router.use('/banks', bankRoutes);
router.use('/requests', requestRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
