'use strict';

const ApiError = require('../utils/ApiError');
const { fail } = require('../utils/apiResponse');
const env = require('../config/env');

/** Anything that falls through the router. */
function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/** Translate Mongoose and driver errors into the API's own vocabulary. */
function normalise(err) {
  if (err instanceof ApiError) return err;

  // Duplicate key -- the unique index on email is the usual source.
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
    return ApiError.conflict(`That ${field} is already registered`, [
      { field, message: 'already in use' },
    ]);
  }

  if (err && err.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return ApiError.unprocessable('Validation failed', errors);
  }

  // Bad ObjectId in a path param.
  if (err && err.name === 'CastError') {
    return ApiError.badRequest(`Invalid ${err.path}: ${err.value}`, [
      { field: err.path, message: 'is not a valid identifier' },
    ]);
  }

  if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    return ApiError.unauthorized('Invalid authentication token');
  }

  // Body parser rejecting oversized or malformed JSON.
  if (err && err.type === 'entity.too.large') {
    return ApiError.badRequest('Request body is too large');
  }
  if (err && err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON');
  }

  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const known = normalise(err);

  if (known) {
    if (known.status >= 500) {
      // eslint-disable-next-line no-console
      console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    }
    return fail(res, known.status, known.message, known.errors);
  }

  // Unrecognised: a bug. Log it in full, tell the client nothing useful.
  // eslint-disable-next-line no-console
  console.error(`[error] unhandled on ${req.method} ${req.originalUrl}`, err);

  const body = env.isProd ? undefined : [{ field: 'stack', message: String(err && err.stack) }];
  return fail(res, 500, 'Something went wrong on our end', body);
}

module.exports = { errorHandler, notFound };
