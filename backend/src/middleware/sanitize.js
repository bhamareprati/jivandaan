'use strict';

/**
 * NoSQL injection guard and parameter-pollution guard.
 *
 * Written in-house rather than pulled from express-mongo-sanitize + hpp: both
 * assume a writable req.query, which Express 5 removed. This mutates in place
 * and so works on either major version.
 *
 * Strips keys that start with `$` or contain `.` -- the shapes that turn a
 * query string into a Mongo operator, e.g. ?email[$ne]= .
 */

const MAX_DEPTH = 8;

function scrub(value, depth = 0) {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) scrub(item, depth + 1);
    return;
  }

  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete value[key];
      continue;
    }
    scrub(value[key], depth + 1);
  }
}

/**
 * `?status=a&status=b` arrives as an array. For scalar params that is almost
 * always pollution rather than intent, so keep the last value.
 */
function dedupeScalars(query, scalarKeys) {
  for (const key of scalarKeys) {
    if (Array.isArray(query[key])) {
      const last = query[key][query[key].length - 1];
      delete query[key];
      query[key] = last;
    }
  }
}

const SCALAR_QUERY_KEYS = [
  'page', 'limit', 'urgency', 'status', 'bank', 'bankId', 'bloodGroup', 'city',
  'pincode', 'lat', 'lng', 'radius', 'windowDays', 'action', 'user', 'from', 'to', 'units',
];

module.exports = function sanitize(req, _res, next) {
  scrub(req.body);
  scrub(req.params);

  if (req.query && typeof req.query === 'object') {
    scrub(req.query);
    dedupeScalars(req.query, SCALAR_QUERY_KEYS);
  }

  return next();
};

module.exports.scrub = scrub;
