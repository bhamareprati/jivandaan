'use strict';

/**
 * One naming convention throughout: every model is registered under its
 * COLLECTION name (`donors`, `blood-banks`, ...), which is the vocabulary Doc 2
 * already uses for ActivityLog.userModel.
 *
 * This matters because Mongoose resolves `refPath` against the *model* name.
 * BloodRequest.requesterModel stores `donors` or `hospitals` (plan decision
 * D-2), so populating a request would fail with MissingSchemaError if the
 * models were registered as `Donor` / `Hospital` instead.
 */

const { ROLES, COLLECTIONS } = require('../config/constants');

const Donor = require('./Donor');
const BloodBank = require('./BloodBank');
const Hospital = require('./Hospital');
const Admin = require('./Admin');
const BloodRequest = require('./BloodRequest');
const DonationHistory = require('./DonationHistory');
const ActivityLog = require('./ActivityLog');

/** role -> the model holding that role's credentials. */
const MODEL_BY_ROLE = {
  [ROLES.DONOR]: Donor,
  [ROLES.BANK]: BloodBank,
  [ROLES.HOSPITAL]: Hospital,
  [ROLES.ADMIN]: Admin,
};

/** collection name -> model, for resolving refPath / audit-log userModel. */
const MODEL_BY_COLLECTION = {
  [COLLECTIONS.DONORS]: Donor,
  [COLLECTIONS.BANKS]: BloodBank,
  [COLLECTIONS.HOSPITALS]: Hospital,
  [COLLECTIONS.ADMINS]: Admin,
};

/** Every collection that can hold credentials -- used for the cross-collection
 *  email uniqueness check (plan decision D-7). */
const IDENTITY_MODELS = [Donor, BloodBank, Hospital, Admin];

module.exports = {
  Donor,
  BloodBank,
  Hospital,
  Admin,
  BloodRequest,
  DonationHistory,
  ActivityLog,
  MODEL_BY_ROLE,
  MODEL_BY_COLLECTION,
  IDENTITY_MODELS,
};
