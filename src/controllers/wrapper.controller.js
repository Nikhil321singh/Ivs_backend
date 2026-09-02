const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const provider = require('../services/providers/digiLockerProvider');
const ProviderRequestLog = require('../models/ProviderRequestLog.model');
const { PROVIDER_OPERATION } = require('../constants/aadhaarVerification');

/**
 * Server-to-server wrapper around the provider's initiate_session.
 *
 * WHY THIS EXISTS: the calling app runs on Lambda, whose egress IP rotates, and
 * the provider is believed to allowlist source addresses. This server has a
 * fixed one. So the wrapper's entire job is to be the thing that makes the
 * outbound call — it holds the credentials, mints the Token, and hands back
 * what the provider said.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: create an AadhaarVerification, own a
 * session, or handle the callback. The caller owns the flow and the refid; this
 * is a proxy, not a second copy of digilockerAadhaar.service.js.
 *
 * THE LIMIT WORTH KNOWING: initiate_session is only the first of four provider
 * calls. access_token, issued_files and download_xml are also outbound, and the
 * caller still makes those itself — from the same rotating IP. If the allowlist
 * is real, this endpoint alone will not be enough.
 */

/**
 * The refid used when the caller supplies none. Fixed by request.
 *
 * RECORDED SO IT IS NOT REDISCOVERED AS A BUG: the provider rejects any refid
 * it has already issued a session for, and this one is spent. A request that
 * falls back to it therefore returns 502 with providerStatus 201, "Please
 * provide unique reference number" — every time, not intermittently. Verified
 * against production on 2026-09-01; a random refid returned 200 in the same
 * session, so this is the value, not the endpoint.
 *
 * Callers that need a working session must send their own unique refid.
 */
const DEFAULT_REFID = 'UTA5U1VEQXdNREF5TkRJMFQxUnJNMDFVWTNwTmFtc3lUV2M5UFE9PQ==';

/**
 * Stands in for a refid the caller did not send, so the billing row still gets
 * written. Deliberately not a plausible refid: it must never be mistaken for
 * one, and it makes these requests greppable in the log.
 */
const MISSING_REFID = '(missing)';

/**
 * Reads partnerId out of a caller-supplied token, to use as the User-Agent when
 * the caller sent a token but no explicit user_agent.
 *
 * The provider reads User-Agent as the partner id, so it must name whoever
 * signed the token. Falling back to this server's own partnerId in that case
 * would pair one partner's signature with another's identity — a mismatch the
 * provider rejects, and a confusing one to debug. The token already carries the
 * answer, so take it from there.
 *
 * The payload is unverified input, so this only reads it and never trusts it:
 * anything malformed yields null and the normal fallback applies.
 */
const partnerIdFromToken = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64').toString('utf8'));
    return typeof payload.partnerId === 'string' ? payload.partnerId : null;
  } catch (error) {
    return null;
  }
};

/**
 * Billing reconciliation. The provider bills on HTTP status regardless of who
 * asked, so a wrapper call lands on the same invoice as an in-app one and has
 * to be recorded the same way. userId is null: there is no user here, only a
 * peer server, and the refid is what ties the row back to the caller's session.
 *
 * Never throws — a failed log must not turn a successful provider call into an
 * error response, because the call has already been made and billed.
 */
