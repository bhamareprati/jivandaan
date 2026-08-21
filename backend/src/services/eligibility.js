'use strict';

const env = require('../config/env');
const { addDays, daysBetweenUTC } = require('../utils/dates');

/**
 * 56-day donor eligibility (Doc 2 section 5.3).
 *
 * Computed on UTC day boundaries so the countdown ring on the donor dashboard
 * does not flicker as a user's local clock crosses midnight.
 */

/** Next date this donor may give. Null when they have never donated. */
function nextEligibleDate(lastDonationDate) {
  if (!lastDonationDate) return null;
  return addDays(new Date(lastDonationDate), env.DONATION_INTERVAL_DAYS);
}

/**
 * @returns {{ eligible:boolean, nextEligibleDate:Date|null, daysRemaining:number,
 *             lastDonationDate:Date|null, intervalDays:number, progress:number }}
 *   `progress` is 0..1 through the waiting window, for the dashboard ring.
 */
function getEligibility(lastDonationDate, now = new Date()) {
  const last = lastDonationDate ? new Date(lastDonationDate) : null;
  const next = nextEligibleDate(last);

  if (!next) {
    return {
      eligible: true,
      nextEligibleDate: null,
      daysRemaining: 0,
      lastDonationDate: null,
      intervalDays: env.DONATION_INTERVAL_DAYS,
      progress: 1,
      reason: 'No recorded donation yet',
    };
  }

  const daysRemaining = Math.max(0, daysBetweenUTC(now, next));
  const elapsed = env.DONATION_INTERVAL_DAYS - daysRemaining;

  return {
    eligible: daysRemaining <= 0,
    nextEligibleDate: next,
    daysRemaining,
    lastDonationDate: last,
    intervalDays: env.DONATION_INTERVAL_DAYS,
    progress: Math.min(1, Math.max(0, elapsed / env.DONATION_INTERVAL_DAYS)),
    reason:
      daysRemaining <= 0
        ? 'Eligible to donate'
        : `${daysRemaining} day(s) remaining in the ${env.DONATION_INTERVAL_DAYS}-day interval`,
  };
}

/** Convenience for a Donor document. */
function forDonor(donor, now = new Date()) {
  return getEligibility(donor && donor.lastDonationDate, now);
}

/**
 * A cutoff for querying eligible donors in bulk: anyone whose lastDonationDate
 * is on or before this instant has cleared the interval.
 */
function eligibleSinceCutoff(now = new Date()) {
  return addDays(now, -env.DONATION_INTERVAL_DAYS);
}

module.exports = { nextEligibleDate, getEligibility, forDonor, eligibleSinceCutoff };
