'use strict';

const {
  z,
  email,
  password,
  contact,
  name,
  bloodGroup,
  publicRole,
  anyRole,
  addressFields,
  dateString,
} = require('./common');
const { ROLES } = require('../config/constants');

/**
 * Registration is role-aware: the field set changes with `role`, which is why
 * this is a discriminated union rather than one schema full of optionals.
 * Doc 2 section 4.1.
 */
const donorRegister = z.object({
  role: z.literal(ROLES.DONOR),
  name,
  email,
  password,
  contact,
  dob: dateString.refine((d) => d < new Date(), { message: 'must be in the past' }),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']),
  bloodgroup: bloodGroup,
  profileImageUrl: z.string().url().optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(10).optional(),
  coordinates: addressFields.coordinates,
});

const bankRegister = z.object({
  role: z.literal(ROLES.BANK),
  name,
  email,
  password,
  contact,
  address: addressFields.address,
  city: addressFields.city,
  state: addressFields.state,
  pincode: addressFields.pincode,
  coordinates: addressFields.coordinates,
  licenseNumber: z.string().trim().min(3).max(60).optional(),
  lowStockThreshold: z.number().int().min(0).max(10000).optional(),
});

const hospitalRegister = z.object({
  role: z.literal(ROLES.HOSPITAL),
  name,
  email,
  password,
  contact,
  address: addressFields.address,
  city: addressFields.city,
  state: addressFields.state,
  pincode: addressFields.pincode,
  coordinates: addressFields.coordinates,
  registrationNumber: z.string().trim().min(3).max(60).optional(),
});

const register = {
  body: z.discriminatedUnion('role', [donorRegister, bankRegister, hospitalRegister]),
};

/**
 * `role` selects which collection to authenticate against.
 *
 * Each identity collection has its own unique index on email, so the same
 * address can legitimately exist as a donor and as a hospital; without the
 * role the server cannot know which record the caller means (plan decision D-7).
 * The login screen already has a role switcher, so this costs the user nothing.
 */
const login = {
  body: z.object({
    email,
    password: z.string().min(1, 'is required'),
    role: anyRole,
  }),
};

const forgotPassword = {
  body: z.object({ email, role: anyRole }),
};

const resetPassword = {
  body: z.object({
    token: z.string().min(32, 'is not a valid reset token'),
    role: anyRole,
    newPassword: password,
  }),
};

module.exports = { register, login, forgotPassword, resetPassword, publicRole };
