'use strict';

const mongoose = require('mongoose');
const { COLLECTIONS, ACTIONS } = require('../config/constants');

/**
 * Doc 2 section 3.5. Append-only: there is deliberately no route that updates
 * or deletes an entry, which is the whole point of an audit log.
 *
 * userModel gains `hospitals` alongside Doc 2's three (plan decision D-2).
 */
const activityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userModel: {
      type: String,
      required: true,
      enum: [COLLECTIONS.DONORS, COLLECTIONS.BANKS, COLLECTIONS.HOSPITALS, COLLECTIONS.ADMINS],
    },

    action: { type: String, required: true, enum: Object.values(ACTIONS), index: true },
    description: { type: String, trim: true, maxlength: 500 },

    targetUser: { type: mongoose.Schema.Types.ObjectId },
    targetModel: {
      type: String,
      enum: [
        COLLECTIONS.DONORS,
        COLLECTIONS.BANKS,
        COLLECTIONS.HOSPITALS,
        COLLECTIONS.ADMINS,
        COLLECTIONS.REQUESTS,
        COLLECTIONS.DONATIONS,
      ],
    },

    metadata: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model(COLLECTIONS.LOGS, activityLogSchema, COLLECTIONS.LOGS);
