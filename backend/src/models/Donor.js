'use strict';

const mongoose = require('mongoose');
const credentialsPlugin = require('./credentialsPlugin');
const env = require('../config/env');
const { BLOOD_GROUPS, ROLES, COLLECTIONS } = require('../config/constants');
const { addDays, daysBetweenUTC } = require('../utils/dates');

/** Doc 2 section 3.1. */
const donorSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'name is required'], trim: true, maxlength: 120 },
    dob: { type: Date, required: [true, 'dob is required'] },
    gender: {
      type: String,
      required: [true, 'gender is required'],
      enum: ['male', 'female', 'other', 'prefer_not_to_say'],
    },
    bloodgroup: {
      type: String,
      required: [true, 'bloodgroup is required'],
      enum: { values: BLOOD_GROUPS, message: '{VALUE} is not one of the eight blood groups' },
    },
    contact: { type: String, required: [true, 'contact is required'], trim: true },
    email: {
      type: String,
      required: [true, 'email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    role: { type: String, default: ROLES.DONOR, immutable: true },
    profileImageUrl: { type: String },

    /** Drives the 56-day eligibility calculation (Doc 2 section 5.3). */
    lastDonationDate: { type: Date, default: null },

    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },

    /**
     * Optional coordinates so the donor feed can be distance-filtered
     * (plan decision D-5). `coordinates` is [longitude, latitude].
     */
    location: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },
  },
  { timestamps: true }
);

donorSchema.plugin(credentialsPlugin);

donorSchema.index({ location: '2dsphere' }, { sparse: true });
donorSchema.index({ bloodgroup: 1, city: 1 });

/** Doc 2 section 5: the `age` virtual, derived from dob. */
donorSchema.virtual('age').get(function age() {
  if (!this.dob) return null;
  const now = new Date();
  let years = now.getUTCFullYear() - this.dob.getUTCFullYear();
  const m = now.getUTCMonth() - this.dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < this.dob.getUTCDate())) years -= 1;
  return years;
});

/** Next date this donor may donate. Null when they have never donated. */
donorSchema.virtual('nextEligibleDate').get(function nextEligibleDate() {
  if (!this.lastDonationDate) return null;
  return addDays(this.lastDonationDate, env.DONATION_INTERVAL_DAYS);
});

donorSchema.virtual('isEligible').get(function isEligible() {
  const next = this.nextEligibleDate;
  if (!next) return true;
  return daysBetweenUTC(new Date(), next) <= 0;
});

donorSchema.virtual('daysUntilEligible').get(function daysUntilEligible() {
  const next = this.nextEligibleDate;
  if (!next) return 0;
  return Math.max(0, daysBetweenUTC(new Date(), next));
});

module.exports = mongoose.model(COLLECTIONS.DONORS, donorSchema, COLLECTIONS.DONORS);
