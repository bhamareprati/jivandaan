'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { fail } = require('../utils/apiResponse');

/**
 * Rate limiting (Doc 2 Phase B5).
 *
 * Auth and request-creation are the two routes worth protecting: one is the
 * credential-stuffing surface, the other can flood every donor's phone.
 * Disabled under NODE_ENV=test so the suite is not throttled by its own speed.
 */

function handler(_req, res) {
  return fail(res, 429, 'Too many requests, please try again later');
}

function make({ windowMs, max, keyGenerator }) {
  if (!env.RATE_LIMIT_ENABLED) {
    return function passthrough(_req, _res, next) {
      next();
    };
  }
  return rateLimit({
    windowMs,
    max,
    handler,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
  });
}

/** 10 attempts / 15 min per IP. */
const authLimiter = make({ windowMs: 15 * 60 * 1000, max: env.RATE_AUTH_MAX });

/** 20 requests / hour per account (falls back to IP when unauthenticated). */
const createRequestLimiter = make({
  windowMs: 60 * 60 * 1000,
  max: env.RATE_REQUEST_MAX,
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : `ip:${req.ip}`),
});

/** 300 / 15 min blanket default. */
const globalLimiter = make({ windowMs: 15 * 60 * 1000, max: env.RATE_GLOBAL_MAX });

module.exports = { authLimiter, createRequestLimiter, globalLimiter };
