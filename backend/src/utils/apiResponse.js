'use strict';

/**
 * The one response shape for the whole API (Doc 2 section 5):
 *   { success, message, data | errors }
 * plus a `meta` block on paginated lists.
 *
 * Every controller goes through here. Nothing hand-rolls a res.json body.
 */

function ok(res, data = null, message = 'OK', status = 200) {
  return res.status(status).json({ success: true, message, data });
}

function created(res, data = null, message = 'Created') {
  return ok(res, data, message, 201);
}

function paginated(res, items, meta, message = 'OK') {
  return res.status(200).json({ success: true, message, data: items, meta });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
}

module.exports = { ok, created, paginated, fail };
