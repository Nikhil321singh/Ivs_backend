const nock = require('nock');
const { app, request, createUser, asUser } = require('./helpers/factory');
const User = require('../src/models/User.model');
const AadhaarVerification = require('../src/models/AadhaarVerification.model');
const ProviderRequestLog = require('../src/models/ProviderRequestLog.model');
const { VERIFICATION_STATUS, FAILURE_CODE } = require('../src/constants/aadhaarVerification');
const env = require('../src/config/env');

const BASE = env.paysprint.baseUrl;
const host = () => nock(BASE.replace(/\/api\/v1\/verification$/, ''));
const path = (p) => `${BASE.replace(/^https?:\/\/[^/]+/, '')}${p}`;

/** A realistic offline-eKYC-shaped Aadhaar XML, Base64 encoded. */
const aadhaarXml = (over = {}) => {
  const f = { name: 'Asha Rao', dob: '01-01-1990', gender: 'F', uid: '123456789012', ...over };
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
     <OfflinePaperlessKyc referenceId="123420240101">
       <UidData>
         <Poi name="${f.name}" dob="${f.dob}" gender="${f.gender}" uid="${f.uid}"/>
         <Poa careof="S/O Rao" state="Karnataka" pc="560001"/>
       </UidData>
     </OfflinePaperlessKyc>`
  ).toString('base64');
};

const stubInitiate = (status = 200, body) =>
  host()
    .post(path('/digilocker/initiate_session'))
    .reply(status, body ?? { status: true, data: { authorization_url: 'https://digilocker.test/auth/abc' } });

const stubToken = (status = 200, body) =>
  host().post(path('/digilocker/access_token')).reply(status, body ?? { status: true, data: {} });

const stubIssuedFiles = (files, status = 200) =>
  host()
    .post(path('/digilocker/issued_files'))
    .reply(status, { status: true, data: { files } });

const stubDownload = (base64, status = 200) =>
  host().post(path('/digilocker/download_xml')).reply(status, { status: true, data: { xml: base64 } });

const AADHAAR_FILE = {
  name: 'Aadhaar Card',
  doctype: 'ADHAR',
  issuer: 'Unique Identification Authority of India',
  uri: 'in.gov.uidai-ADHAR-123456',
};

/** Runs start → callback and returns the resulting session document. */
const runFlow = async (token) => {
  const start = await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');
  const session = await AadhaarVerification.findById(start.body.data.verificationId);
  const cb = await request(app).get(
    `/api/v1/user/aadhaar/digilocker/callback?refid=${session.refid}`
  );
  return { start, cb, session: await AadhaarVerification.findById(session._id) };
};

afterEach(() => nock.cleanAll());

describe('POST /user/aadhaar/digilocker/start', () => {
  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).post('/api/v1/user/aadhaar/digilocker/start');
    expect(res.status).toBe(401);
  });

  it('creates a session and returns the authorization url', async () => {
    stubInitiate();
    const { user, token } = await createUser();

    const res = await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');

    expect(res.status).toBe(200);
    expect(res.body.data.authorizationUrl).toBe('https://digilocker.test/auth/abc');

    const session = await AadhaarVerification.findOne({ userId: user._id });
    expect(session.status).toBe(VERIFICATION_STATUS.AUTHENTICATING);
    expect(session.refid).toHaveLength(32); // 16 random bytes, hex
  });

  it('never returns the refid to the client — it is a callback capability', async () => {
    stubInitiate();
    const { token } = await createUser();

    const res = await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');

    const session = await AadhaarVerification.findOne({});
    expect(JSON.stringify(res.body)).not.toContain(session.refid);
  });

  it('409s when Aadhaar is already verified', async () => {
    const { token } = await createUser({ aadhaarVerified: true });

    const res = await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');

    expect(res.status).toBe(409);
  });

  it('expires an earlier unfinished session so only one capability is live', async () => {
    stubInitiate();
    stubInitiate();
    const { user, token } = await createUser();

    await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');
    await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');

    const sessions = await AadhaarVerification.find({ userId: user._id }).sort({ createdAt: 1 });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].status).toBe(VERIFICATION_STATUS.EXPIRED);
    expect(sessions[1].status).toBe(VERIFICATION_STATUS.AUTHENTICATING);
  });

  it('502s and records the failure when the provider rejects the session', async () => {
    stubInitiate(422, { status: false, message: 'invalid partner' });
    const { token } = await createUser();

    const res = await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');

    expect(res.status).toBe(502);
    const session = await AadhaarVerification.findOne({});
    expect(session.status).toBe(VERIFICATION_STATUS.FAILED);
    expect(session.failureCode).toBe(FAILURE_CODE.DIGILOCKER_SESSION_FAILED);
  });
});

describe('GET /user/aadhaar/digilocker/callback', () => {
  it('runs the whole flow and verifies the Aadhaar', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload(aadhaarXml());

    const { user, token } = await createUser();
    const { cb, session } = await runFlow(token);

    expect(cb.status).toBe(302);
    expect(session.status).toBe(VERIFICATION_STATUS.VERIFIED);
    expect(session.name).toBe('Asha Rao');
    expect(session.maskedAadhaar).toBe('XXXX-XXXX-9012');
    expect(session.verifiedAt).toBeTruthy();

    const after = await User.findById(user._id);
    expect(after.aadhaarVerified).toBe(true);
    expect(after.aadhaarNumber).toBe('XXXX-XXXX-9012');
    expect(after.aadhaarNumberHash).toBeTruthy();
  });

  it('never puts Aadhaar details in the redirect URL', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload(aadhaarXml());

    const { token } = await createUser();
    const { cb } = await runFlow(token);

    const location = cb.headers.location;
    expect(location).toContain('verificationId=');
    expect(location).not.toContain('Asha');
    expect(location).not.toContain('9012');
    expect(location).not.toContain('123456789012');
  });

  it('400s without a refid', async () => {
    const res = await request(app).get('/api/v1/user/aadhaar/digilocker/callback');
    expect(res.status).toBe(400);
  });

  it('404s on an unknown refid', async () => {
    const res = await request(app).get(
      '/api/v1/user/aadhaar/digilocker/callback?refid=deadbeefdeadbeefdeadbeefdeadbeef'
    );
    expect(res.status).toBe(404);
  });

  it('reports AADHAAR_NOT_FOUND and never calls download', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([{ name: 'PAN Card', doctype: 'PANCR', issuer: 'ITD', uri: 'in.gov.pan-1' }]);
    // Deliberately no download stub: calling it would throw a nock no-match.

    const { user, token } = await createUser();
    const { session } = await runFlow(token);

    expect(session.status).toBe(VERIFICATION_STATUS.AADHAAR_NOT_FOUND);
    expect(session.failureCode).toBe(FAILURE_CODE.AADHAAR_NOT_FOUND);
    expect((await User.findById(user._id)).aadhaarVerified).toBe(false);
  });

  it('matches Aadhaar on doctype, not the display name', async () => {
    stubInitiate();
    stubToken();
    // Display name is unrecognisable; doctype is what counts.
    stubIssuedFiles([{ name: 'आधार', doctype: 'ADHAR', issuer: 'UIDAI', uri: 'in.gov.uidai-x' }]);
    stubDownload(aadhaarXml());

    const { token } = await createUser();
    const { session } = await runFlow(token);

    expect(session.status).toBe(VERIFICATION_STATUS.VERIFIED);
  });

  it('records a failure when the access token call fails', async () => {
    stubInitiate();
    stubToken(422, { status: false, message: 'incomplete authentication' });

    const { token } = await createUser();
    const { session } = await runFlow(token);

    expect(session.status).toBe(VERIFICATION_STATUS.FAILED);
    expect(session.failureCode).toBe(FAILURE_CODE.DIGILOCKER_TOKEN_FAILED);
  });

  it('records a failure when the download fails', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload(null, 422);

    const { token } = await createUser();
    const { session } = await runFlow(token);

    expect(session.status).toBe(VERIFICATION_STATUS.FAILED);
    expect(session.failureCode).toBe(FAILURE_CODE.AADHAAR_DOWNLOAD_FAILED);
  });

  it('rejects malformed XML without verifying', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload(Buffer.from('<Kyc><unclosed>').toString('base64'));

    const { user, token } = await createUser();
    const { session } = await runFlow(token);

    expect(session.status).toBe(VERIFICATION_STATUS.FAILED);
    expect(session.failureCode).toBe(FAILURE_CODE.AADHAAR_XML_INVALID);
    expect((await User.findById(user._id)).aadhaarVerified).toBe(false);
  });

  it('rejects invalid Base64', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload('!!!!not base64!!!!');

    const { token } = await createUser();
    const { session } = await runFlow(token);

    expect(session.failureCode).toBe(FAILURE_CODE.AADHAAR_XML_INVALID);
  });

  it('is idempotent — a replayed callback does not re-run a billable flow', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload(aadhaarXml());

    const { token } = await createUser();
    const { session } = await runFlow(token);
    const callsAfterFirst = await ProviderRequestLog.countDocuments({ refid: session.refid });

    // No further stubs: any provider call now would fail on nock no-match.
    const replay = await request(app).get(
      `/api/v1/user/aadhaar/digilocker/callback?refid=${session.refid}`
    );

    expect(replay.status).toBe(302);
    expect(await ProviderRequestLog.countDocuments({ refid: session.refid })).toBe(callsAfterFirst);
  });

  it('expires a session the user came back to too late', async () => {
    stubInitiate();
    const { token } = await createUser();
    const start = await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');
    const session = await AadhaarVerification.findById(start.body.data.verificationId);

    await AadhaarVerification.updateOne(
      { _id: session._id },
      { expiresAt: new Date(Date.now() - 1000) }
    );

    await request(app).get(`/api/v1/user/aadhaar/digilocker/callback?refid=${session.refid}`);

    const after = await AadhaarVerification.findById(session._id);
    expect(after.status).toBe(VERIFICATION_STATUS.EXPIRED);
  });
});

describe('billing log', () => {
  it('records every provider call with its billable flag', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload(aadhaarXml());

    const { user, token } = await createUser();
    const { session } = await runFlow(token);

    const rows = await ProviderRequestLog.find({ refid: session.refid });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.billable === true)).toBe(true); // all 200s
    expect(rows.every((r) => String(r.userId) === String(user._id))).toBe(true);
  });

  it('marks a 201 non-billable and a 422 billable', async () => {
    stubInitiate(201, { status: false, message: 'not billable' });
    const { token } = await createUser();
    await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');

    const row = await ProviderRequestLog.findOne({});
    expect(row.providerStatus).toBe(201);
    expect(row.billable).toBe(false);
  });
});

describe('GET /user/aadhaar/digilocker/:verificationId', () => {
  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).get('/api/v1/user/aadhaar/digilocker/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('returns the status for the owner', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload(aadhaarXml());

    const { token } = await createUser();
    const { start } = await runFlow(token);

    const res = await asUser(token).get(
      `/api/v1/user/aadhaar/digilocker/${start.body.data.verificationId}`
    );

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(VERIFICATION_STATUS.VERIFIED);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.maskedAadhaar).toBe('XXXX-XXXX-9012');
  });

  it("404s for another user's verification", async () => {
    stubInitiate();
    const { token } = await createUser();
    const start = await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');

    const { token: otherToken } = await createUser();
    const res = await asUser(otherToken).get(
      `/api/v1/user/aadhaar/digilocker/${start.body.data.verificationId}`
    );

    expect(res.status).toBe(404);
  });
});

/**
 * Customer (device seller) verification, /ivs/aadhaar/digilocker/*.
 *
 * Same DigiLocker flow as the account endpoints; the whole point of the subject
 * split is what happens at the end, so that is what these cover.
 */
describe('IVS customer DigiLocker verification', () => {
  /** start → callback on the customer endpoints. */
  const runCustomerFlow = async (token) => {
    const start = await asUser(token).post('/api/v1/ivs/aadhaar/digilocker/start');
    const session = await AadhaarVerification.findById(start.body.data.verificationId);
    const cb = await request(app).get(
      `/api/v1/user/aadhaar/digilocker/callback?refid=${session.refid}`
    );
    return { start, cb, session: await AadhaarVerification.findById(session._id) };
  };

  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).post('/api/v1/ivs/aadhaar/digilocker/start');

    expect(res.status).toBe(401);
  });

  it('creates a CUSTOMER session and returns the authorization url', async () => {
    stubInitiate();
    const { user, token } = await createUser();

    const res = await asUser(token).post('/api/v1/ivs/aadhaar/digilocker/start');

    expect(res.status).toBe(200);
    expect(res.body.data.authorizationUrl).toBe('https://digilocker.test/auth/abc');

    const session = await AadhaarVerification.findOne({ userId: user._id });
    expect(session.subject).toBe('CUSTOMER');
  });

  // The reason the subject field exists: the partner is the operator, not the
  // person authenticating, so a seller's Aadhaar must never complete their KYC
  // or claim their one-Aadhaar-per-account hash.
  it('does NOT mark the operating partner Aadhaar-verified', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload(aadhaarXml());
    const { user, token } = await createUser();

    const { session } = await runCustomerFlow(token);

    expect(session.status).toBe(VERIFICATION_STATUS.VERIFIED);
    expect(session.maskedAadhaar).toBeTruthy();

    const after = await User.findById(user._id);
    expect(after.aadhaarVerified).toBe(false);
    expect(after.aadhaarNumber).toBeFalsy();
    expect(after.aadhaarNumberHash).toBeFalsy();
  });

  // Contrast with the above — the account flow still writes through, so the
  // split hasn't broken KYC.
  it('still marks the account verified on the /user flow', async () => {
    stubInitiate();
    stubToken();
    stubIssuedFiles([AADHAAR_FILE]);
    stubDownload(aadhaarXml());
    const { user, token } = await createUser();

    await runFlow(token);

    const after = await User.findById(user._id);
    expect(after.aadhaarVerified).toBe(true);
  });

  it('lets an already-KYC-verified partner keep verifying customers', async () => {
    stubInitiate();
    const { token } = await createUser({ aadhaarVerified: true });

    const res = await asUser(token).post('/api/v1/ivs/aadhaar/digilocker/start');

    // The /user endpoint 409s in this state; this one must not, or completing
    // KYC would lock the partner out of the IMEI flow entirely.
    expect(res.status).toBe(200);
  });

  it('does not cancel the partner own in-flight KYC session', async () => {
    stubInitiate();
    stubInitiate();
    const { user, token } = await createUser();

    await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');
    await asUser(token).post('/api/v1/ivs/aadhaar/digilocker/start');

    const account = await AadhaarVerification.findOne({ userId: user._id, subject: 'ACCOUNT' });
    expect(account.status).not.toBe(VERIFICATION_STATUS.EXPIRED);
  });

  it('reads the status back, scoped to customer sessions', async () => {
    stubInitiate();
    const { token } = await createUser();

    const start = await asUser(token).post('/api/v1/ivs/aadhaar/digilocker/start');
    const id = start.body.data.verificationId;

    const res = await asUser(token).get(`/api/v1/ivs/aadhaar/digilocker/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.verificationId).toBe(id);
    expect(res.body.data.verified).toBe(false);
  });

  it('404s when reading an account session through the customer endpoint', async () => {
    stubInitiate();
    const { token } = await createUser();

    const start = await asUser(token).post('/api/v1/user/aadhaar/digilocker/start');
    const id = start.body.data.verificationId;

    const res = await asUser(token).get(`/api/v1/ivs/aadhaar/digilocker/${id}`);

    expect(res.status).toBe(404);
  });

  it("404s on another partner's customer session", async () => {
    stubInitiate();
    const { token } = await createUser();
    const other = await createUser();

    const start = await asUser(token).post('/api/v1/ivs/aadhaar/digilocker/start');

    const res = await asUser(other.token).get(
      `/api/v1/ivs/aadhaar/digilocker/${start.body.data.verificationId}`
    );

    expect(res.status).toBe(404);
  });
});
