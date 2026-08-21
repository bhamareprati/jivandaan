'use strict';

const mongoose = require('mongoose');
const credentialsPlugin = require('./credentialsPlugin');
const { ROLES, COLLECTIONS, VERIFICATION } = require('../config/constants');

/**
 * Doc 2 names four roles including hospital/requester but defines no collection
 * for it, and points BloodRequest.requester at `donors` only. This model plus
 * the refPath on BloodRequest is plan decision D-2.
 */
const hospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'name is required'], trim: true, maxlength: 160 },
    email: {
      type: String,
      required: [true, 'email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    contact: { type: String, required: [true, 'contact is required'], trim: true },
    role: { type: String, default: ROLES.HOSPITAL, immutable: true },

    address: { type: String, required: [true, 'address is required'], trim: true },
    city: { type: String, required: [true, 'city is required'], trim: true, index: true },
    state: { type: String, required: [true, 'state is required'], trim: true },
    pincode: { type: String, required: [true, 'pincode is required'], trim: true },

    location: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },

    registrationNumber: { type: String, trim: true },
    verificationStatus: {
      type: String,
      enum: Object.values(VERIFICATION),
      default: VERIFICATION.PENDING,
      index: true,
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: COLLECTIONS.ADMINS },
    verifiedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true }
);

hospitalSchema.plugin(credentialsPlugin);
hospitalSchema.index({ location: '2dsphere' }, { sparse: true });

module.exports = mongoose.model(COLLECTIONS.HOSPITALS, hospitalSchema, COLLECTIONS.HOSPITALS);
