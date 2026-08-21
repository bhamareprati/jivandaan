'use strict';

const compatibility = require('../src/services/compatibility');
const eligibility = require('../src/services/eligibility');
const lifecycle = require('../src/services/requestLifecycle');
const { BLOOD_GROUPS } = require('../src/config/constants');
const { addDays } = require('../src/utils/dates');

/** Pure domain logic -- no database, so these are fast and deterministic. */

describe('Compatibility matrix (Doc 2 section 5.1, plan decision D-13)', () => {
  const EXPECTED_RECEIVES = {
    'O-': ['O-'],
    'O+': ['O-', 'O+'],
    'A-': ['O-', 'A-'],
    'A+': ['O-', 'O+', 'A-', 'A+'],
    'B-': ['O-', 'B-'],
    'B+': ['O-', 'O+', 'B-', 'B+'],
    'AB-': ['O-', 'A-', 'B-', 'AB-'],
    'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  };

  test.each(Object.entries(EXPECTED_RECEIVES))(
    'compatibleDonorsFor(%s) matches the ABO/Rh rules',
    (recipient, donors) => {
      expect(compatibility.compatibleDonorsFor(recipient).sort())
        .toEqual(donors.slice().sort());
    }
  );

  test('O- is the universal donor and AB+ the universal recipient', () => {
    expect(compatibility.canDonateTo('O-').sort()).toEqual(BLOOD_GROUPS.slice().sort());
    expect(compatibility.compatibleDonorsFor('AB+').sort()).toEqual(BLOOD_GROUPS.slice().sort());
    expect(compatibility.canDonateTo('AB+')).toEqual(['AB+']);
    expect(compatibility.compatibleDonorsFor('O-')).toEqual(['O-']);
  });

  test('the two directions are exact transposes of each other', () => {
    for (const donor of BLOOD_GROUPS) {
      for (const recipient of BLOOD_GROUPS) {
        expect(compatibility.canDonateTo(donor).includes(recipient))
          .toBe(compatibility.compatibleDonorsFor(recipient).includes(donor));
      }
    }
  });

  test('rankSubstitutes puts the exact match first, then preserves rare stock', () => {
    // AB+ recipient, no AB+ on the shelf.
    const inventory = { 'O-': 10, 'O+': 10, 'A+': 10, 'AB+': 0, 'B+': 4 };
    const result = compatibility.rankSubstitutes(inventory, 'AB+', 2);

    expect(result.exactAvailable).toBe(false);
    expect(result.shortfall).toBe(2);
    // O- is the scarcest and must not be the first suggestion.
    expect(result.options[0].bloodGroup).not.toBe('O-');
    expect(result.options[result.options.length - 1].bloodGroup).toBe('O-');
    for (const o of result.options) {
      expect(compatibility.compatibleDonorsFor('AB+')).toContain(o.bloodGroup);
    }
  });

  test('rankSubstitutes surfaces the exact match when it is in stock', () => {
    const result = compatibility.rankSubstitutes({ 'A+': 8, 'O+': 3 }, 'A+', 2);
    expect(result.exactAvailable).toBe(true);
    expect(result.options[0].bloodGroup).toBe('A+');
    expect(result.options[0].isExactMatch).toBe(true);
  });

  test('never offers an incompatible group', () => {
    const full = Object.fromEntries(BLOOD_GROUPS.map((g) => [g, 5]));
    for (const recipient of BLOOD_GROUPS) {
      const { options } = compatibility.rankSubstitutes(full, recipient, 1);
      for (const o of options) {
        expect(compatibility.isCompatible(o.bloodGroup, recipient)).toBe(true);
      }
    }
  });

  test('rejects an unknown blood group rather than guessing', () => {
    expect(() => compatibility.compatibleDonorsFor('C+')).toThrow(/Unknown blood group/);
  });
});

describe('56-day eligibility (Doc 2 section 5.3)', () => {
  test('a donor who has never donated is eligible', () => {
    const e = eligibility.getEligibility(null);
    expect(e.eligible).toBe(true);
    expect(e.nextEligibleDate).toBeNull();
    expect(e.daysRemaining).toBe(0);
  });

  test('next eligible date is exactly last + 56 days', () => {
    const last = new Date('2026-01-01T10:00:00Z');
    const e = eligibility.getEligibility(last, new Date('2026-01-02T10:00:00Z'));
    const gap = Math.round((e.nextEligibleDate - last) / 86400000);
    expect(gap).toBe(56);
  });

  test('mid-window donor is ineligible with the right day count', () => {
    const now = new Date('2026-03-01T12:00:00Z');
    const e = eligibility.getEligibility(addDays(now, -10), now);
    expect(e.eligible).toBe(false);
    expect(e.daysRemaining).toBe(46);
  });

  test('becomes eligible exactly on day 56, not 57', () => {
    const now = new Date('2026-03-01T12:00:00Z');
    expect(eligibility.getEligibility(addDays(now, -56), now).eligible).toBe(true);
    expect(eligibility.getEligibility(addDays(now, -55), now).eligible).toBe(false);
  });

  test('day count does not drift with the time of day (UTC boundaries)', () => {
    const last = new Date('2026-01-01T23:59:00Z');
    const morning = eligibility.getEligibility(last, new Date('2026-01-10T00:01:00Z'));
    const evening = eligibility.getEligibility(last, new Date('2026-01-10T23:58:00Z'));
    expect(morning.daysRemaining).toBe(evening.daysRemaining);
  });
});

describe('Request status machine (plan decision D-1)', () => {
  test('rejects pending -> fulfilled, the case Doc 4 section 4.1 names', () => {
    const v = lifecycle.canTransition('pending', 'fulfilled', 'blood-bank');
    expect(v.ok).toBe(false);
    expect(v.status).toBe(409);
    expect(v.reason).toMatch(/Invalid status transition/);
  });

  test('allows the full legal chain', () => {
    const chain = ['pending', 'under_review', 'approved', 'dispatched', 'fulfilled'];
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(lifecycle.canTransition(chain[i], chain[i + 1], 'blood-bank').ok).toBe(true);
    }
  });

  test('rejection is reachable from the first three states only', () => {
    expect(lifecycle.canTransition('pending', 'rejected', 'blood-bank').ok).toBe(true);
    expect(lifecycle.canTransition('under_review', 'rejected', 'blood-bank').ok).toBe(true);
    expect(lifecycle.canTransition('approved', 'rejected', 'blood-bank').ok).toBe(true);
    expect(lifecycle.canTransition('dispatched', 'rejected', 'blood-bank').ok).toBe(false);
  });

  test('terminal states cannot move again', () => {
    for (const terminal of ['fulfilled', 'rejected', 'cancelled']) {
      expect(lifecycle.canTransition(terminal, 'approved', 'admin').ok).toBe(false);
      expect(lifecycle.nextStatuses(terminal)).toEqual([]);
    }
  });

  test('only the requester may cancel, and only while pending or under review', () => {
    expect(lifecycle.canTransition('pending', 'cancelled', 'hospital', { isRequester: true }).ok)
      .toBe(true);
    expect(lifecycle.canTransition('pending', 'cancelled', 'hospital', { isRequester: false }).ok)
      .toBe(false);
    expect(lifecycle.canTransition('approved', 'cancelled', 'hospital', { isRequester: true }).ok)
      .toBe(false);
  });

  test('a donor cannot approve a request', () => {
    const v = lifecycle.canTransition('under_review', 'approved', 'donor');
    expect(v.ok).toBe(false);
    expect(v.status).toBe(403);
  });

  test('every status in the graph is reachable from pending', () => {
    const seen = new Set(['pending']);
    const queue = ['pending'];
    while (queue.length) {
      for (const next of lifecycle.nextStatuses(queue.shift())) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(7);
  });

  test('the stepper reports 5 steps and marks the current one', () => {
    const stepper = lifecycle.buildStepper({
      status: 'approved',
      statusHistory: [
        { status: 'pending', at: new Date('2026-01-01') },
        { status: 'under_review', at: new Date('2026-01-02') },
        { status: 'approved', at: new Date('2026-01-03') },
      ],
    });
    expect(stepper.steps).toHaveLength(5);
    expect(stepper.steps[0].label).toBe('Submitted');
    expect(stepper.steps.filter((s) => s.complete)).toHaveLength(2);
    expect(stepper.steps.find((s) => s.current).status).toBe('approved');
    expect(stepper.isTerminal).toBe(false);
  });

  test('a rejected request branches off the line rather than continuing along it', () => {
    const stepper = lifecycle.buildStepper({
      status: 'rejected',
      statusHistory: [{ status: 'pending', at: new Date() }, { status: 'rejected', at: new Date() }],
    });
    expect(stepper.derailed).toBe(true);
    expect(stepper.derailedAs).toBe('rejected');
    expect(stepper.steps.some((s) => s.current)).toBe(false);
  });
});
