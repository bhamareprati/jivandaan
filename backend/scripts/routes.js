'use strict';

/**
 * Print every registered Express route.
 *
 * Doc 3 section 3.1: after each backend phase, list the resulting routes and
 * paste them back so docs/backend-contract.md stays the single source of truth.
 * This is that step, automated -- run it and diff against the contract.
 *
 *   node scripts/routes.js          human-readable table
 *   node scripts/routes.js --json   machine-readable, for diffing
 */

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/jivandan';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'routes-listing-placeholder-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'routes-listing-placeholder-secret';

const createApp = require('../src/app');

function decodePrefix(layer) {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const src = layer.regexp && layer.regexp.source;
  if (!src) return '';
  return src
    .replace('^\\/', '/')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\\\//g, '/')
    .replace(/\$$/, '');
}

function collect(stack, prefix, out) {
  for (const layer of stack) {
    if (layer.route) {
      const guards = layer.route.stack
        .map((s) => s.name)
        .filter((n) => n && n !== '<anonymous>' && n !== 'wrapped' && !n.startsWith('bound'));
      for (const method of Object.keys(layer.route.methods)) {
        out.push({
          method: method.toUpperCase(),
          path: (prefix + layer.route.path).replace(/\/+/g, '/'),
          guards,
        });
      }
    } else if (layer.handle && layer.handle.stack) {
      collect(layer.handle.stack, prefix + decodePrefix(layer), out);
    }
  }
}

const app = createApp();
const routes = [];
collect(app._router.stack, '', routes);

const ORDER = { GET: 0, POST: 1, PATCH: 2, PUT: 3, DELETE: 4 };
routes.sort((a, b) => a.path.localeCompare(b.path) || ORDER[a.method] - ORDER[b.method]);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(routes.map(({ method, path }) => `${method} ${path}`), null, 2));
} else {
  console.log(`\n  Jivandan API -- ${routes.length} registered routes\n`);
  for (const r of routes) {
    const guards = r.guards.length ? `  [${r.guards.join(', ')}]` : '';
    console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(38)}${guards}`);
  }
  console.log('');
}

process.exit(0);
