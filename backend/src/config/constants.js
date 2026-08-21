'use strict';

/**
 * Domain constants for Jivandan.
 *
 * The 56-day and 42-day figures read like constants but they are policy: regions
 * differ, and hunting them out of controllers later is expensive. They are
 * sourced from env (see config/env.js) and surfaced here for import.
 */

/** The eight blood groups. Single canonical list -- import it, never re-type it. */
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Roles. Doc 2 section 2: four roles. */
const ROLES = {
  DONOR: 'donor',
  BANK: 'blood-bank',
  HOSPITAL: 'hospital',
  ADMIN: 'admin',
};

/** Mongoose model name -> collection name, pinned so the pluraliser cannot drift. */
const COLLECTIONS = {
  DONORS: 'donors',
  BANKS: 'blood-banks',
  HOSPITALS: 'hospitals',
  ADMINS: 'admins',
  REQUESTS: 'bloodrequests',
  DONATIONS: 'donationhistories',
  LOGS: 'activitylogs',
};

/** Which collection holds the credentials for each role. */
const ROLE_COLLECTION = {
  [ROLES.DONOR]: COLLECTIONS.DONORS,
  [ROLES.BANK]: COLLECTIONS.BANKS,
  [ROLES.HOSPITAL]: COLLECTIONS.HOSPITALS,
  [ROLES.ADMIN]: COLLECTIONS.ADMINS,
};

const URGENCY = ['low', 'medium', 'high', 'critical'];

/** Sort weight for urgency, highest first. */
const URGENCY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * Request status.
 *
 * Doc 2 section 3.3 lists only pending/approved/rejected/fulfilled, but Doc 1's
 * tracker stepper and Doc 2 section 4.4's PATCH route both require `review` and
 * `dispatched`. The enum below is the reconciled set (plan decision D-1).
 */
const REQUEST_STATUS = {
  PENDING: 'pending',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  DISPATCHED: 'dispatched',
  FULFILLED: 'fulfilled',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

const REQUEST_STATUSES = Object.values(REQUEST_STATUS);

/** UI labels for the animated stepper (Doc 1 section 3). */
const STATUS_LABELS = {
  pending: 'Submitted',
  under_review: 'Review',
  approved: 'Approved',
  dispatched: 'Dispatched',
  fulfilled: 'Fulfilled',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** The happy-path stepper order, for rendering progress. */
const STATUS_FLOW = ['pending', 'under_review', 'approved', 'dispatched', 'fulfilled'];

const TERMINAL_STATUSES = ['fulfilled', 'rejected', 'cancelled'];

/** Ledger row lifecycle (plan decision D-6). */
const DONATION_STATUS = {
  AVAILABLE: 'available',
  RESERVED: 'reserved',
  USED: 'used',
  EXPIRED: 'expired',
};

const VERIFICATION = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
};

/** Audit log verbs. Keep this closed so the admin log stays filterable. */
const ACTIONS = {
  REGISTER: 'register',
  LOGIN: 'login',
  LOGOUT: 'logout',
  PASSWORD_RESET_REQUEST: 'password_reset_request',
  PASSWORD_RESET: 'password_reset',
  PROFILE_UPDATE: 'profile_update',
  INVENTORY_ADJUST: 'inventory_adjust',
  DONATION_CHECKIN: 'donation_checkin',
  INVENTORY_RECONCILE: 'inventory_reconcile',
  UNITS_EXPIRED: 'units_expired',
  REQUEST_CREATE: 'request_create',
  REQUEST_STATUS_CHANGE: 'request_status_change',
  BANK_VERIFY: 'bank_verify',
};

module.exports = {
  BLOOD_GROUPS,
  ROLES,
  COLLECTIONS,
  ROLE_COLLECTION,
  URGENCY,
  URGENCY_RANK,
  REQUEST_STATUS,
  REQUEST_STATUSES,
  STATUS_LABELS,
  STATUS_FLOW,
  TERMINAL_STATUSES,
  DONATION_STATUS,
  VERIFICATION,
  ACTIONS,
};
