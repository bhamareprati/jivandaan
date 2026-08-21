'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ISSUER = 'jivandan';

/**
 * Session token for API auth. Payload: { sub, role, model, tv }.
 *
 * `tv` is the account's tokenVersion at issue time. Changing a password bumps
 * that counter, which revokes every token carrying an older value.
 */
function signAuthToken({ id, role, model, tokenVersion = 0 }) {
  return jwt.sign(
    { sub: String(id), role, model, tv: tokenVersion, typ: 'auth' },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN, issuer: ISSUER }
  );
}

/**
 * Donor-pass token embedded in the QR code (plan decision D-12).
 *
 * Long-lived so a printed pass keeps working, and carrying a `jti` so a lost
 * pass can be revoked. The check-in route verifies the signature and then
 * re-reads the donor from the database -- claims in the token are never
 * trusted for anything but identifying which donor to look up.
 */
function signPassToken({ id, bloodgroup }) {
  return jwt.sign(
    { sub: String(id), bg: bloodgroup, typ: 'donor-pass', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    { expiresIn: env.PASS_EXPIRES_IN, issuer: ISSUER }
  );
}

function verify(token, expectedTyp) {
  const payload = jwt.verify(token, env.JWT_SECRET, { issuer: ISSUER });
  if (expectedTyp && payload.typ !== expectedTyp) {
    const err = new Error('Wrong token type');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return payload;
}

/** Opaque single-use reset token: the plain half is mailed, the hash is stored. */
function makeResetToken() {
  const plain = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(plain).digest('hex');
  return { plain, hash };
}

function hashResetToken(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}

module.exports = { signAuthToken, signPassToken, verify, makeResetToken, hashResetToken, ISSUER };
