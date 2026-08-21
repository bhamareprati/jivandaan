'use strict';

const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { BloodBank } = require('../models');
const { ROLES, VERIFICATION } = require('../config/constants');

/**
 * Role-based access control (Doc 2 section 2).
 *
 * requireAuth must run first -- these all read req.user.
 */

/** requireRole('admin'), requireRole('blood-bank', 'admin') */
function requireRole(...roles) {
  const allowed = roles.flat();
  return function roleGuard(req, _res, next) {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    if (!allowed.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `This action requires the ${allowed.join(' or ')} role; you are signed in as ${req.user.role}`
        )
      );
    }
    return next();
  };
}

/**
 * The caller must be the account named by :param -- or an admin.
 * Stops donor A from reading donor B through a guessed id.
 */
function requireSelf(param = 'id') {
  return function selfGuard(req, _res, next) {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    if (req.user.role === ROLES.ADMIN) return next();
    if (String(req.params[param]) !== req.user.id) {
      return next(ApiError.forbidden('You may only access your own record'));
    }
    return next();
  };
}

/**
 * The caller must own the bank named by :param -- or be an admin.
 * Guards inventory writes and check-ins.
 */
function requireBankOwner(param = 'id') {
  return function bankOwnerGuard(req, _res, next) {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    if (req.user.role === ROLES.ADMIN) return next();
    if (req.user.role !== ROLES.BANK) {
      return next(ApiError.forbidden('This action requires the blood-bank role'));
    }
    if (String(req.params[param]) !== req.user.id) {
      return next(ApiError.forbidden('You may only manage your own blood bank'));
    }
    return next();
  };
}

/**
 * An unverified bank may sign in and complete its profile, but may not trade:
 * no approving requests, no appearing in search (plan decision D-4).
 */
const requireVerifiedBank = asyncHandler(async (req, _res, next) => {
  if (!req.user) throw ApiError.unauthorized('Authentication required');
  if (req.user.role === ROLES.ADMIN) return next();

  let bank = null;
  if (req.user.role === ROLES.BANK) {
    bank = req.user.doc;
  } else if (req.params.id) {
    bank = await BloodBank.findById(req.params.id);
  }

  if (!bank) throw ApiError.notFound('Blood bank not found');

  if (bank.verificationStatus !== VERIFICATION.VERIFIED) {
    throw ApiError.forbidden(
      bank.verificationStatus === VERIFICATION.REJECTED
        ? 'This blood bank\'s verification was rejected'
        : 'This blood bank is awaiting admin verification'
    );
  }

  return next();
});

module.exports = { requireRole, requireSelf, requireBankOwner, requireVerifiedBank };