const logProviderCall = async (refid, operation, result) => {
  try {
    await ProviderRequestLog.create({
      provider: 'DIGILOCKER',
      userId: null,
      // A caller can omit refid entirely now that the route validates nothing.
      // The provider call still went out and may still have been billed, so the
      // row must be written regardless — refid is `required` on the model, and
      // passing undefined threw, which silently lost the billing record for
      // exactly the malformed requests most worth having a record of.
      refid: refid || MISSING_REFID,
      operation,
      providerStatus: result.status,
      billable: result.billable,
      providerMessage: result.message,
      durationMs: result.durationMs,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Wrapper] Failed to write provider log', { refid, message: error.message });
  }
};

/**
 * Reads passthrough credentials off any wrapper request body. Shared by all
 * four routes because the rule is the same everywhere: a caller-supplied token
 * is relayed untouched, and the User-Agent must name whoever signed it.
 */
const overridesFrom = (body) => {
  const token = body.token || null;
  if (!token) return {};

  return {
    token,
    userAgent: body.user_agent || body.partnerId || partnerIdFromToken(token),
  };
};

/**
 * The provider's answer, relayed. Failure keeps the provider's own status and
 * message rather than flattening them, for the reason given on initiateSession:
 * the caller is a server we operate and can only decide whether to retry if it
 * can see what actually happened.
 */
const relay = (res, refid, result, { okMessage, failMessage, payload = {} }) => {
  if (!result.ok) {
    return res.status(httpStatus.BAD_GATEWAY).json({
      success: false,
      message: result.message || failMessage,
      errors: [],
      data: { refid, providerStatus: result.status, providerMessage: result.message },
    });
  }

  return successResponse(res, httpStatus.OK, okMessage, { refid, ...payload });
};

const initiateSession = asyncHandler(async (req, res) => {
  const refid = req.body.refid || DEFAULT_REFID;
  const redirectUrl = req.body.redirect_url;

  // Passthrough mode. When the caller sends its own provider token, it is
  // forwarded verbatim and this server signs nothing — it is only lending its
  // IP. Both fields absent means the wrapper mints with its own credentials.
  const token = req.body.token || null;
  const overrides = token
    ? {
        token,
        userAgent: req.body.user_agent || req.body.partnerId || partnerIdFromToken(token),
      }
    : {};

  const result = await provider.initiateSession(refid, redirectUrl, overrides);
  await logProviderCall(refid, PROVIDER_OPERATION.INITIATE_SESSION, result);

  return relay(res, refid, result, {
    okMessage: MESSAGES.WRAPPER.SESSION_STARTED,
    failMessage: MESSAGES.WRAPPER.SESSION_FAILED,
    payload: {
      authorizationUrl: result.authorizationUrl,
      // Included so the caller does not have to reconstruct which URL this
      // session was bound to when it later handles the callback.
      redirectUrl,
    },
  });
});

/**
 * Step 2 of 4. Exchanges a completed DigiLocker authentication for provider-side
 * access. Must run before issued-files; the provider rejects it otherwise.
 */
const accessToken = asyncHandler(async (req, res) => {
  const { refid } = req.body;

  const result = await provider.accessToken(refid, overridesFrom(req.body));
  await logProviderCall(refid, PROVIDER_OPERATION.ACCESS_TOKEN, result);

  return relay(res, refid, result, {
    okMessage: MESSAGES.WRAPPER.TOKEN_FETCHED,
    failMessage: MESSAGES.WRAPPER.TOKEN_FAILED,
  });
});

/**
 * Step 3 of 4. Lists the documents in the authenticated DigiLocker account. The
 * caller picks the Aadhaar one and passes its uri to download-xml — this
 * wrapper does not choose for it, since it owns no session and no policy about
 * which document matters.
 */
const issuedFiles = asyncHandler(async (req, res) => {
  const { refid } = req.body;

  const result = await provider.issuedFiles(refid, overridesFrom(req.body));
  await logProviderCall(refid, PROVIDER_OPERATION.ISSUED_FILES, result);

  return relay(res, refid, result, {
    okMessage: MESSAGES.WRAPPER.FILES_FETCHED,
    failMessage: MESSAGES.WRAPPER.FILES_FAILED,
    payload: { files: result.files },
  });
});

/**
 * Step 4 of 4. Returns the document as Base64 XML, exactly as the provider gave
 * it — unparsed and unstored.
 *
 * This is the one route that can carry Aadhaar data, and it deliberately does
 * not persist or log any of it: the body is handed straight back to the caller,
 * which owns the session and the decision about what to keep. digilockerAadhaar
 * .service.js parses in-scope and never writes the raw XML; a caller relaying
 * through here inherits that responsibility rather than delegating it.
 */
const downloadXml = asyncHandler(async (req, res) => {
  const { refid, uri } = req.body;

  const result = await provider.downloadXml(refid, uri, overridesFrom(req.body));
  await logProviderCall(refid, PROVIDER_OPERATION.DOWNLOAD_XML, result);

  return relay(res, refid, result, {
    okMessage: MESSAGES.WRAPPER.XML_FETCHED,
    failMessage: MESSAGES.WRAPPER.XML_FAILED,
    payload: { base64Xml: result.base64Xml },
  });
});

/**
 * Teardown. Ends the provider-side session for a refid.
 *
 * Optional in the sense that the flow completes without it — but a consented
 * DigiLocker session left open is an outstanding capability against someone's
 * Aadhaar, so a caller that is finished should say so rather than waiting for
 * the provider to time it out.
 */
const revokeToken = asyncHandler(async (req, res) => {
  const { refid } = req.body;

  const result = await provider.revokeToken(refid, overridesFrom(req.body));
  await logProviderCall(refid, PROVIDER_OPERATION.REVOKE_TOKEN, result);

  return relay(res, refid, result, {
    okMessage: MESSAGES.WRAPPER.TOKEN_REVOKED,
    failMessage: MESSAGES.WRAPPER.REVOKE_FAILED,
  });
});

module.exports = { initiateSession, accessToken, issuedFiles, downloadXml, revokeToken };
