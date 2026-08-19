/**
 * nock stubs for every external provider the API talks to, so the suite runs
 * offline and deterministically. test/setup/db.js disables real network access,
 * so any call without a stub here fails the test rather than reaching a live
 * service — which matters: two of these are a government API and a paid SMS
 * gateway.
 */
const nock = require('nock');

const MSG91 = 'https://control.msg91.com';
const CDOT = 'https://ivs.test.gov';
const WRAPPER = 'https://grest.test';

/** MSG91 Flow accepts the send. */
const stubMsg91Success = () =>
  nock(MSG91).post('/api/v5/flow').reply(200, { type: 'success', message: 'queued' });

/** MSG91 rejects — used to assert we surface a 400 rather than a 500. */
const stubMsg91Failure = (message = 'invalid number') =>
  nock(MSG91).post('/api/v5/flow').reply(200, { type: 'error', message });

/**
 * C-DOT login + IMEI lookup. `status` is the raw CEIR string:
 * 'non-blocked' -> CLEAN, 'blocked' -> BLOCKED, 'stolen' -> STOLEN,
 * anything else -> UNKNOWN.
 */
const stubCdot = (imei, status = 'non-blocked', { times = 1 } = {}) => {
  nock(CDOT)
    .post('/api/login')
    .times(times)
    .reply(200, {
      // The provider decodes exp from the JWT payload; a far-future value keeps
      // the cached token valid for the whole test.
      accessToken: `header.${Buffer.from(
        JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })
      ).toString('base64')}.sig`,
      refreshToken: 'test-refresh',
    });

  nock(CDOT)
    .post('/api/imei-status')
    .times(times)
    .reply(200, { [imei]: { status } });
};

/** C-DOT rejects the login — the 403 that Sydney used to get. */
const stubCdotBlocked = () => {
  nock(CDOT).post('/api/login').reply(403, '<html>403</html>');
  // imei-status is stubbed too, not just login, because cdotIvsProvider caches
  // its access token at module scope: if an earlier test in the same file
  // already cached a valid token, the provider skips login entirely and goes
  // straight here. Stubbing only login made this helper depend on test order,
  // which surfaced as an intermittent "No match for request" failure. Either
  // path now yields the same thing — no usable answer.
  nock(CDOT).post('/api/imei-status').reply(403, '<html>403</html>');
};

/** Aadhaar e-KYC via the GREST wrapper: send-otp then verify-otp. */
const stubAadhaar = ({ clientId = 'client-123', verifySuccess = true } = {}) => {
  nock(WRAPPER).post('/api/initiateAadhaar').reply(200, {
    success: true,
    data: { client_id: clientId },
  });

  nock(WRAPPER).post('/api/verifyAadhaar').reply(200, { success: verifySuccess });

  return clientId;
};

const stubAadhaarSendFailure = () =>
  nock(WRAPPER).post('/api/initiateAadhaar').reply(200, { success: false, message: 'upstream down' });

module.exports = {
  stubMsg91Success,
  stubMsg91Failure,
  stubCdot,
  stubCdotBlocked,
  stubAadhaar,
  stubAadhaarSendFailure,
};
