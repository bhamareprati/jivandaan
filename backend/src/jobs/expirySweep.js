'use strict';

const cron = require('node-cron');
const env = require('../config/env');
const expiryRadar = require('../services/expiryRadar');

/**
 * Nightly expiry sweep (plan decision D-6).
 *
 * The radar also sweeps lazily on every read, so this job is a belt-and-braces
 * measure: it keeps the cached inventory counts honest for banks nobody has
 * looked at today.
 */
let task = null;

function start(expression = '0 2 * * *') {
  if (!env.ENABLE_CRON) return null;
  if (task) return task;

  task = cron.schedule(expression, async () => {
    try {
      const result = await expiryRadar.sweepExpired();
      if (result.expiredRows) {
        // eslint-disable-next-line no-console
        console.log(
          `[cron] expiry sweep: ${result.expiredRows} batch(es), ${result.unitsRemoved} unit(s) removed`
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[cron] expiry sweep failed: ${err.message}`);
    }
  });

  // eslint-disable-next-line no-console
  console.log(`[cron] expiry sweep scheduled (${expression})`);
  return task;
}

function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

module.exports = { start, stop };
