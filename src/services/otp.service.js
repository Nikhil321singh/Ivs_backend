const crypto = require('crypto');
const axios = require('axios');
const env = require('../config/env');
const Otp = require('../models/Otp.model');
const OtpAttempt = require('../models/OtpAttempt.model');
const { hashToken } = require('../utils/hash.util');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

const msg91Client = axios.create({
  baseURL: env.msg91.baseUrl,
  headers: {
    authkey: env.msg91.authKey,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

/**
 * MSG91 expects the mobile number without a leading "+", e.g. 919876543210.
 */
const toMsg91Mobile = (countryCode, mobile) => `${countryCode}${mobile}`.replace('+', '');

const generateOtp = () => {
  const digits = env.msg91.otpLength;
  const min = 10 ** (digits - 1);
  const max = 10 ** digits - 1;
  return crypto.randomInt(min, max + 1).toString();
};

/**
 * Numbers listed in OTP_TEST_NUMBERS sign in with the fixed OTP and no SMS is
 * sent. Everything downstream is unchanged — the fixed value is hashed and
 * stored exactly like a real one, so it still expires and is still consumed on
 * use, and verifyOtp needs no knowledge of test mode at all.
 */
const isTestNumber = (mobile) =>
  env.otpTest.enabled && env.otpTest.numbers.includes(String(mobile));

/**
 * Generates an OTP ourselves and delivers it via an MSG91 Flow (templated
 * SMS API), rather than MSG91's managed OTP widget. The OTP is stored here
 * as a SHA-256 hash and verified locally in verifyOtp.
 * @param {string} countryCode e.g. "+91"
 * @param {string} mobile e.g. "9876543210"
 */
const sendOtp = async (countryCode, mobile) => {
  const testNumber = isTestNumber(mobile);
  const otp = testNumber ? env.otpTest.otp : generateOtp();

  if (testNumber) {
    // eslint-disable-next-line no-console
    console.warn(`[OTP] TEST MODE: no SMS sent for ${countryCode}${mobile}`);
  } else {
    const msg91Mobile = toMsg91Mobile(countryCode, mobile);

    try {
      const { data } = await msg91Client.post('/flow', {
        flow_id: env.msg91.flowId,
        recipients: [{ mobiles: msg91Mobile, var1: otp }],
      });

      if (data.type !== 'success') {
        throw new ApiError(httpStatus.BAD_REQUEST, data.message || MESSAGES.OTP.SEND_FAILED);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;

      const providerMessage = error.response?.data?.message;
      throw new ApiError(httpStatus.BAD_REQUEST, providerMessage || MESSAGES.OTP.SEND_FAILED);
    }
  }

  const expiresAt = new Date(Date.now() + env.msg91.otpExpiryMinutes * 60 * 1000);

  await Otp.findOneAndUpdate(
    { countryCode, mobile },
    { otpHash: hashToken(otp), expiresAt },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Per-account brute-force guard: at most MAX_ATTEMPTS wrong codes for a given
 * number within ATTEMPT_WINDOW_MINUTES, counted independently of how many OTPs
 * were requested. The IP limiter alone left a distributed attacker unbounded
 * against a single number — 6 digits is only a million values.
 */
const MAX_ATTEMPTS = 3;
const ATTEMPT_WINDOW_MINUTES = 15;

const assertNotLockedOut = async (countryCode, mobile) => {
  const attempt = await OtpAttempt.findOne({ countryCode, mobile });

  // A row past its window is spent; the TTL monitor may not have removed it yet.
  if (attempt && attempt.expiresAt.getTime() > Date.now() && attempt.count >= MAX_ATTEMPTS) {
    throw new ApiError(httpStatus.TOO_MANY_REQUESTS, MESSAGES.OTP.TOO_MANY_ATTEMPTS);
  }

  if (attempt && attempt.expiresAt.getTime() <= Date.now()) {
    await OtpAttempt.deleteOne({ _id: attempt._id });
  }
};

const recordFailedAttempt = async (countryCode, mobile) => {
  const expiresAt = new Date(Date.now() + ATTEMPT_WINDOW_MINUTES * 60 * 1000);

  // The window starts at the FIRST failure and is not extended by later ones —
  // $setOnInsert, so a persistent attacker cannot keep pushing the expiry out.
  await OtpAttempt.findOneAndUpdate(
    { countryCode, mobile },
    { $inc: { count: 1 }, $setOnInsert: { countryCode, mobile, expiresAt } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Verifies an OTP against the hash stored for this mobile number when it
 * was sent. Consumes the OTP on success so it cannot be replayed, and clears
 * the failure counter.
 */
const verifyOtp = async (countryCode, mobile, otp) => {
  await assertNotLockedOut(countryCode, mobile);

  const record = await Otp.findOne({ countryCode, mobile });

  if (!record || record.expiresAt.getTime() < Date.now() || record.otpHash !== hashToken(otp)) {
    await recordFailedAttempt(countryCode, mobile);
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.OTP.VERIFY_FAILED);
  }

  await Promise.all([
    Otp.deleteOne({ _id: record._id }),
    // Success clears the slate, so a user who fumbles twice then succeeds is
    // not left one mistake away from a lockout.
    OtpAttempt.deleteOne({ countryCode, mobile }),
  ]);

  return true;
};

module.exports = { sendOtp, verifyOtp };
