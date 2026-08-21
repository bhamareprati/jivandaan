'use strict';

const {
  REQUEST_STATUS: S,
  STATUS_LABELS,
  STATUS_FLOW,
  TERMINAL_STATUSES,
  ROLES,
} = require('../config/constants');
const ApiError = require('../utils/ApiError');

/**
 * Blood request status machine (plan decision D-1).
 *
 * Doc 2 section 3.3 lists only pending/approved/rejected/fulfilled, but Doc 1's
 * tracker stepper and Doc 2 section 4.4's own PATCH route need `review` and
 * `dispatched`. The graph below is the reconciled contract, and it is the ONLY
 * place a transition is authorised -- controllers never compare statuses
 * themselves.
 *
 *   pending -> under_review -> approved -> dispatched -> fulfilled
 *      |            |             |
 *      +-> rejected +-> rejected  +-> rejected
 *      |
 *      +-> cancelled  (requester only, while pending | under_review)
 */

const TRANSITIONS = Object.freeze({
  [S.PENDING]: [S.UNDER_REVIEW, S.REJECTED, S.CANCELLED],
  [S.UNDER_REVIEW]: [S.APPROVED, S.REJECTED, S.CANCELLED],
  [S.APPROVED]: [S.DISPATCHED, S.REJECTED],
  [S.DISPATCHED]: [S.FULFILLED],
  [S.FULFILLED]: [],
  [S.REJECTED]: [],
  [S.CANCELLED]: [],
});

/** Who may drive each transition. */
const HANDLERS = Object.freeze({
  [S.UNDER_REVIEW]: [ROLES.BANK, ROLES.ADMIN],
  [S.APPROVED]: [ROLES.BANK, ROLES.ADMIN],
  [S.DISPATCHED]: [ROLES.BANK, ROLES.ADMIN],
  [S.FULFILLED]: [ROLES.BANK, ROLES.ADMIN],
  [S.REJECTED]: [ROLES.BANK, ROLES.ADMIN],
  [S.CANCELLED]: [ROLES.DONOR, ROLES.HOSPITAL],
});

function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

function nextStatuses(from) {
  return (TRANSITIONS[from] || []).slice();
}

/**
 * @returns {{ ok:boolean, reason?:string, status?:number }}
 */
function canTransition(from, to, actorRole, { isRequester = false } = {}) {
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, to)) {
    return { ok: false, status: 422, reason: `Unknown status: ${to}` };
  }
  if (from === to) {
    return { ok: false, status: 409, reason: `Request is already ${STATUS_LABELS[to] || to}` };
  }
  if (isTerminal(from)) {
    return {
      ok: false,
      status: 409,
      reason: `Request is already ${STATUS_LABELS[from] || from} and cannot change further`,
    };
  }
  if (!nextStatuses(from).includes(to)) {
    return { ok: false, status: 409, reason: `Invalid status transition: ${from} -> ${to}` };
  }

  const allowed = HANDLERS[to] || [];
  if (!allowed.includes(actorRole)) {
    return {
      ok: false,
      status: 403,
      reason: `Role "${actorRole}" may not move a request to ${STATUS_LABELS[to] || to}`,
    };
  }

  // Cancellation is the requester's own privilege, not any donor's.
  if (to === S.CANCELLED && !isRequester) {
    return { ok: false, status: 403, reason: 'Only the requester may cancel this request' };
  }

  return { ok: true };
}

/** Throwing variant for controllers. */
function assertTransition(from, to, actorRole, opts) {
  const verdict = canTransition(from, to, actorRole, opts);
  if (verdict.ok) return;
  throw new ApiError(verdict.status, verdict.reason);
}

/**
 * The stepper payload for GET /api/requests/:id -- one entry per step with its
 * real timestamp, so the frontend animates from data rather than guessing.
 */
function buildStepper(request) {
  const history = request.statusHistory || [];
  const at = (status) => {
    const hit = history.find((h) => h.status === status);
    return hit ? hit.at : null;
  };

  const currentIndex = STATUS_FLOW.indexOf(request.status);
  const derailed = isTerminal(request.status) && request.status !== S.FULFILLED;

  const steps = STATUS_FLOW.map((status, i) => ({
    status,
    label: STATUS_LABELS[status],
    at: at(status),
    complete: currentIndex >= 0 ? i < currentIndex : Boolean(at(status)),
    current: !derailed && i === currentIndex,
  }));

  return {
    steps,
    currentStatus: request.status,
    currentLabel: STATUS_LABELS[request.status],
    currentIndex,
    isTerminal: isTerminal(request.status),
    derailed,
    derailedAs: derailed ? request.status : null,
    nextStatuses: nextStatuses(request.status),
  };
}

module.exports = {
  TRANSITIONS,
  HANDLERS,
  canTransition,
  assertTransition,
  nextStatuses,
  isTerminal,
  buildStepper,
};
