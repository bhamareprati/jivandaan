'use strict';

const bcrypt = require('bcryptjs');
const env = require('../config/env');

/**
 * Shared behaviour for every collection that holds credentials
 * (donors, blood-banks, hospitals, admins).
 *
 *  - password is hashed on create and on change, never twice
 *  - password and reset fields never serialise
 *  - comparePassword() for login
 *  - single-use, expiring password-reset token fields
 */
module.exports = function credentialsPlugin(schema) {
  schema.add({
    password: { type: String, required: [true, 'password is required'], minlength: 8, select: false },
    passwordChangedAt: { type: Date, select: false },
    /**
     * Bumped on every password change; the value is stamped into each issued
     * JWT so a change revokes every token that came before it.
     *
     * A timestamp comparison cannot do this reliably: JWT `iat` has one-second
     * granularity, so a token issued and a password changed within the same
     * second are indistinguishable. An explicit counter has no such ambiguity.
     */
    tokenVersion: { type: Number, default: 0 },
    resetTokenHash: { type: String, select: false },
    resetTokenExpiresAt: { type: Date, select: false },
    lastLoginAt: { type: Date },
  });

  schema.pre('save', async function hashPassword(next) {
    if (!this.isModified('password')) return next();
    try {
      // Guard against a caller assigning an already-hashed value.
      if (/^\$2[aby]\$\d{2}\$/.test(this.password)) return next();
      this.password = await bcrypt.hash(this.password, env.BCRYPT_ROUNDS);
      if (!this.isNew) {
        this.passwordChangedAt = new Date();
        this.tokenVersion = (this.tokenVersion || 0) + 1;
      }
      return next();
    } catch (err) {
      return next(err);
    }
  });

  schema.methods.comparePassword = function comparePassword(plain) {
    if (!this.password) {
      throw new Error(
        'comparePassword called on a document loaded without the password field. ' +
          'Use .select("+password").'
      );
    }
    return bcrypt.compare(plain, this.password);
  };

  schema.methods.clearResetToken = function clearResetToken() {
    this.resetTokenHash = undefined;
    this.resetTokenExpiresAt = undefined;
  };

  const hide = ['password', 'passwordChangedAt', 'tokenVersion', 'resetTokenHash', 'resetTokenExpiresAt', '__v'];

  function strip(_doc, ret) {
    for (const f of hide) delete ret[f];
    return ret;
  }

  schema.set('toJSON', { virtuals: true, transform: strip });
  schema.set('toObject', { virtuals: true, transform: strip });
};
