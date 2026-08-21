'use strict';

/**
 * Jest bootstrap: one in-memory MongoDB replica set shared by the suite.
 *
 * A replica set rather than a standalone, so the transactional inventory path
 * (plan decision D-6) is exercised by the tests rather than silently skipped.
 */

const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri('jivandan_test');

  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = uri;
  process.env.JWT_SECRET = 'test-jwt-secret-not-for-production';
  process.env.SESSION_SECRET = 'test-session-secret-not-for-production';
  process.env.USE_TRANSACTIONS = 'true';
  process.env.RATE_LIMIT_ENABLED = 'false';
  process.env.ENABLE_CRON = 'false';
  process.env.BCRYPT_ROUNDS = '4';

  const db = require('../src/config/db');
  const txn = require('../src/services/txn');
  await db.connect(uri);
  txn.setSupported(await db.supportsTransactions());

  global.__MONGO_URI__ = uri;
}, 120000);

afterAll(async () => {
  const db = require('../src/config/db');
  await db.disconnect();
  if (replSet) await replSet.stop();
}, 60000);

/** Empty every collection between tests so cases cannot leak into each other. */
global.resetDb = async () => {
  const mongoose = require('mongoose');
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
};
