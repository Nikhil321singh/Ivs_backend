const { app, request, uniqueMobile, createUser } = require('./helpers/factory');
const { stubMsg91Success, stubMsg91Failure } = require('./helpers/providers');
const Otp = require('../src/models/Otp.model');
const User = require('../src/models/User.model');
const Wallet = require('../src/models/Wallet.model');

const send = (mobile) => request(app).post('/api/v1/auth/send-otp').send({ mobile, countryCode: '+91' });
const verify = (mobile, otp, deviceId = 'test-device', extra = {}) =>
  request(app).post('/api/v1/auth/verify-otp').send({ mobile, countryCode: '+91', otp, deviceId, ...extra });

describe('auth', () => {
  it('sends an OTP via MSG91 and stores only a hash', async () => {
    const mobile = uniqueMobile();
    stubMsg91Success();

    const res = await send(mobile);

    expect(res.status).toBe(200);
    const row = await Otp.findOne({ mobile });
    expect(row).toBeTruthy();
    expect(row.otpHash).toHaveLength(64);       // sha256 hex
    expect(JSON.stringify(row)).not.toContain('otp"');
  });

  it('surfaces a provider failure as 400, not 500', async () => {
    stubMsg91Failure('invalid number');
    const res = await send(uniqueMobile());
    expect(res.status).toBe(400);
  });

  it('rejects a malformed mobile number', async () => {
    const res = await request(app).post('/api/v1/auth/send-otp').send({ mobile: '12345' });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('mobile');
  });

  it('rejects a wrong OTP', async () => {
    const mobile = uniqueMobile();
    stubMsg91Success();
    await send(mobile);

    const res = await verify(mobile, '000000');
    expect(res.status).toBe(400);
  });

  it('signs in with the correct OTP, creating the user and its signup bonus', async () => {
    const mobile = uniqueMobile();
    stubMsg91Success();
    await send(mobile);

    // Read the OTP the only way a test legitimately can: regenerate the hash.
    const crypto = require('crypto');
    const row = await Otp.findOne({ mobile });
    let otp = null;
    for (let i = 0; i < 1000000 && !otp; i += 1) {
      const candidate = String(i).padStart(6, '0');
      if (crypto.createHash('sha256').update(candidate).digest('hex') === row.otpHash) otp = candidate;
    }
    expect(otp).toBeTruthy();

    const res = await verify(mobile, otp);
    expect([200, 201]).toContain(res.status);

    const user = await User.findOne({ mobile });
    expect(user).toBeTruthy();
    const wallet = await Wallet.findOne({ userId: user._id });
    expect(wallet.balance).toBe(100);           // signup bonus
  });

  it('consumes the OTP so it cannot be replayed', async () => {
    const mobile = uniqueMobile();
    stubMsg91Success();
    await send(mobile);
    await Otp.findOneAndUpdate({ mobile }, { otpHash: require('crypto').createHash('sha256').update('123456').digest('hex') });

    const first = await verify(mobile, '123456');
    expect([200, 201]).toContain(first.status);

    const replay = await verify(mobile, '123456');
    expect(replay.status).toBe(400);
  });

  it('requires a token on protected routes', async () => {
    const res = await request(app).get('/api/v1/user/profile');
    expect(res.status).toBe(401);
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).get('/api/v1/user/profile').set('Authorization', 'Bearer nonsense');
    expect(res.status).toBe(401);
  });

  it('returns the profile for a valid token', async () => {
    const { token } = await createUser();
    const res = await request(app).get('/api/v1/user/profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toBeTruthy();
  });
});
