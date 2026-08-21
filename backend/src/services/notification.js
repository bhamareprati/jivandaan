'use strict';

const env = require('../config/env');

/**
 * Urgency-driven notification hook (Doc 2 section 5.4).
 *
 * The dispatch is stubbed behind an interface so a real SMS/push provider can
 * be dropped in at deploy time without touching a controller. Everything here
 * is fire-and-forget by design: a provider outage must never fail the request
 * that triggered it.
 */

/** @typedef {{ sendSms:Function, sendPush:Function, sendEmail:Function, name:string }} NotificationService */

/** Default implementation -- logs to stdout. Swap at boot via setService(). */
const consoleService = {
  name: 'console',
  async sendSms(to, template, data) {
    // eslint-disable-next-line no-console
    console.log(`[notify:sms] -> ${to} [${template}]`, JSON.stringify(data));
    return { delivered: true, channel: 'sms', to, template };
  },
  async sendPush(userId, template, data) {
    // eslint-disable-next-line no-console
    console.log(`[notify:push] -> ${userId} [${template}]`, JSON.stringify(data));
    return { delivered: true, channel: 'push', to: userId, template };
  },
  async sendEmail(to, template, data) {
    // eslint-disable-next-line no-console
    console.log(`[notify:email] -> ${to} [${template}]`, JSON.stringify(data));
    return { delivered: true, channel: 'email', to, template };
  },
};

let service = consoleService;

function setService(impl) {
  service = impl || consoleService;
}

function getService() {
  return service;
}

/** Never let a notification failure propagate into a domain operation. */
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[notify] ${label} failed: ${err.message}`);
    return null;
  }
}

/* ------------------------------------------------------------------ hooks */

/**
 * Fired when a request is created at `critical` urgency.
 *
 * Notifies (a) eligible donors whose group can serve the requested group and
 * (b) verified banks holding compatible stock. Returns a summary for the audit
 * log; callers must NOT await this in a way that can fail the request.
 */
async function onCriticalRequest(request, { donors = [], banks = [] } = {}) {
  const payload = {
    requestId: String(request._id),
    bloodGroup: request.bloodGroup,
    units: request.units,
    urgency: request.urgency,
    hospitalName: request.hospitalName || null,
    patientName: request.patientName || null,
  };

  let donorsNotified = 0;
  let banksNotified = 0;

  await safely('critical-request donor fan-out', async () => {
    await Promise.all(
      donors.map(async (d) => {
        if (d.contact) await service.sendSms(d.contact, 'critical_request_donor', payload);
        await service.sendPush(String(d._id), 'critical_request_donor', payload);
        donorsNotified += 1;
      })
    );
  });

  await safely('critical-request bank fan-out', async () => {
    await Promise.all(
      banks.map(async (b) => {
        if (b.email) await service.sendEmail(b.email, 'critical_request_bank', payload);
        banksNotified += 1;
      })
    );
  });

  return { channel: service.name, donorsNotified, banksNotified, payload };
}

async function onRequestStatusChange(request, recipientContact) {
  return safely('status-change notice', () =>
    service.sendSms(recipientContact, 'request_status_change', {
      requestId: String(request._id),
      status: request.status,
    })
  );
}

async function onBankVerified(bank, decision, reason) {
  return safely('bank verification notice', () =>
    service.sendEmail(bank.email, 'bank_verification', {
      bankId: String(bank._id),
      name: bank.name,
      decision,
      reason: reason || null,
    })
  );
}

async function onPasswordReset(email, token, role) {
  return safely('password reset', () =>
    service.sendEmail(email, 'password_reset', { token, role })
  );
}

async function onLowStock(bank, groups) {
  return safely('low stock alert', () =>
    service.sendEmail(bank.email, 'low_stock', { bankId: String(bank._id), groups })
  );
}

module.exports = {
  consoleService,
  setService,
  getService,
  onCriticalRequest,
  onRequestStatusChange,
  onBankVerified,
  onPasswordReset,
  onLowStock,
  providerConfigured: Boolean(env.SMS_PROVIDER_KEY),
};
