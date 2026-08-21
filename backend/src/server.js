'use strict';

const env = require('./config/env');
const db = require('./config/db');
const createApp = require('./app');
const txn = require('./services/txn');
const expirySweep = require('./jobs/expirySweep');

async function start() {
  env.assertConfig();

  await db.connect();

  // Transactions need a replica set. Fail loudly at boot rather than on the
  // first inventory write (plan decision D-6).
  const canTransact = await db.supportsTransactions();
  txn.setSupported(canTransact);
  if (env.USE_TRANSACTIONS && !canTransact) {
    // eslint-disable-next-line no-console
    console.warn(
      '[startup] USE_TRANSACTIONS=true but MongoDB is not a replica set. ' +
        'Falling back to ordered writes. Run mongod with --replSet, or use Atlas, ' +
        'to get atomic inventory updates.'
    );
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[startup] Jivandan API listening on :${env.PORT} (${env.NODE_ENV})`);
    // eslint-disable-next-line no-console
    console.log(`[startup] transactions: ${txn.isEnabled() ? 'enabled' : 'disabled'}`);
  });

  expirySweep.start();

  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[shutdown] ${signal} received, closing`);
    expirySweep.stop();
    server.close(async () => {
      await db.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    // eslint-disable-next-line no-console
    console.error('[fatal] unhandled rejection', err);
    shutdown('unhandledRejection');
  });

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[fatal] failed to start', err);
    process.exit(1);
  });
}

module.exports = start;
