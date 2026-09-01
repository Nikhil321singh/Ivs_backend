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
