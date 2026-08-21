'use strict';

const { BLOOD_GROUPS } = require('../config/constants');

/**
 * Universal Compatibility Matching (Doc 2 section 5.1).
 *
 * Standard ABO/Rh rules for packed red cells. One table is authored; the other
 * direction is derived from it, because the two answer different questions and
 * hand-writing both is how they silently drift apart (plan decision D-13):
 *
 *   compatibleDonorsFor('AB+')  "a patient needs AB+, which units may we give?"
 *   canDonateTo('O-')           "I am O-, which patients can I serve?"
 */

/** recipient -> donor groups whose red cells they may safely receive. */
const RECEIVES_FROM = Object.freeze({
  'O-': ['O-'],
  'O+': ['O-', 'O+'],
  'A-': ['O-', 'A-'],
  'A+': ['O-', 'O+', 'A-', 'A+'],
  'B-': ['O-', 'B-'],
  'B+': ['O-', 'O+', 'B-', 'B+'],
  'AB-': ['O-', 'A-', 'B-', 'AB-'],
  'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
});

/** Derived transpose: donor -> recipients they can serve. */
const DONATES_TO = (() => {
  const out = {};
  for (const g of BLOOD_GROUPS) out[g] = [];
  for (const recipient of Object.keys(RECEIVES_FROM)) {
    for (const donor of RECEIVES_FROM[recipient]) out[donor].push(recipient);
  }
  for (const g of BLOOD_GROUPS) {
    out[g].sort((a, b) => BLOOD_GROUPS.indexOf(a) - BLOOD_GROUPS.indexOf(b));
  }
  return Object.freeze(out);
})();

/**
 * Scarcity weight, used to rank substitutes so we never hand out a rare unit
 * where a common one would serve. Lower number = issue first.
 * O- is the universal donor and the scarcest thing in any fridge, so it ranks last.
 */
const ISSUE_PRIORITY = Object.freeze({
  'AB+': 1, 'AB-': 2, 'B+': 3, 'A+': 4, 'B-': 5, 'A-': 6, 'O+': 7, 'O-': 8,
});

function assertGroup(group) {
  if (!BLOOD_GROUPS.includes(group)) {
    throw new Error(`Unknown blood group: ${group}`);
  }
}

/** Which donor groups a recipient of `group` may receive. */
function compatibleDonorsFor(group) {
  assertGroup(group);
  return RECEIVES_FROM[group].slice();
}

/** Which recipient groups a donor of `group` can serve. */
function canDonateTo(group) {
  assertGroup(group);
  return DONATES_TO[group].slice();
}

function isCompatible(donorGroup, recipientGroup) {
  assertGroup(donorGroup);
  assertGroup(recipientGroup);
  return RECEIVES_FROM[recipientGroup].includes(donorGroup);
}

/**
 * Rank the substitute options for a request against a bank's live stock.
 *
 * @param {Map|Object} inventory  blood group -> available units
 * @param {string} recipientGroup the group the patient needs
 * @param {number} units          units required
 * @returns {{ exactAvailable:boolean, shortfall:number, options:Array }}
 *   options are compatible groups that actually have stock, ordered:
 *   the exact match first, then commonest-first so rare stock is preserved.
 */
function rankSubstitutes(inventory, recipientGroup, units = 1) {
  assertGroup(recipientGroup);

  const read = (g) => {
    if (!inventory) return 0;
    const v = typeof inventory.get === 'function' ? inventory.get(g) : inventory[g];
    return Number(v) || 0;
  };

  const options = compatibleDonorsFor(recipientGroup)
    .map((group) => ({
      bloodGroup: group,
      unitsAvailable: read(group),
      isExactMatch: group === recipientGroup,
      coversRequest: read(group) >= units,
    }))
    .filter((o) => o.unitsAvailable > 0)
    .sort((a, b) => {
      if (a.isExactMatch !== b.isExactMatch) return a.isExactMatch ? -1 : 1;
      if (a.coversRequest !== b.coversRequest) return a.coversRequest ? -1 : 1;
      return ISSUE_PRIORITY[a.bloodGroup] - ISSUE_PRIORITY[b.bloodGroup];
    });

  const exact = read(recipientGroup);

  return {
    requestedGroup: recipientGroup,
    unitsRequested: units,
    exactAvailable: exact >= units,
    exactUnits: exact,
    shortfall: Math.max(0, units - exact),
    totalCompatibleUnits: options.reduce((s, o) => s + o.unitsAvailable, 0),
    options,
  };
}

module.exports = {
  RECEIVES_FROM,
  DONATES_TO,
  ISSUE_PRIORITY,
  compatibleDonorsFor,
  canDonateTo,
  isCompatible,
  rankSubstitutes,
};
