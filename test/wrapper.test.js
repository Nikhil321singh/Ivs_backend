const nock = require('nock');
const { app, request } = require('./helpers/factory');
const ProviderRequestLog = require('../src/models/ProviderRequestLog.model');
const { PROVIDER_OPERATION } = require('../src/constants/aadhaarVerification');
const env = require('../src/config/env');

const BASE = env.paysprint.baseUrl;
const host = () => nock(BASE.replace(/\/api\/v1\/verification$/, ''));
const path = (p) => `${BASE.replace(/^https?:\/\/[^/]+/, '')}${p}`;

const ENDPOINT = '/api/v1/wrapper/digilocker/initiate';
const REDIRECT_URL = 'https://caller.test/digilocker/callback';

/**
 * The refid format the Lambda caller sends: base64(partnerId + base64(mobile)),
 * base64ed again. Deterministic per mobile by construction — which is the whole
 * point of the collision case below.
 */
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const buildRefid = (mobile, { padded = false } = {}) => {
  const raw = b64(b64(`CORP00002424${b64(mobile)}`));
  return padded ? raw : raw.replace(/=+$/, '');
};

const initiate = (body) => request(app).post(ENDPOINT).send(body);

afterEach(() => nock.cleanAll());

describe('wrapper initiate — refid collision', () => {
  /**
   * The provider refuses a refid it has already issued a session for, and says
   * so with a 201 rather than a 4xx. Because the caller's refid is derived from
   * the mobile alone, its second attempt for the same user always lands here.
   *
   * What matters is that the wrapper does not flatten this into a generic
   * failure: the caller is a server we operate, and it can only tell a spent
   * refid apart from an outage by reading the provider's own status back.
   */
  it('surfaces a rejected refid as a 502 carrying the provider status and message', async () => {
    const refid = buildRefid('9971732962');
    stubInitiateRejection();

    const res = await initiate({ refid, redirect_url: REDIRECT_URL });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.data.refid).toBe(refid);
    expect(res.body.data.providerStatus).toBe(201);
    expect(res.body.data.providerMessage).toBe('Please provide unique reference number.');
  });

  /**
   * 201 is outside BILLABLE_STATUSES, so a collision must be recorded as a call
   * that happened and cost nothing. Getting this wrong in either direction
   * corrupts reconciliation against the provider's invoice.
   */
  it('logs the rejected call as non-billable', async () => {
    const refid = buildRefid('9971732962');
    stubInitiateRejection();

    await initiate({ refid, redirect_url: REDIRECT_URL });

    const log = await ProviderRequestLog.findOne({ refid });
    expect(log).not.toBeNull();
    expect(log.operation).toBe(PROVIDER_OPERATION.INITIATE_SESSION);
    expect(log.providerStatus).toBe(201);
    expect(log.billable).toBe(false);
    // No user is involved — the caller is a peer server, and the refid is the
    // only thing tying this row back to its session.
    expect(log.userId).toBeNull();
  });

  /**
   * Same refid, one attempt apart: the first succeeds and the second collides.
   * Written as one test because the pairing is the point — it is the shape of
   * every retry the caller will ever make for an already-seen mobile.
   */
  it('accepts a refid once and rejects the identical one on retry', async () => {
    const refid = buildRefid('9812345678');

    host()
      .post(path('/digilocker/initiate_session'))
      .reply(200, { status: true, data: { authorization_url: 'https://digilocker.test/auth/abc' } });

    const first = await initiate({ refid, redirect_url: REDIRECT_URL });
    expect(first.status).toBe(200);
    expect(first.body.data.authorizationUrl).toBe('https://digilocker.test/auth/abc');

    stubInitiateRejection();

    const second = await initiate({ refid, redirect_url: REDIRECT_URL });
    expect(second.status).toBe(502);
    expect(second.body.data.providerStatus).toBe(201);
  });
});

