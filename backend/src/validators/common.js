'use strict';

const { z } = require('zod');
const {
  BLOOD_GROUPS,
  URGENCY,
  REQUEST_STATUSES,
  ROLES,
} = require('../config/constants');

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const idParam = z.object({ id: objectId });

const bloodGroup = z.enum(BLOOD_GROUPS);
const urgency = z.enum(URGENCY);
const requestStatus = z.enum(REQUEST_STATUSES);

const email = z.string().trim().toLowerCase().email('must be a valid email address');

const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(128, 'must be at most 128 characters');

const contact = z
  .string()
  .trim()
  .min(7, 'must be at least 7 digits')
  .max(20, 'must be at most 20 characters')
  .regex(/^[+0-9\s-()]+$/, 'may only contain digits and + - ( ) characters');

const name = z.string().trim().min(2, 'must be at least 2 characters').max(160);

/** Registerable roles. Admin is seeded, never registered (plan decision D-3). */
const publicRole = z.enum([ROLES.DONOR, ROLES.BANK, ROLES.HOSPITAL]);
const anyRole = z.enum([ROLES.DONOR, ROLES.BANK, ROLES.HOSPITAL, ROLES.ADMIN]);

/** Coerced from a query string, so `?page=2` arrives as a number. */
const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** [longitude, latitude] -- GeoJSON order, which is the reverse of how people say it. */
const coordinates = z
  .tuple([
    z.number().min(-180, 'longitude must be between -180 and 180').max(180),
    z.number().min(-90, 'latitude must be between -90 and 90').max(90),
  ])
  .optional();

const addressFields = {
  address: z.string().trim().min(4).max(300),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().trim().regex(/^[0-9]{4,10}$/, 'must be 4-10 digits'),
  coordinates,
};

const dateString = z.coerce.date();

module.exports = {
  z,
  objectId,
  idParam,
  bloodGroup,
  urgency,
  requestStatus,
  email,
  password,
  contact,
  name,
  publicRole,
  anyRole,
  pagination,
  coordinates,
  addressFields,
  dateString,
};
