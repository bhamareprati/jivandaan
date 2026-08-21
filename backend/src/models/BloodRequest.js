'use strict';

const mongoose = require('mongoose');
const {
  BLOOD_GROUPS,
  COLLECTIONS,
  URGENCY,
  URGENCY_RANK,
  REQUEST_STATUS,
  REQUEST_STATUSES,
  STATUS_LABELS,
  STATUS_FLOW,
  TERMINAL_STATUSES,
} = require('../config/constants');

/** One entry per status change, so the tracker stepper can show real timestamps. */
const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, enum: REQUEST_STATUSES, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId },
    changedByModel: {
      type: String,
      enum: [COLLECTIONS.DONORS, COLLECTIONS.HOSPITALS, COLLECTIONS.BANKS, COLLECTIONS.ADMINS],
    },
    note: { type: String, trim: true, maxlength: 500 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/** Doc 2 section 3.3, with the reconciled status enum (D-1) and a dynamic requester (D-2). */
const bloodRequestSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'requester is required'],
      refPath: 'requesterModel',
    },
    requesterModel: {
      type: String,
      required: true,
      enum: [COLLECTIONS.DONORS, COLLECTIONS.HOSPITALS],
    },

    bloodBank: { type: mongoose.Schema.Types.ObjectId, ref: COLLECTIONS.BANKS, default: null },

    bloodGroup: {
      type: String,
      required: [true, 'bloodGroup is required'],
      enum: { values: BLOOD_GROUPS, message: '{VALUE} is not one of the eight blood groups' },
    },
    units: { type: Number, required: [true, 'units is required'], min: [1, 'units must be at least 1'] },
    urgency: { type: String, required: true, enum: URGENCY, default: 'medium' },

    patientName: { type: String, trim: true, maxlength: 120 },
    hospitalName: { type: String, trim: true, maxlength: 160 },
    notes: { type: String, trim: true, maxlength: 1000 },
    requiredBy: { type: Date },

    status: { type: String, enum: REQUEST_STATUSES, default: REQUEST_STATUS.PENDING, index: true },
    statusHistory: { type: [statusEventSchema], default: [] },

    fulfilledAt: { type: Date },
    rejectionReason: { type: String, trim: true },

    /** Which ledger rows paid for this request, recorded at fulfilment. */
    consumedFrom: [
      {
        donation: { type: mongoose.Schema.Types.ObjectId, ref: COLLECTIONS.DONATIONS },
        bloodGroup: { type: String, enum: BLOOD_GROUPS },
        units: { type: Number, min: 1 },
        _id: false,
      },
    ],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

bloodRequestSchema.index({ status: 1, urgency: 1, createdAt: -1 });
bloodRequestSchema.index({ bloodBank: 1, status: 1 });
bloodRequestSchema.index({ bloodGroup: 1, status: 1 });
bloodRequestSchema.index({ requester: 1, createdAt: -1 });

/** Seed the history with the opening state so the stepper always has step one. */
bloodRequestSchema.pre('save', function seedHistory(next) {
  if (this.isNew && this.statusHistory.length === 0) {
    this.statusHistory.push({ status: this.status, at: new Date() });
  }
  next();
});

bloodRequestSchema.virtual('statusLabel').get(function statusLabel() {
  return STATUS_LABELS[this.status] || this.status;
});

bloodRequestSchema.virtual('isTerminal').get(function isTerminal() {
  return TERMINAL_STATUSES.includes(this.status);
});

/** Zero-based index into the happy-path stepper; -1 for rejected/cancelled. */
bloodRequestSchema.virtual('stepIndex').get(function stepIndex() {
  return STATUS_FLOW.indexOf(this.status);
});

bloodRequestSchema.virtual('urgencyRank').get(function urgencyRank() {
  return URGENCY_RANK[this.urgency] || 0;
});

module.exports = mongoose.model(COLLECTIONS.REQUESTS, bloodRequestSchema, COLLECTIONS.REQUESTS);
