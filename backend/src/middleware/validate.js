'use strict';

const ApiError = require('../utils/ApiError');

/**
 * One validation middleware for the whole API (Doc 2 section 5).
 *
 * Pass a Zod schema per request part:
 *   validate({ body: schemaA, params: schemaB, query: schemaC })
 *
 * Failures become 422 with a field-keyed `errors` array that the frontend can
 * map straight onto React Hook Form fields. Parsed values are written back, so
 * downstream code gets coerced types (numbers, dates, defaults).
 */
function formatIssues(issues, part) {
  return issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : part,
    message: issue.message,
    code: issue.code,
  }));
}

function validate(schemas = {}) {
  const parts = Object.keys(schemas);

  return function validateMiddleware(req, _res, next) {
    const errors = [];

    for (const part of parts) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        errors.push(...formatIssues(result.error.issues, part));
        continue;
      }

      // Express 5 makes req.query a getter; assigning to it throws. Mutating
      // in place keeps this middleware portable across Express 4 and 5.
      if (part === 'query' || part === 'params') {
        for (const k of Object.keys(req[part])) delete req[part][k];
        Object.assign(req[part], result.data);
      } else {
        req[part] = result.data;
      }
    }

    if (errors.length) {
      return next(ApiError.unprocessable('Validation failed', errors));
    }
    return next();
  };
}

module.exports = validate;
