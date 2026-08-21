'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function list(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const env = {
  NODE_ENV,
  isProd,
  isTest,

  PORT: num(process.env.PORT, 5000),
  MONGO_URI: process.env.MONGO_URI || '',

  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  PASS_EXPIRES_IN: process.env.PASS_EXPIRES_IN || '365d',
  SESSION_SECRET: process.env.SESSION_SECRET || '',

  CORS_ORIGINS: list(process.env.CORS_ORIGINS, ['http://localhost:5173']),

  // 'lax' when the SPA is served from the same origin as the API (the default,
  // and what the Vite dev proxy gives you). Set 'none' only for a genuinely
  // cross-origin deployment -- it requires secure cookies, and the CSRF guard
  // in middleware/auth.js is what keeps that safe.
  COOKIE_SAMESITE: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(),

  // Nameservers for Node's resolver, comma-separated. Only needed where the
  // system resolver cannot answer SRV lookups -- see config/db.js.
  DNS_SERVERS: list(process.env.DNS_SERVERS, []),

  // Domain policy -- configurable, never hard-coded in controllers.
  DONATION_INTERVAL_DAYS: num(process.env.DONATION_INTERVAL_DAYS, 56),
  UNIT_SHELF_LIFE_DAYS: num(process.env.UNIT_SHELF_LIFE_DAYS, 42),
  EXPIRY_RADAR_DAYS: num(process.env.EXPIRY_RADAR_DAYS, 7),
  LOW_STOCK_THRESHOLD: num(process.env.LOW_STOCK_THRESHOLD, 10),

  // Transactions need a replica set. Atlas has one; a standalone mongod does not.
  USE_TRANSACTIONS: bool(process.env.USE_TRANSACTIONS, false),

  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@jivandan.in',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',

  SMS_PROVIDER_KEY: process.env.SMS_PROVIDER_KEY || '',

  BCRYPT_ROUNDS: num(process.env.BCRYPT_ROUNDS, isTest ? 4 : 12),

  RATE_AUTH_MAX: num(process.env.RATE_AUTH_MAX, 10),
  RATE_REQUEST_MAX: num(process.env.RATE_REQUEST_MAX, 20),
  RATE_GLOBAL_MAX: num(process.env.RATE_GLOBAL_MAX, 300),
  RATE_LIMIT_ENABLED: bool(process.env.RATE_LIMIT_ENABLED, !isTest),

  ENABLE_CRON: bool(process.env.ENABLE_CRON, !isTest),
};

/**
 * Fail fast on missing secrets rather than booting an app that silently signs
 * tokens with `undefined`. Tests and the in-memory verifier inject their own.
 */
function assertConfig() {
  const missing = [];
  if (!env.MONGO_URI) missing.push('MONGO_URI');
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!env.SESSION_SECRET) missing.push('SESSION_SECRET');

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.'
    );
  }

  if (env.isProd) {
    const weak = ['changeme', 'secret', 'dev-secret', 'jivandan'];
    if (weak.some((w) => env.JWT_SECRET.toLowerCase().includes(w))) {
      throw new Error('JWT_SECRET looks like a development value. Set a real secret in production.');
    }
    if (weak.some((w) => env.SESSION_SECRET.toLowerCase().includes(w))) {
      throw new Error('SESSION_SECRET looks like a development value. Set a real secret in production.');
    }
  }
}

module.exports = env;
module.exports.assertConfig = assertConfig;
