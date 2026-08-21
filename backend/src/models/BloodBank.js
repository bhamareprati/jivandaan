'use strict';

const mongoose = require('mongoose');
const credentialsPlugin = require('./credentialsPlugin');
const env = require('../config/env');
const { BLOOD_GROUPS, ROLES, COLLECTIONS, VERIFICATION } = require('../config/constants');

/** Every bank starts with all eight keys present so the frontend matrix
 *  never has to cope with a missing blood group. */
function emptyInventory() {
  return new Map(BLOOD_GROUPS.map((g) => [g, 0]));
}

/** Doc 2 section 3.2, plus verification fields (D-4) and coordinates (D-5). */
const bloodBankSchema = new mongoose.Schema(
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
    role: { type: String, default: ROLES.BANK, immutable: true },

    address: { type: String, required: [true, 'address is required'], trim: true },
    city: { type: String, required: [true, 'city is required'], trim: true, index: true },
    state: { type: String, required: [true, 'state is required'], trim: true },
    pincode: { type: String, required: [true, 'pincode is required'], trim: true, index: true },

    location: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },

    /**
     * Denormalised live stock counts, keyed by blood group.
     *
     * The `donationhistories` ledger is the source of truth; this map is a
     * cache kept in step by services/inventory.js so the 8-group matrix is a
     * single-document read (plan decision D-6). inventoryService.reconcile()
     * rebuilds it from the ledger if they ever diverge.
     */
    inventory: {
      type: Map,
      of: { type: Number, min: 0 },
      default: emptyInventory,
    },

    lowStockThreshold: { type: Number, default: () => env.LOW_STOCK_THRESHOLD, min: 0 },

    /** Admin verification queue (Doc 2 section 4.5). */
    verificationStatus: {
      type: String,
      enum: Object.values(VERIFICATION),
      default: VERIFICATION.PENDING,
      index: true,
    },
    licenseNumber: { type: String, trim: true },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: COLLECTIONS.ADMINS },
    verifiedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true }
);

bloodBankSchema.plugin(credentialsPlugin);

bloodBankSchema.index({ location: '2dsphere' }, { sparse: true });

/** Backfill any group a manual write may have dropped. */
bloodBankSchema.pre('save', function fillInventory(next) {
  if (!this.inventory) this.inventory = emptyInventory();
  for (const g of BLOOD_GROUPS) {
    if (!this.inventory.has(g)) this.inventory.set(g, 0);
  }
  next();
});

bloodBankSchema.virtual('isVerified').get(function isVerified() {
  return this.verificationStatus === VERIFICATION.VERIFIED;
});

bloodBankSchema.virtual('totalUnits').get(function totalUnits() {
  if (!this.inventory) return 0;
  let sum = 0;
  for (const v of this.inventory.values()) sum += v || 0;
  return sum;
});

module.exports = mongoose.model(COLLECTIONS.BANKS, bloodBankSchema, COLLECTIONS.BANKS);
module.exports.emptyInventory = emptyInventory;
