'use strict';

const {
  z,
  objectId,
  idParam,
  bloodGroup,
  urgency,
  requestStatus,
  contact,
  name,
  pagination,
  coordinates,
  dateString,
} = require('./common');
const { BLOOD_GROUPS } = require('../config/constants');

/* ------------------------------------------------------------------ donor */

const updateMe = {
  body: z
    .object({
      name: name.optional(),
      contact: contact.optional(),
      profileImageUrl: z.string().url().optional(),
      city: z.string().trim().max(80).optional(),
      state: z.string().trim().max(80).optional(),
      pincode: z.string().trim().max(10).optional(),
      coordinates,
    })
    // Email, password and role are deliberately absent: changing them goes
    // through the auth routes, which log and re-authenticate.
    .strict()
    .refine((o) => Object.keys(o).length > 0, { message: 'No updatable fields supplied' }),
};

const donorFeed = {
  query: pagination.extend({
    city: z.string().trim().max(80).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: z.coerce.number().int().min(100).max(200000).optional(),
    urgency: urgency.optional(),
  }),
};

/* ------------------------------------------------------------------- bank */

const inventoryPatch = {
  params: idParam,
  body: z.object({
    inventory: z
      .record(z.enum(BLOOD_GROUPS), z.number().int().min(0).max(100000))
      .refine((o) => Object.keys(o).length > 0, { message: 'at least one blood group is required' }),
    reason: z.string().trim().max(300).optional(),
  }),
};

const checkin = {
  params: idParam,
  body: z
    .object({
      passToken: z.string().min(20).optional(),
      donorId: objectId.optional(),
      units: z.coerce.number().int().min(1).max(10).default(1),
      donationDate: dateString.optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .refine((o) => Boolean(o.passToken || o.donorId), {
      message: 'Either passToken (from the QR scan) or donorId is required',
      path: ['passToken'],
    }),
};

const expiryRadar = {
  params: idParam,
  query: z.object({
    windowDays: z.coerce.number().int().min(1).max(42).optional(),
  }),
};

/** Geospatial search (plan decision D-5). Radius is in metres. */
const bankSearch = {
  query: pagination
    .extend({
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      radius: z.coerce.number().int().min(100).max(200000).default(10000),
      city: z.string().trim().max(80).optional(),
      pincode: z.string().trim().max(10).optional(),
      bloodGroup: bloodGroup.optional(),
      minUnits: z.coerce.number().int().min(1).optional(),
    })
    .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
      message: 'lat and lng must be supplied together',
      path: ['lat'],
    }),
};

/* ---------------------------------------------------------------- request */

const createRequest = {
  body: z.object({
    bloodGroup,
    units: z.coerce.number().int().min(1, 'must be at least 1').max(50),
    urgency,
    bloodBank: objectId.optional(),
    patientName: z.string().trim().max(120).optional(),
    hospitalName: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(1000).optional(),
    requiredBy: dateString.optional(),
  }),
};

const patchStatus = {
  params: idParam,
  body: z.object({
    status: requestStatus,
    note: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(500).optional(),
    /** Which group to draw from when substituting for an out-of-stock exact match. */
    fulfillFromGroup: bloodGroup.optional(),
  }),
};

const listRequests = {
  query: pagination.extend({
    urgency: urgency.optional(),
    status: requestStatus.optional(),
    bank: objectId.optional(),
    bloodGroup: bloodGroup.optional(),
    mine: z.coerce.boolean().optional(),
  }),
};

const matchGroup = {
  params: z.object({ bloodGroup }),
  query: z.object({
    bankId: objectId.optional(),
    units: z.coerce.number().int().min(1).max(50).default(1),
  }),
};

/* ------------------------------------------------------------------ admin */

const verifyBank = {
  params: idParam,
  body: z
    .object({
      action: z.enum(['approve', 'reject']),
      reason: z.string().trim().max(500).optional(),
    })
    .refine((o) => o.action !== 'reject' || Boolean(o.reason), {
      message: 'A reason is required when rejecting a blood bank',
      path: ['reason'],
    }),
};

const listLogs = {
  query: pagination.extend({
    user: objectId.optional(),
    action: z.string().trim().max(60).optional(),
    from: dateString.optional(),
    to: dateString.optional(),
  }),
};

const listPending = { query: pagination };

module.exports = {
  updateMe,
  donorFeed,
  inventoryPatch,
  checkin,
  expiryRadar,
  bankSearch,
  createRequest,
  patchStatus,
  listRequests,
  matchGroup,
  verifyBank,
  listLogs,
  listPending,
  idParam: { params: idParam },
  pagingOnly: { query: pagination },
};
