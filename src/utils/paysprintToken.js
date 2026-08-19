const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Mints the short-lived JWT every SprintVerify/Paysprint request must carry.
 *
 * Shared by the UIDAI OTP provider and the DigiLocker provider because both are
 * the same vendor and the same signing contract: HS256 over
 * { timestamp, partnerId, reqid }, signed with the authorised key, valid for
 * five minutes, and generated fresh for every single request. It is never
 * cached — a reused token is rejected, and a leaked one stays valid until it
 * expires.
 *
 * The backdate below is not cosmetic. Paysprint's upstream validates the
 * timestamp with NO clock-skew leeway and its server clock frequently lags real
 * time, so a token stamped at "now" is rejected as being issued in the future:
 *   "Cannot handle token prior to <timestamp>"
 * This was seen intermittently in production — send-otp passing while verify-otp
 * failed moments later. Backdating both the custom `timestamp` claim and the JWT
 * `iat` puts the token comfortably in the provider's past. The token is used
 * immediately, so a small backdate cannot trip a max-age check.
 */
const TOKEN_SKEW_SECONDS = 120;

const generatePaysprintToken = () => {
  const issuedAt = Math.floor(Date.now() / 1000) - TOKEN_SKEW_SECONDS;

  const payload = {
    iat: issuedAt,
    timestamp: issuedAt,
    partnerId: env.paysprint.partnerId,
    reqid: `${Date.now()}${Math.floor(Math.random() * 10)}`,
  };

  // noTimestamp so jsonwebtoken doesn't overwrite our backdated `iat` with now.
  return jwt.sign(payload, env.paysprint.jwtKey, {
    algorithm: 'HS256',
    noTimestamp: true,
  });
};

module.exports = { generatePaysprintToken, TOKEN_SKEW_SECONDS };
