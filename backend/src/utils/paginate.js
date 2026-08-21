'use strict';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Read page/limit off a validated query. Doc 2 section 5 requires pagination on
 * every list endpoint; the cap stops `?limit=100000` from becoming a DoS.
 */
function readPaging(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const rawLimit = Number(query.limit) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function buildMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Run a find + countDocuments pair against a model and return { items, meta }.
 */
async function paginateQuery(Model, filter, { page, limit, skip }, options = {}) {
  const { sort = { createdAt: -1 }, populate, select, lean = true } = options;

  let q = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (select) q = q.select(select);
  if (populate) {
    for (const p of [].concat(populate)) q = q.populate(p);
  }
  if (lean) q = q.lean({ virtuals: true });

  const [items, total] = await Promise.all([q.exec(), Model.countDocuments(filter)]);

  return { items, meta: buildMeta({ page, limit, total }) };
}

module.exports = { readPaging, buildMeta, paginateQuery, DEFAULT_LIMIT, MAX_LIMIT };
