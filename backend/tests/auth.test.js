'use strict';

const { api, withAuth, makeDonor, makeBank, makeAdmin } = require('./helpers');

describe('Auth & RBAC (Doc 4 section 4.1)', () => {
  beforeEach(async () => {
    await global.resetDb();
  });

  test('registers all four roles (admin by seed, not by endpoint)', async () => {
    const donor = await makeDonor();
    const bank = await makeBank();
    const admin = await makeAdmin();

    expect(donor.token).toBeTruthy();
    expect(bank.token).toBeTruthy();
    expect(admin.token).toBeTruthy();

    const hospital = await api().post('/api/auth/register').send({
      role: 'hospital', name: 'Test Hospital', email: 'h@test.in', password: 'Passw0rd!',
      contact: '02011112222', address: '1 Rd', city: 'Pune',
      state: 'Maharashtra', pincode: '411001',
    });
    expect(hospital.status).toBe(201);
  });

  test('refuses to register an admin through the public endpoint', async () => {
    const res = await api().post('/api/auth/register').send({
      role: 'admin', name: 'Test Admin', email: 'x@test.in', password: 'Passw0rd!',
    });
    expect([403, 422]).toContain(res.status);
  });

  test('rejects a duplicate email across DIFFERENT collections', async () => {
    const donor = await makeDonor();

    const res = await api().post('/api/auth/register').send({
      role: 'blood-bank', name: 'Clash', email: donor.email, password: 'Passw0rd!',
      contact: '02011112222', address: '1 Rd', city: 'Pune',
      state: 'Maharashtra', pincode: '411001',
    });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  test('never serialises the password field', async () => {
    const donor = await makeDonor();
    expect(donor.user.password).toBeUndefined();

    const me = await withAuth(api().get('/api/donors/me'), donor.token);
    expect(JSON.stringify(me.body)).not.toMatch(/\$2[aby]\$/);
  });

  test('login returns the same message for unknown email and wrong password', async () => {
    const donor = await makeDonor();

    const wrongPass = await api().post('/api/auth/login')
      .send({ email: donor.email, password: 'Nope12345!', role: 'donor' });
    const noUser = await api().post('/api/auth/login')
      .send({ email: 'ghost@test.in', password: 'Nope12345!', role: 'donor' });

    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPass.body.message).toBe(noUser.body.message);
  });

  test('protected routes reject a missing or invalid token with 401', async () => {
    expect((await api().get('/api/donors/me')).status).toBe(401);
    expect((await withAuth(api().get('/api/donors/me'), 'garbage')).status).toBe(401);
  });

  test('a donor token cannot reach admin-only routes (403)', async () => {
    const donor = await makeDonor();
    for (const url of ['/api/admin/metrics', '/api/admin/logs', '/api/admin/banks/pending']) {
      const res = await withAuth(api().get(url), donor.token);
      expect(res.status).toBe(403);
    }
  });

  test('validation failures return 422 with field-keyed errors', async () => {
    const res = await api().post('/api/auth/register')
      .send({ role: 'donor', name: 'A', email: 'bad', password: '123' });

    expect(res.status).toBe(422);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors[0]).toHaveProperty('field');
    expect(res.body.errors[0]).toHaveProperty('message');
  });

  test('password reset token is single-use and invalidates old tokens', async () => {
    const donor = await makeDonor();

    const forgot = await api().post('/api/auth/forgot-password')
      .send({ email: donor.email, role: 'donor' });
    expect(forgot.status).toBe(200);
    const token = forgot.body.data.resetToken;

    const reset = await api().post('/api/auth/reset-password')
      .send({ token, role: 'donor', newPassword: 'BrandNew1!' });
    expect(reset.status).toBe(200);

    const reuse = await api().post('/api/auth/reset-password')
      .send({ token, role: 'donor', newPassword: 'Another1!' });
    expect(reuse.status).toBe(422);

    // The pre-reset token must stop working.
    const stale = await withAuth(api().get('/api/donors/me'), donor.token);
    expect(stale.status).toBe(401);

    const login = await api().post('/api/auth/login')
      .send({ email: donor.email, password: 'BrandNew1!', role: 'donor' });
    expect(login.status).toBe(200);
  });

  test('forgot-password does not reveal whether an account exists', async () => {
    const real = await makeDonor();
    const a = await api().post('/api/auth/forgot-password')
      .send({ email: real.email, role: 'donor' });
    const b = await api().post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.in', role: 'donor' });

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.message).toBe(b.body.message);
  });

  test('health check reports a connected database', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.db).toBe('connected');
  });

  test('unknown routes return the standard envelope, not HTML', async () => {
    const res = await api().get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe('string');
  });
});
