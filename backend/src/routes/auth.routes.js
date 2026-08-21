'use strict';

const express = require('express');
const ctrl = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const schemas = require('../validators/auth.validators');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Doc 2 section 4.1. Rate-limited: this is the credential-stuffing surface.
router.post('/register', authLimiter, validate(schemas.register), ctrl.register);
router.post('/login', authLimiter, validate(schemas.login), ctrl.login);
router.post('/logout', optionalAuth, ctrl.logout);
router.post('/forgot-password', authLimiter, validate(schemas.forgotPassword), ctrl.forgotPassword);
router.post('/reset-password', authLimiter, validate(schemas.resetPassword), ctrl.resetPassword);

router.get('/me', requireAuth, ctrl.me);

module.exports = router;
