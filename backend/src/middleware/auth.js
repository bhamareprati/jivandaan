'use strict';

const jwtUtil = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { MODEL_BY_ROLE } = require('../models');
const { ROLE_COLLECTION } = require('../config/constants');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A request may authenticate two ways, and they have different threat models:
 *
 *   'header'  Authorization: Bearer <jwt>  -- immune to CSRF, because an
 *             attacker's page cannot read the token to send it.
 *   'session' the httpOnly session cookie  -- the browser attaches it
 *             automatically, so a cross-site form post would carry it too.
 */
function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return { token: header.slice(7).trim(), source: 'header' };
  }
  if (req.session && req.session.token) {
    return { token: req.session.token, source: 'session' };
  }
  return { token: null, source: null };
}

/**
 * CSRF guard for the cookie path.
 *
 * State-changing requests authenticated by cookie must carry a custom header.
 * A cross-site page cannot set one without triggering a CORS preflight, and the
 * allowlist in app.js refuses unknown origins -- so the attack never reaches
 * the handler. Bearer-authenticated requests skip this: they are not forgeable.
 *
 * This is what makes SameSite=None viable for a cross-origin deployment.
 */
function assertNotForged(req, source) {
  if (source !== 'session') return;
  if (SAFE_METHODS.has(req.method)) return;

  const marker = req.headers['x-requested-with'];
  if (marker !== 'XMLHttpRequest') {
    throw ApiError.forbidden(
      'Cookie-authenticated writes must send the X-Requested-With: XMLHttpRequest header'
    );
  }
}

/**
 * Verify the JWT, load the actor, attach req.user.
 *
 *   req.user = { id, role, model, doc }
 *
 * The actor is re-read from the database on every request so a deleted or
 * demoted account cannot keep operating on a token issued before the change.
 */
const requireAuth = asyncHandler(async (req, _res, next) => {
  const { token, source } = readToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required');

  assertNotForged(req, source);

  let payload;
  try {
    payload = jwtUtil.verify(token, 'auth');
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw ApiError.unauthorized('Session expired, please sign in again');
    throw ApiError.unauthorized('Invalid authentication token');
  }

  const Model = MODEL_BY_ROLE[payload.role];
  if (!Model) throw ApiError.unauthorized('Invalid authentication token');

  const doc = await Model.findById(payload.sub);
  if (!doc) throw ApiError.unauthorized('Account no longer exists');

  // A password change bumps tokenVersion, which revokes every token issued
  // before it. Compared exactly -- `iat` only has one-second resolution, so a
  // timestamp check cannot revoke a token reset within the same second.
  if ((payload.tv || 0) !== (doc.tokenVersion || 0)) {
    throw ApiError.unauthorized('Password was changed, please sign in again');
  }

  req.user = {
    id: String(doc._id),
    role: payload.role,
    model: ROLE_COLLECTION[payload.role],
    doc,
  };
  req.authSource = source;

  return next();
});

/** Attach req.user when a token is present, but never reject. For public
 *  routes whose response is richer for a signed-in caller. */
const optionalAuth = asyncHandler(async (req, _res, next) => {
  if (!readToken(req).token) return next();
  try {
    await new Promise((resolve, reject) => {
      requireAuth(req, _res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (_err) {
    req.user = undefined;
  }
  return next();
});

module.exports = { requireAuth, optionalAuth, readToken };
