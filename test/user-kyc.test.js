const { app, request, createUser, asUser } = require('./helpers/factory');
const User = require('../src/models/User.model');
const settings = require('../src/services/settings.service');

const individualKyc = {
  userType: 'individual', name: 'Asha Rao', phone: '9876543210',
  email: 'asha@example.com', panNumber: 'ABCDE1234F', aadhaarNumber: '234567890123',
};
const vendorKyc = {
  userType: 'vendor', companyName: 'Rao Devices', phone: '9876543211',
  email: 'vendor@example.com', panNumber: 'ZYXWV9876K', gstNumber: '22AAAAA0000A1Z5',
};

describe('complete-kyc', () => {
  it('rejects an individual without a verified Aadhaar', async () => {
    const { token } = await createUser();
    const res = await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);
    expect(res.status).toBe(400);
  });

  it('completes for an individual whose Aadhaar is verified', async () => {
    const { hashAadhaar } = require('../src/utils/hash.util');
    const { user, token } = await createUser();
    await User.findByIdAndUpdate(user._id, {
      aadhaarVerified: true,
      aadhaarNumberHash: hashAadhaar('234567890123', user._id),
    });

    const res = await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);
    expect(res.status).toBe(200);
    expect(res.body.data.user.kycCompleted).toBe(true);
  });

  it('rejects a mismatched Aadhaar', async () => {
    const { hashAadhaar } = require('../src/utils/hash.util');
    const { user, token } = await createUser();
    await User.findByIdAndUpdate(user._id, {
      aadhaarVerified: true, aadhaarNumberHash: hashAadhaar('999999999999', user._id),
    });
    const res = await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);
    expect(res.status).toBe(400);
  });

  it('requires companyName, gstNumber and an owner image for a vendor', async () => {
    const { token } = await createUser();
    const res = await asUser(token).post('/api/v1/user/complete-kyc').send(vendorKyc);
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toContain('profileImage');
  });

  it('rejects a malformed PAN', async () => {
    const { token } = await createUser();
    const res = await asUser(token).post('/api/v1/user/complete-kyc')
      .send({ ...individualKyc, panNumber: 'NOPE' });
    expect(res.status).toBe(422);
  });

  it('409s if KYC is already complete', async () => {
    const { user, token } = await createUser({ kycCompleted: true });
    expect(user.kycCompleted).toBe(true);
    const res = await asUser(token).post('/api/v1/user/complete-kyc').send(individualKyc);
    expect(res.status).toBe(409);
  });
});

describe('kycRequired switch off', () => {
  beforeEach(async () => { await settings.update({ kycRequired: false }); });

  it('accepts an empty body', async () => {
    const { token } = await createUser();
    const res = await asUser(token).post('/api/v1/user/complete-kyc').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.user.userType).toBe('individual');
  });

  it('still rejects malformed values', async () => {
    const { token } = await createUser();
    const res = await asUser(token).post('/api/v1/user/complete-kyc').send({ panNumber: 'NOPE' });
    expect(res.status).toBe(422);
  });

  it('allows skip-kyc', async () => {
    const { token } = await createUser();
    const res = await asUser(token).post('/api/v1/user/skip-kyc');
    expect(res.status).toBe(200);
    expect(res.body.data.user.kycCompleted).toBe(true);
  });
});

describe('skip-kyc while KYC is required', () => {
  it('is forbidden', async () => {
    const { token } = await createUser();
    const res = await asUser(token).post('/api/v1/user/skip-kyc');
    expect(res.status).toBe(403);
  });
});

describe('profile', () => {
  it('updates name and email', async () => {
    const { token } = await createUser();
    const res = await asUser(token).put('/api/v1/user/update-profile')
      .field('name', 'New Name').field('email', 'new@example.com');
    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe('New Name');
  });

  it('never exposes the storage public id', async () => {
    const { token } = await createUser();
    const res = await asUser(token).get('/api/v1/user/profile');
    expect(res.body.data.user.profileImagePublicId).toBeUndefined();
  });
});

describe('account deletion', () => {
  it('soft deletes, wipes personal fields and keeps the mobile', async () => {
    const { user, token } = await createUser({
      name: 'Gone', email: 'gone@example.com', panNumber: 'PANXX1234Z', kycCompleted: true,
    });
    const mobile = user.mobile;

    const res = await asUser(token).delete('/api/v1/user/account');
    expect(res.status).toBe(200);

    const after = await User.findById(user._id).lean();
    expect(after.status).toBe('DELETED');
    expect(after.name).toBeNull();
    expect(after.email).toBeUndefined();
    expect(after.panNumber).toBeUndefined();
    expect(after.kycCompleted).toBe(false);
    expect(after.mobile).toBe(mobile);        // kept, so sign-in restores
  });

  it('rejects the old token afterwards', async () => {
    const { token } = await createUser();
    await asUser(token).delete('/api/v1/user/account');
    const res = await asUser(token).get('/api/v1/user/profile');
    expect(res.status).toBe(401);
  });

  it('restores the same account on next sign-in, balance intact', async () => {
    const userService = require('../src/services/user.service');
    const walletService = require('../src/services/wallet.service');
    const { user, token } = await createUser();
    await walletService.credit(user._id, 120, { reason: 'ADJUSTMENT' });

    await asUser(token).delete('/api/v1/user/account');
    const restored = await userService.findOrCreateUserByMobile('+91', user.mobile);

    expect(restored.user._id.toString()).toBe(user._id.toString());
    expect(restored.isRestored).toBe(true);
    expect(await walletService.getBalance(user._id)).toBe(120);
  });
});
