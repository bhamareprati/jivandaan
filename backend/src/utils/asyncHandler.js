'use strict';

/**
 * Wrap an async route handler so a rejected promise reaches the Express error
 * handler instead of hanging the request. Express 4 does not do this for us.
 */
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
