'use strict';

/**
 * Operational error carrying an HTTP status and optional field-level errors.
 * Anything thrown that is not an ApiError is treated as a bug by the error
 * handler and reported as a 500 without leaking internals.
 */
class ApiError extends Error {
  constructor(status, message, errors = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.isOperational = true;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message = 'Bad request', errors) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }

  /** Duplicate email, invalid status transition, insufficient stock. */
  static conflict(message = 'Conflict', errors) {
    return new ApiError(409, message, errors);
  }

  /** Validation failure, ineligible donor. */
  static unprocessable(message = 'Validation failed', errors) {
    return new ApiError(422, message, errors);
  }

  static tooMany(message = 'Too many requests, please try again later') {
    return new ApiError(429, message);
  }
}

module.exports = ApiError;
