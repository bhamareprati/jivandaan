'use strict';

/**
 * Disposable MongoDB for local development.
 *
 * Starts an in-memory MongoDB as a single-node REPLICA SET on a fixed port, so
 * you get transactions (which the inventory write path uses -- plan decision
 * D-6) without installing MongoDB or provisioning an Atlas cluster.
 *
 *   npm run db          leave this running in its own terminal
 *   npm run seed:reset  in a second terminal
 *   npm run dev         in a third
 *
 * Data lives in memory and is gone when this process exits. For anything you
 * want to keep, point MONGO_URI at a real MongoDB or an Atlas cluster instead.
 */

const { MongoMemoryReplSet } = require('mongodb-memory-server');

const PORT = Number(process.env.DEV_DB_PORT) || 37017;
const DB_NAME = process.env.DEV_DB_NAME || 'jivandan_dev';

(async () => {
  console.log('Starting in-memory MongoDB (first run downloads a binary)...');

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port: PORT }],
  });

  const uri = replSet.getUri(DB_NAME);

  console.log('');
  console.log('  MongoDB is up (in-memory, single-node replica set).');
  console.log('');
  console.log(`  MONGO_URI=${uri}`);
  console.log('');
  console.log('  Put that line in backend/.env, then run "npm run seed:reset".');
  console.log('  Transactions are available. Data is lost when this process exits.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  const shutdown = async () => {
    console.log('\nStopping in-memory MongoDB...');
    await replSet.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Hold the process open.
  setInterval(() => {}, 1 << 30);
})().catch((err) => {
  console.error('[dev-db] failed to start:', err);
  process.exit(1);
});
