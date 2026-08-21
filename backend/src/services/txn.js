'use strict';

const mongoose = require('mongoose');
const env = require('../config/env');

/**
 * Run `fn` inside a MongoDB transaction when the deployment supports one.
 *
 * Transactions need a replica set. Atlas has one; a standalone local mongod
 * does not, so USE_TRANSACTIONS gates this (plan decision D-6). When it is
 * off, `fn` runs with `session: null` and callers rely on the ordered-write
 * plus compensating-rollback path -- inventoryService.reconcile() is the
 * backstop if a crash lands between the two writes.
 */
let supported = null;

function setSupported(value) {
  supported = value;
}

function isEnabled() {
  return env.USE_TRANSACTIONS && supported !== false;
}

async function withTransaction(fn) {
  if (!isEnabled()) {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Spread into query options: `...sessionOpt(session)`. */
function sessionOpt(session) {
  return session ? { session } : {};
}

module.exports = { withTransaction, sessionOpt, setSupported, isEnabled };
