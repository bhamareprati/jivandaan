'use strict';

const mongoose = require('mongoose');
const credentialsPlugin = require('./credentialsPlugin');
const { ROLES, COLLECTIONS } = require('../config/constants');

/**
 * Referenced by ActivityLog.userModel and by every /api/admin route, but never
 * specified in Doc 2 (plan decision D-3).
 *
 * Admins are seeded from ADMIN_EMAIL / ADMIN_PASSWORD -- POST /api/auth/register
 * refuses the admin role outright, so there is no path to self-promotion.
 */
const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'name is required'], trim: true, maxlength: 120 },
    email: {
      type: String,
      required: [true, 'email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    contact: { type: String, trim: true },
    role: { type: String, default: ROLES.ADMIN, immutable: true },
    isSuperAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

adminSchema.plugin(credentialsPlugin);

module.exports = mongoose.model(COLLECTIONS.ADMINS, adminSchema, COLLECTIONS.ADMINS);
