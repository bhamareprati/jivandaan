'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  const d = new Date(date);
  d.setTime(d.getTime() + days * DAY_MS);
  return d;
}

/** Midnight UTC of the given date. */
function startOfUTCDay(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Whole days between two instants, measured on UTC day boundaries so a
 * countdown does not flicker as the user's local clock crosses midnight.
 */
function daysBetweenUTC(from, to) {
  return Math.round((startOfUTCDay(to) - startOfUTCDay(from)) / DAY_MS);
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

module.exports = { DAY_MS, addDays, startOfUTCDay, daysBetweenUTC, isValidDate };
