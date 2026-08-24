const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Mints the short-lived JWT every SprintVerify/Paysprint request must carry.
 *
 * Shared by the UIDAI OTP provider and the DigiLocker provider because both are
 * the same vendor and the same signing contract, which the provider specifies
 * as exactly three claims and no others:
 *
 *   {
 *     "timestamp": <current epoch seconds>,
 *     "partnerId": "<CORP ID>",
 *     "reqid":     "<unique per request>"
 *   }
 *
 * HS256, signed with PAYSPRINT_AUTHORISED_KEY (the "JWT KEY" in the provider's
 * docs — NOT the Authorisedkey header value; see config/env.js), valid five
 * minutes, generated fresh for every single request. Never cached — a reused
 * token is rejected, and a leaked one stays valid until it expires.
 *
 * How each product carries it differs even though the token is identical:
 *   OTP e-KYC   POST body field `token`, through the GREST wrapper
 *   DigiLocker  `Token` request header, calling SprintVerify directly
 *
 * The backdate below is not cosmetic. Paysprint's upstream validates the
 * timestamp with NO clock-skew leeway and its server clock frequently lags real
 * time, so a token stamped at "now" is rejected as being issued in the future:
 *   "Cannot handle token prior to <timestamp>"
 * This was seen intermittently in production — send-otp passing while verify-otp
 * failed moments later. Backdating `timestamp` puts the token comfortably in
 * the provider's past. The token is used immediately, so a small backdate
 * cannot trip a max-age check.
 */
const TOKEN_SKEW_SECONDS = 120;

const generatePaysprintToken = () => {
  const issuedAt = Math.floor(Date.now() / 1000) - TOKEN_SKEW_SECONDS;

  const payload = {
    timestamp: issuedAt,
    partnerId: env.paysprint.partnerId,
    reqid: `${Date.now()}${Math.floor(Math.random() * 10)}`,
  };

  // noTimestamp suppresses the `iat` jsonwebtoken would otherwise stamp at now,
  // which would contradict the backdated `timestamp` above and put the contract
  // back to four claims instead of the three the provider specifies. The
  // backdate therefore reaches the provider through `timestamp` alone.
  return jwt.sign(payload, env.paysprint.jwtKey, {
    algorithm: 'HS256',
    noTimestamp: true,
  });
};

module.exports = { generatePaysprintToken, TOKEN_SKEW_SECONDS };