describe('wrapper initiate — default refid', () => {
  const DEFAULT_REFID = 'UTA5U1VEQXdNREF5TkRJMFQxUnJNMDFVWTNwTmFtc3lUV2M5UFE9PQ==';

  /**
   * A caller that sends no refid gets this fixed one, by request. It is pinned
   * here because it is deliberate and its consequence is severe: the value is
   * already spent with the provider, so the fallback path cannot produce a
   * working session. Anyone reading a 201 in the logs should find this test and
   * know it is the chosen behaviour rather than a regression.
   */
  it('falls back to the fixed refid when the caller sends none', async () => {
    let sent = null;
    host()
      .post(path('/digilocker/initiate_session'), (body) => {
        sent = body;
        return true;
      })
      .reply(201, { status: false, message: 'Please provide unique reference number.' });

    const res = await initiate({ redirect_url: REDIRECT_URL });

    expect(sent).toContain(DEFAULT_REFID);
    expect(res.body.data.refid).toBe(DEFAULT_REFID);
    expect(res.status).toBe(502);
    expect(res.body.data.providerStatus).toBe(201);
  });

  /** A caller-supplied refid still wins over the default. */
  it('prefers a refid the caller supplied', async () => {
    const mine = buildRefid('9812345678');
    host()
      .post(path('/digilocker/initiate_session'))
      .reply(200, { status: true, data: { authorization_url: 'https://digilocker.test/auth/abc' } });

    const res = await initiate({ refid: mine, redirect_url: REDIRECT_URL });

    expect(res.status).toBe(200);
    expect(res.body.data.refid).toBe(mine);
  });
});

describe('wrapper initiate — refid shape', () => {
  /**
   * Input validation was removed from this route, so the refid is relayed
   * exactly as sent. Base64 padding used to be refused here for free; it now
   * reaches the provider, which is what makes this worth pinning — a padded and
   * an unpadded refid are different strings, so they consume two separate
   * single-use references rather than colliding with each other.
   */
  it('relays a padded refid to the provider rather than refusing it', async () => {
    const padded = buildRefid('9971732962', { padded: true });
    let sent = null;

    host()
      .post(path('/digilocker/initiate_session'), (body) => {
        sent = body;
        return true;
      })
      .reply(200, { status: true, data: { authorization_url: 'https://digilocker.test/auth/abc' } });

    const res = await initiate({ refid: padded, redirect_url: REDIRECT_URL });

    expect(res.status).toBe(200);
    expect(res.body.data.refid).toBe(padded);
    expect(sent).toContain(padded);
  });

  /**
   * The other half of the same point: with nothing validating shape, a body the
   * old validator would have rejected outright still reaches the provider — and
   * a provider 422 is billable, so a malformed request now costs money where it
   * used to cost nothing.
   */
  it('reaches the provider even when redirect_url is absent', async () => {
    host()
      .post(path('/digilocker/initiate_session'))
      .reply(422, { status: false, message: 'redirect_url required' });

    const res = await initiate({ refid: buildRefid('9812345678') });

    expect(res.status).toBe(502);
    expect(res.body.data.providerStatus).toBe(422);

    const log = await ProviderRequestLog.findOne({ refid: buildRefid('9812345678') });
    expect(log.billable).toBe(true);
  });
});

function stubInitiateRejection() {
  host()
    .post(path('/digilocker/initiate_session'))
    .reply(201, { status: false, message: 'Please provide unique reference number.' });
}


describe('wrapper — the remaining three provider steps', () => {
  const REFID = 'accaca1721281630414815099abcaccacaa';
  const URI = 'in.gov.uidai-ADHAR-f9044e68a093881d1ffb183f479b6959';

  const post = (p, body) => request(app).post(`/api/v1/wrapper/digilocker/${p}`).send(body);

  it('relays access-token and logs it under the right operation', async () => {
    host().post(path('/digilocker/access_token')).reply(200, { status: true, data: {} });

    const res = await post('access-token', { refid: REFID });

    expect(res.status).toBe(200);
    expect(res.body.data.refid).toBe(REFID);

    const log = await ProviderRequestLog.findOne({
      refid: REFID,
      operation: PROVIDER_OPERATION.ACCESS_TOKEN,
    });
    expect(log.billable).toBe(true);
  });

  it('returns the issued file list', async () => {
    const files = [{ name: 'Aadhaar Card', doctype: 'ADHAR', issuer: 'UIDAI', uri: URI }];
    host().post(path('/digilocker/issued_files')).reply(200, { status: true, data: { files } });

    const res = await post('issued-files', { refid: REFID });

    expect(res.status).toBe(200);
    expect(res.body.data.files).toHaveLength(1);
    expect(res.body.data.files[0].uri).toBe(URI);
  });

  it('returns download-xml as base64 without storing it', async () => {
    const xml = Buffer.from('<OfflinePaperlessKyc/>').toString('base64');
    let sent = null;
    host()
      .post(path('/digilocker/download_xml'), (body) => {
        sent = body;
        return true;
      })
      .reply(200, { status: true, data: { xml } });

    const res = await post('download-xml', { refid: REFID, uri: URI });

    expect(res.status).toBe(200);
    expect(res.body.data.base64Xml).toBe(xml);
    // The uri the caller chose is the one asked for — this wrapper picks no
    // document of its own.
    expect(sent).toContain(URI);
  });

  /**
   * Passthrough has to hold on every step, not just initiate: the caller's own
   * token is what the provider sees, and the User-Agent must name its signer.
   */
  it('forwards a caller token and user_agent on the later steps too', async () => {
    let headers = null;
    host()
      .post(path('/digilocker/issued_files'))
      .reply(function reply() {
        headers = this.req.headers;
        return [200, { status: true, data: { files: [] } }];
      });

    await post('issued-files', {
      refid: REFID,
      token: 'header.payload.signature',
      user_agent: 'CORP00002424',
    });

    expect(headers.token).toBe('header.payload.signature');
    expect(headers['user-agent']).toBe('CORP00002424');
  });

  it('passes a provider refusal through with its status intact', async () => {
    host()
      .post(path('/digilocker/access_token'))
      .reply(201, { status: false, message: 'Please provide unique reference number.' });

    const res = await post('access-token', { refid: REFID });

    expect(res.status).toBe(502);
    expect(res.body.data.providerStatus).toBe(201);
    expect(res.body.data.providerMessage).toBe('Please provide unique reference number.');
  });
});

