'use strict';

const mongoose = require('mongoose');
const env = require('../config/env');
const { BLOOD_GROUPS, COLLECTIONS, DONATION_STATUS } = require('../config/constants');
const { addDays, daysBetweenUTC } = require('../utils/dates');

/**
 * Doc 2 section 3.4, extended with a lifecycle (plan decision D-6).
 *
 * This collection is the source of truth for stock. Each row is a batch of
 * units with its own expiry date; BloodBank.inventory is a denormalised sum
 * kept in step by services/inventory.js. Without `status` and `unitsRemaining`
 * the expiry radar could flag a unit while the inventory map went on counting
 * it forever.
 */
const donationHistorySchema = new mongoose.Schema(
  {
    donor: { type: mongoose.Schema.Types.ObjectId, ref: COLLECTIONS.DONORS, required: true, index: true },
    bloodBank: { type: mongoose.Schema.Types.ObjectId, ref: COLLECTIONS.BANKS, required: true, index: true },
    bloodGroup: { type: String, required: true, enum: BLOOD_GROUPS },

    units: { type: Number, required: true, min: 1 },
    unitsRemaining: { type: Number, min: 0 },

    donationDate: { type: Date, required: true, default: Date.now },
    /** Auto-calculated: donationDate + 42 days (Doc 2 section 3.4). */
    expiryDate: { type: Date },

    status: {
      type: String,
      enum: Object.values(DONATION_STATUS),
      default: DONATION_STATUS.AVAILABLE,
      index: true,
    },
    consumedByRequest: { type: mongoose.Schema.Types.ObjectId, ref: COLLECTIONS.REQUESTS },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/** Drives the expiry radar and FEFO consumption. */
donationHistorySchema.index({ bloodBank: 1, status: 1, expiryDate: 1 });
donationHistorySchema.index({ bloodBank: 1, bloodGroup: 1, status: 1, expiryDate: 1 });
donationHistorySchema.index({ donor: 1, donationDate: -1 });

donationHistorySchema.pre('validate', function derive(next) {
  if (!this.donationDate) this.donationDate = new Date();
  if (!this.expiryDate) {
    this.expiryDate = addDays(this.donationDate, env.UNIT_SHELF_LIFE_DAYS);
  }
  if (this.unitsRemaining === undefined || this.unitsRemaining === null) {
    this.unitsRemaining = this.units;
  }
  next();
});

donationHistorySchema.virtual('daysToExpiry').get(function daysToExpiry() {
  if (!this.expiryDate) return null;
  return daysBetweenUTC(new Date(), this.expiryDate);
});

donationHistorySchema.virtual('isExpired').get(function isExpired() {
  if (!this.expiryDate) return false;
  return this.expiryDate.getTime() <= Date.now();
});

module.exports = mongoose.model(COLLECTIONS.DONATIONS, donationHistorySchema, COLLECTIONS.DONATIONS);
