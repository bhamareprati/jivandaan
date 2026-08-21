'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const jwtUtil = require('../utils/jwt');
const env = require('../config/env');
const { MODEL_BY_ROLE, IDENTITY_MODELS } = require('../models');
const { ROLES, ROLE_COLLECTION, ACTIONS } = require('../config/constants');
const activityLogger = require('../services/activityLogger');
const notification = require('../services/notification');
const eligibility = require('../services/eligibility');

/**
 * Auth (Doc 2 section 4.1).
 *
 * Four collections hold credentials, each with its own unique index on email.
 * That makes uniqueness per-collection only, so registration checks every
 * collection and login takes an explicit `role` (plan decision D-7).
 */

/** Reject an email already used by ANY role. */
async function assertEmailFree(email) {
  const hits = await Promise.all(
    IDENTITY_MODELS.map((Model) => Model.exists({ email }).then((r) => (r ? Model.modelName : null)))
  );
  const taken = hits.find(Boolean);
  if (taken) {
    throw ApiError.conflict('That email is already registered', [
      { field: 'email', message: 'already in use' },
    ]);
  }
}

/** GeoJSON point, or undefined when no coordinates were supplied. */
function toPoint(coordinates) {
  if (!coordinates || coordinates.length !== 2) return undefined;
  return { type: 'Point', coordinates };
}

function publicUser(doc, role) {
  const json = doc.toJSON();
  json.role = role;
  return json;
}

function issueSession(req, doc, role) {
  const token = jwtUtil.signAuthToken({
    id: doc._id,
    role,
    model: ROLE_COLLECTION[role],
    tokenVersion: doc.tokenVersion || 0,
  });
  if (req.session) {
    req.session.token = token;
    req.session.userId = String(doc._id);
    req.session.role = role;
  }
  return token;
}

/* --------------------------------------------------------------- register */

const register = asyncHandler(async (req, res) => {
  const { role, coordinates, ...rest } = req.body;

  // Admin accounts are seeded from env, never self-registered.
  if (role === ROLES.ADMIN) {
    throw ApiError.forbidden('Admin accounts cannot be registered through this endpoint');
  }

  const Model = MODEL_BY_ROLE[role];
  if (!Model) throw ApiError.badRequest(`Unknown role: ${role}`);

  await assertEmailFree(rest.email);

  const payload = { ...rest };
  const point = toPoint(coordinates);
  if (point) payload.location = point;

  const doc = await Model.create(payload);
  const token = issueSession(req, doc, role);

  await activityLogger.log({
    actor: { user: doc._id, userModel: ROLE_COLLECTION[role] },
    req,
    action: ACTIONS.REGISTER,
    description: `Registered as ${role}`,
    targetUser: doc._id,
    targetModel: ROLE_COLLECTION[role],
    metadata: { role, email: doc.email },
  });

  return created(
    res,
    { token, role, user: publicUser(doc, role) },
    'Registration successful'
  );
});

/* ------------------------------------------------------------------ login */

const login = asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;

  const Model = MODEL_BY_ROLE[role];
  if (!Model) throw ApiError.badRequest(`Unknown role: ${role}`);

  const doc = await Model.findOne({ email }).select('+password +passwordChangedAt +tokenVersion');

  // One message for both "no such account" and "wrong password", so the
  // endpoint cannot be used to enumerate registered addresses.
  const invalid = ApiError.unauthorized('Invalid credentials');
  if (!doc) throw invalid;

  const matches = await doc.comparePassword(password);
  if (!matches) throw invalid;

  doc.lastLoginAt = new Date();
  await doc.save({ validateBeforeSave: false });

  const token = issueSession(req, doc, role);

  await activityLogger.log({
    actor: { user: doc._id, userModel: ROLE_COLLECTION[role] },
    req,
    action: ACTIONS.LOGIN,
    description: `Signed in as ${role}`,
    targetUser: doc._id,
    targetModel: ROLE_COLLECTION[role],
    metadata: { role },
  });

  return ok(res, { token, role, user: publicUser(doc, role) }, 'Signed in');
});

/* ----------------------------------------------------------------- logout */

const logout = asyncHandler(async (req, res) => {
  if (req.user) {
    await activityLogger.log({
      req,
      action: ACTIONS.LOGOUT,
      description: 'Signed out',
      targetUser: req.user.id,
      targetModel: req.user.model,
    });
  }

  if (req.session) {
    await new Promise((resolve) => req.session.destroy(resolve));
    res.clearCookie('jivandan.sid');
  }

  return ok(res, null, 'Signed out');
});

/* --------------------------------------------------------- password reset */

/**
 * Issue a reset token (plan decision D-11).
 *
 * Always answers 200 regardless of whether the account exists -- otherwise
 * this endpoint becomes an account-enumeration oracle.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email, role } = req.body;
  const Model = MODEL_BY_ROLE[role];
  if (!Model) throw ApiError.badRequest(`Unknown role: ${role}`);

  const doc = await Model.findOne({ email });

  if (doc) {
    const { plain, hash } = jwtUtil.makeResetToken();
    doc.resetTokenHash = hash;
    doc.resetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await doc.save({ validateBeforeSave: false });

    await notification.onPasswordReset(doc.email, plain, role);

    await activityLogger.log({
      actor: { user: doc._id, userModel: ROLE_COLLECTION[role] },
      req,
      action: ACTIONS.PASSWORD_RESET_REQUEST,
      description: 'Requested a password reset',
      targetUser: doc._id,
      targetModel: ROLE_COLLECTION[role],
    });

    // Development convenience: surface the token so the flow is testable
    // without a mail provider wired up. Never in production.
    if (!env.isProd) {
      return ok(res, { resetToken: plain }, 'If that account exists, a reset link has been sent');
    }
  }

  return ok(res, null, 'If that account exists, a reset link has been sent');
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword, role } = req.body;
  const Model = MODEL_BY_ROLE[role];
  if (!Model) throw ApiError.badRequest(`Unknown role: ${role}`);

  const doc = await Model.findOne({
    resetTokenHash: jwtUtil.hashResetToken(token),
    resetTokenExpiresAt: { $gt: new Date() },
  }).select('+password +resetTokenHash +resetTokenExpiresAt');

  if (!doc) throw ApiError.unprocessable('That reset token is invalid or has expired');

  doc.password = newPassword;
  doc.clearResetToken();
  await doc.save();

  await activityLogger.log({
    actor: { user: doc._id, userModel: ROLE_COLLECTION[role] },
    req,
    action: ACTIONS.PASSWORD_RESET,
    description: 'Completed a password reset',
    targetUser: doc._id,
    targetModel: ROLE_COLLECTION[role],
  });

  return ok(res, null, 'Password updated, please sign in');
});

/* --------------------------------------------------------------------- me */

const me = asyncHandler(async (req, res) => {
  const payload = { role: req.user.role, user: publicUser(req.user.doc, req.user.role) };
  if (req.user.role === ROLES.DONOR) {
    payload.eligibility = eligibility.forDonor(req.user.doc);
  }
  return ok(res, payload);
});

module.exports = { register, login, logout, forgotPassword, resetPassword, me, assertEmailFree };
