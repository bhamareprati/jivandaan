'use strict';

const dns = require('node:dns');
const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);

/**
 * Atlas `mongodb+srv://` URIs need a DNS SRV lookup, and Node uses the system
 * resolver for it. On machines whose configured nameserver is a local stub that
 * does not answer SRV (Node reports `querySrv ECONNREFUSED`), that lookup fails
 * and the connection never starts.
 *
 * Setting DNS_SERVERS points Node's resolver at a nameserver that does answer.
 * This matters more than it looks: the workaround of listing the shard hosts
 * directly bypasses the SRV name Atlas uses for SNI routing on shared tiers,
 * which surfaces later as an intermittent `tlsv1 alert internal error`.
 */
function applyDnsOverride() {
  if (!env.DNS_SERVERS.length) return;
  try {
    dns.setServers(env.DNS_SERVERS);
    if (!env.isTest) {
      // eslint-disable-next-line no-console
      console.log(`[db] DNS resolver set to ${env.DNS_SERVERS.join(', ')}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[db] could not set DNS servers: ${err.message}`);
  }
}

applyDnsOverride();

let connecting = null;

/**
 * Connect with bounded retry. Returns the mongoose connection.
 */
async function connect(uri = env.MONGO_URI, { retries = 5, delayMs = 2000 } = {}) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connecting) return connecting;

  connecting = (async () => {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS: 10000,
          maxPoolSize: 20,
        });
        if (!env.isTest) {
          // eslint-disable-next-line no-console
          console.log(`[db] connected to ${mongoose.connection.name}`);
        }
        return mongoose.connection;
      } catch (err) {
        lastErr = err;
        if (attempt === retries) break;
        // eslint-disable-next-line no-console
        console.warn(`[db] connection attempt ${attempt}/${retries} failed: ${err.message}`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    connecting = null;
    throw lastErr;
  })();

  return connecting;
}

async function disconnect() {
  connecting = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

function isConnected() {
  return mongoose.connection.readyState === 1;
}

function stateLabel() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][
    mongoose.connection.readyState
  ] || 'unknown';
}

/**
 * Detect whether the server is a replica set, which is what transactions need.
 * Called once at boot so `USE_TRANSACTIONS=true` against a standalone mongod
 * degrades loudly at startup instead of silently failing on the first write.
 */
async function supportsTransactions() {
  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(info.setName || info.msg === 'isdbgrid');
  } catch (_err) {
    return false;
  }
}

module.exports = { connect, disconnect, isConnected, stateLabel, supportsTransactions };
