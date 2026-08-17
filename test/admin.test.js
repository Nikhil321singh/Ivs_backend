const { app, request, createAdmin, createUser, createFundedUser, asUser } = require('./helpers/factory');
const { stubCdot } = require('./helpers/providers');
const settings = require('../src/services/settings.service');

const asAdmin = (token) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${token}`),
  patch: (p) => request(app).patch(p).set('Authorization', `Bearer ${token}`),
});

describe('admin auth', () => {
  it('signs in with the right password', async () => {
    const { token } = await createAdmin();
    expect(token).toBeTruthy();
  });

  it('never returns the password hash', async () => {
    const { admin, password } = await createAdmin();
    const res = await request(app).post('/api/v1/admin/login').send({ email: admin.email, password });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { admin, password } = await createAdmin();
    const wrongPass = await request(app).post('/api/v1/admin/login').send({ email: admin.email, password: 'nope' });
    const noSuchUser = await request(app).post('/api/v1/admin/login').send({ email: 'ghost@test.local', password });

    expect(wrongPass.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPass.body.message).toBe(noSuchUser.body.message);   // no enumeration
  });

  it('rejects an unauthenticated request', async () => {
    expect((await request(app).get('/api/v1/admin/settings')).status).toBe(401);
  });

  it('rejects a normal user token on admin routes', async () => {
    const { token } = await createUser();
    const res = await request(app).get('/api/v1/admin/settings').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('revokes access as soon as the admin is deactivated', async () => {
    const { admin, token } = await createAdmin();
    const Admin = require('../src/admin/models/Admin.model');
    await Admin.findByIdAndUpdate(admin._id, { isActive: false });

    const res = await asAdmin(token).get('/api/v1/admin/me');
    expect(res.status).toBe(403);
  });
});

describe('admin settings', () => {
  it('returns values plus definitions for the UI', async () => {
    const { token } = await createAdmin();
    const res = await asAdmin(token).get('/api/v1/admin/settings');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.definitions)).toEqual(
      expect.arrayContaining(['aadhaarVerificationEnabled', 'kycRequired', 'ivsCheckCost'])
    );
  });

  it('rejects an unknown key', async () => {
    const { token } = await createAdmin();
    const res = await asAdmin(token).patch('/api/v1/admin/settings').send({ nonsense: true });
    expect(res.status).toBe(422);
  });

  it('rejects a wrong type', async () => {
    const { token } = await createAdmin();
    const res = await asAdmin(token).patch('/api/v1/admin/settings').send({ kycRequired: 'yes' });
    expect(res.status).toBe(422);
  });

  it('rejects a non-integer or out-of-range price', async () => {
    const { token } = await createAdmin();
    expect((await asAdmin(token).patch('/api/v1/admin/settings').send({ ivsCheckCost: 'abc' })).status).toBe(422);
    expect((await asAdmin(token).patch('/api/v1/admin/settings').send({ ivsCheckCost: -5 })).status).toBe(422);
  });

  it('applies a toggle immediately', async () => {
    const { token } = await createAdmin();
    const res = await asAdmin(token).patch('/api/v1/admin/settings').send({ aadhaarVerificationEnabled: false });

    expect(res.status).toBe(200);
    expect(await settings.isAadhaarVerificationEnabled()).toBe(false);
  });
});

describe('admin data views', () => {
  it('lists wallet transactions', async () => {
    const { token } = await createAdmin();
    const res = await asAdmin(token).get('/api/v1/admin/transactions?page=1&limit=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('lists IMEI checks made by users', async () => {
    const { token: userToken } = await createFundedUser(500);
    stubCdot('355301083783251', 'non-blocked');
    await asUser(userToken).post('/api/v1/ivs/verify').send({ imei1: '355301083783251' });

    const { token } = await createAdmin();
    const res = await asAdmin(token).get('/api/v1/admin/imei-checks');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].imei1).toBe('355301083783251');
  });

  it('returns dashboard counters', async () => {
    await createUser({ kycCompleted: true });
    const { token } = await createAdmin();
    const res = await asAdmin(token).get('/api/v1/admin/stats');

    expect(res.status).toBe(200);
    expect(typeof res.body.data.totalUsers).toBe('number');
    expect(res.body.data.kycCompleted).toBeGreaterThanOrEqual(1);
  });
});
