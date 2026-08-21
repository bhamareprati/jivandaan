'use strict';

const { ActivityLog } = require('../models');
const { sessionOpt } = require('./txn');

/**
 * Activity logging (Doc 2 section 5.5).
 *
 * Every state-changing controller action writes one entry with actor, action,
 * description, targetUser and metadata. Called from controllers and from
 * services that mutate on their own (the expiry sweep, for instance).
 *
 * Logging must never take down the action it is recording, so failures are
 * swallowed and reported to stderr -- except inside a transaction, where the
 * write is part of the atomic unit and is allowed to abort it.
 */

function actorFromReq(req) {
  if (!req || !req.user) return null;
  return { user: req.user.id, userModel: req.user.model };
}

async function log({
  req,
  actor,
  action,
  description,
  targetUser,
  targetModel,
  metadata,
  session = null,
}) {
  const who = actor || actorFromReq(req);
  if (!who || !who.user || !who.userModel) {
    // A mutation with no identifiable actor is a bug worth seeing in the log.
    // eslint-disable-next-line no-console
    console.warn(`[audit] skipped "${action}" -- no actor could be resolved`);
    return null;
  }

  const doc = {
    user: who.user,
    userModel: who.userModel,
    action,
    description,
    targetUser,
    targetModel,
    metadata,
    ip: req ? req.ip : undefined,
  };

  try {
    const [created] = await ActivityLog.create([doc], sessionOpt(session));
    return created;
  } catch (err) {
    if (session) throw err;
    // eslint-disable-next-line no-console
    console.error(`[audit] failed to write "${action}": ${err.message}`);
    return null;
  }
}

module.exports = { log, actorFromReq };