describe('wrapper — revoke-token', () => {
  const REFID = 'accaca1721281630414815099abcaccacaa';
  const post = (body) => request(app).post('/api/v1/wrapper/digilocker/revoke-token').send(body);

  it('revokes the session and sends the refid the provider expects', async () => {
    let sent = null;
    host()
      .post(path('/digilocker/revoke_token'), (body) => {
        sent = body;
        return true;
      })
      .reply(200, { status: true });

    const res = await post({ refid: REFID });

    expect(res.status).toBe(200);
    expect(res.body.data.refid).toBe(REFID);
    expect(sent).toContain(REFID);
  });

  it('logs the call under REVOKE_TOKEN', async () => {
    host().post(path('/digilocker/revoke_token')).reply(200, { status: true });

    await post({ refid: REFID });

    const log = await ProviderRequestLog.findOne({
      refid: REFID,
      operation: PROVIDER_OPERATION.REVOKE_TOKEN,
    });
    expect(log).not.toBeNull();
    expect(log.providerStatus).toBe(200);
  });

  it('forwards a caller token in passthrough mode', async () => {
    let headers = null;
    host()
      .post(path('/digilocker/revoke_token'))
      .reply(function reply() {
        headers = this.req.headers;
        return [200, { status: true }];
      });

    await post({ refid: REFID, token: 'header.payload.signature', user_agent: 'CORP00002424' });

    expect(headers.token).toBe('header.payload.signature');
    expect(headers['user-agent']).toBe('CORP00002424');
  });

  it('passes a provider refusal through with its status', async () => {
    host()
      .post(path('/digilocker/revoke_token'))
      .reply(201, { status: false, message: 'Provide unique reference number.' });

    const res = await post({ refid: REFID });

    expect(res.status).toBe(502);
    expect(res.body.data.providerStatus).toBe(201);
  });
});

describe('wrapper — a caller that omits refid', () => {
  /**
   * Seen in production: "[Wrapper] Failed to write provider log { refid:
   * undefined }". With no validation on the route, refid can simply be absent —
   * the provider call still goes out and a 422 there is billable, but
   * ProviderRequestLog.create() threw on the required field and the billing row
   * was lost. Exactly the requests most worth a record left none.
   */
  it('still writes a billing row when refid is absent', async () => {
    host()
      .post(path('/digilocker/access_token'))
      .reply(422, { status: false, message: 'refid required' });

    const res = await request(app)
      .post('/api/v1/wrapper/digilocker/access-token')
      .send({ token: 'header.payload.signature', user_agent: 'CORP00002424' });

    expect(res.status).toBe(502);

    const log = await ProviderRequestLog.findOne({
      operation: PROVIDER_OPERATION.ACCESS_TOKEN,
      refid: '(missing)',
    });
    expect(log).not.toBeNull();
    // 422 is billable — losing this row is losing money we cannot reconcile.
    expect(log.billable).toBe(true);
  });

  it('does the same for the other refid-only steps', async () => {
    for (const [route, providerPath, operation] of [
      ['issued-files', '/digilocker/issued_files', PROVIDER_OPERATION.ISSUED_FILES],
      ['revoke-token', '/digilocker/revoke_token', PROVIDER_OPERATION.REVOKE_TOKEN],
    ]) {
      host().post(path(providerPath)).reply(422, { status: false, message: 'refid required' });

      await request(app).post(`/api/v1/wrapper/digilocker/${route}`).send({});

      const log = await ProviderRequestLog.findOne({ operation, refid: '(missing)' });
      expect(log).not.toBeNull();
    }
  });
});
