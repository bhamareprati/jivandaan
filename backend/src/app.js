'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const env = require('./config/env');
const routes = require('./routes');
const sanitize = require('./middleware/sanitize');
const { globalLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const ApiError = require('./utils/ApiError');

function createApp({ mongoUri = env.MONGO_URI } = {}) {
  const app = express();

  // Correct client IPs behind a platform proxy, which rate limiting depends on.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  // Allowlist only. Doc 4 section 5: production must admit the deployed
  // frontend origin and nothing else.
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server calls arrive without an Origin.
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(ApiError.forbidden(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(sanitize);

  if (!env.isTest) {
    app.use(morgan(env.isProd ? 'combined' : 'dev'));
  }

  // Doc 2 section 2 pairs JWT with express-session. The SPA authenticates by
  // bearer token; the session is backed by Mongo rather than the default
  // MemoryStore, which leaks and drops every session on restart.
  app.use(
    session({
      name: 'jivandan.sid',
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: mongoUri,
        collectionName: 'sessions',
        ttl: 7 * 24 * 60 * 60,
        touchAfter: 24 * 3600,
      }),
      cookie: {
        httpOnly: true,
        sameSite: env.COOKIE_SAMESITE,
        // SameSite=None is only honoured on secure cookies.
        secure: env.isProd || env.COOKIE_SAMESITE === 'none',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.use('/api', globalLimiter);
  app.use('/api', routes);

  app.get('/', (_req, res) =>
    res.json({
      success: true,
      message: 'Jivandan API',
      data: { docs: '/api/health', version: require('../package.json').version },
    })
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
