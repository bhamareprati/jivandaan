'use strict';

/**
 * Diagnose the database connection.
 *
 *   npm run db:check
 *
 * Written because "Could not connect to any servers in your MongoDB Atlas
 * cluster" is the driver's catch-all message: it says "check your IP allowlist"
 * whether the real cause is DNS, TLS, credentials or the allowlist. This walks
 * the four layers separately so the failing one is obvious.
 */

const dns = require('node:dns');
const net = require('node:net');
const tls = require('node:tls');
const env = require('../src/config/env');

const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => console.log(`  FAIL  ${m}`);
const info = (m) => console.log(`        ${m}`);

function parseUri(uri) {
  const srv = uri.startsWith('mongodb+srv://');
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  const [creds, rest] = withoutScheme.includes('@')
    ? [withoutScheme.slice(0, withoutScheme.lastIndexOf('@')), withoutScheme.slice(withoutScheme.lastIndexOf('@') + 1)]
    : ['', withoutScheme];
  const hostPart = rest.split('/')[0].split('?')[0];
  const pathPart = rest.slice(hostPart.length);
  const dbName = (pathPart.split('?')[0] || '').replace(/^\//, '');
  // mongodb+srv:// implies TLS; the standard form only uses it when asked.
  const query = pathPart.includes('?') ? pathPart.slice(pathPart.indexOf('?')) : '';
  const usesTls = srv || /[?&](ssl|tls)=true/i.test(query);

  return {
    srv,
    usesTls,
    user: creds.split(':')[0] || null,
    hosts: hostPart.split(','),
    dbName: dbName || null,
  };
}

async function main() {
  console.log('\nJivandan database check\n' + '-'.repeat(58));

  if (!env.MONGO_URI) {
    bad('MONGO_URI is not set. Copy .env.example to .env.');
    process.exit(1);
  }

  const parsed = parseUri(env.MONGO_URI);
  ok(`URI parsed (${parsed.srv ? 'SRV' : 'standard'} form)`);
  info(`user: ${parsed.user ?? '(none)'}`);

  if (!parsed.dbName) {
    bad('No database name in the URI path');
    info('Without one the driver uses "test". Add it before the query string,');
    info('e.g. ...mongodb.net/jivandan?retryWrites=true&w=majority');
  } else {
    ok(`database: ${parsed.dbName}`);
  }

  /* -------------------------------------------------------------- 1. DNS */
  let hosts = parsed.hosts;

  if (env.DNS_SERVERS.length) {
    dns.setServers(env.DNS_SERVERS);
    info(`DNS resolver overridden to ${env.DNS_SERVERS.join(', ')}`);
  }

  if (parsed.srv) {
    const srvName = `_mongodb._tcp.${parsed.hosts[0]}`;
    try {
      const records = await dns.promises.resolveSrv(srvName);
      hosts = records.map((r) => `${r.name}:${r.port}`);
      ok(`SRV lookup resolved ${records.length} host(s)`);
    } catch (err) {
      bad(`SRV lookup failed: ${err.code || err.message}`);
      if (err.code === 'ECONNREFUSED') {
        info(`Node is asking ${dns.getServers().join(', ')}, which refuses SRV.`);
        info('Set DNS_SERVERS=8.8.8.8,1.1.1.1 in .env.');
      }
      process.exit(1);
    }
  }

  const [host, port = '27017'] = hosts[0].split(':');

  /* -------------------------------------------------------------- 2. TCP */
  await new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port), timeout: 12000 });
    socket.on('connect', () => { ok(`TCP reachable: ${host}:${port}`); socket.destroy(); resolve(); });
    socket.on('timeout', () => { bad(`TCP timed out: ${host}:${port}`); socket.destroy(); process.exit(1); });
    socket.on('error', (e) => { bad(`TCP failed: ${e.message}`); process.exit(1); });
  });

  /* -------------------------------------------------------------- 3. TLS */
  // A plain local mongod speaks no TLS, so probing it would report a bogus
  // failure. Only test the layer the URI actually asks for.
  const tlsOk = !parsed.usesTls ? (info('plaintext connection (no TLS in the URI)'), true)
    : await new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: Number(port), servername: host, timeout: 15000 },
      () => { ok('TLS handshake completed'); socket.end(); resolve(true); }
    );
    socket.on('error', (e) => {
      bad(`TLS handshake failed: ${e.message.split('\n')[0]}`);
      if (/alert number 80|internal error/i.test(e.message)) {
        info('');
        info('Atlas returns this exact alert when the connecting IP is not in');
        info('the cluster\'s Network Access list. It is NOT a certificate or');
        info('credential problem -- the handshake never gets that far.');
        info('');
        info('Fix: Atlas -> Network Access -> Add IP Address.');
        info('On a mobile or dynamic IP, "Allow access from anywhere"');
        info('(0.0.0.0/0) is the practical choice -- the database password');
        info('then becomes your only control, so make sure it is a strong one');
        info('that has never been shared.');
      }
      resolve(false);
    });
    socket.on('timeout', () => { bad('TLS handshake timed out'); socket.destroy(); resolve(false); });
  });

  if (!tlsOk) {
    console.log('-'.repeat(58) + '\n');
    process.exit(1);
  }

  /* ------------------------------------------------------- 4. auth + rw */
  const db = require('../src/config/db');
  const mongoose = require('mongoose');
  try {
    await db.connect(env.MONGO_URI, { retries: 1 });
    ok(`authenticated, connected to "${mongoose.connection.name}"`);

    const isReplicaSet = await db.supportsTransactions();
    if (isReplicaSet) ok('replica set detected -- transactions available');
    else info('standalone server -- set USE_TRANSACTIONS=false');

    const { Donor, BloodBank, BloodRequest } = require('../src/models');
    const [donors, banks, requests] = await Promise.all([
      Donor.countDocuments(), BloodBank.countDocuments(), BloodRequest.countDocuments(),
    ]);
    ok(`read ok -- ${donors} donors, ${banks} banks, ${requests} requests`);
    if (donors === 0) info('Database is empty. Run: npm run seed:reset');

    await db.disconnect();
    console.log('-'.repeat(58));
    console.log('  All checks passed.\n');
    process.exit(0);
  } catch (err) {
    bad(`connection failed: ${err.message.split('\n')[0].slice(0, 160)}`);
    if (/Authentication failed|bad auth/i.test(err.message)) {
      info('TLS succeeded but the credentials were rejected -- check the');
      info('username and password in MONGO_URI (Atlas > Database Access).');
    }
    await db.disconnect().catch(() => {});
    console.log('-'.repeat(58) + '\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('db-check failed:', err);
  process.exit(1);
});
