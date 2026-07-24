const crypto = require('crypto');
const axios = require('axios');
const env = require('../config/env');
const Otp = require('../models/Otp.model');
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
 * Generates an OTP ourselves and delivers it via an MSG91 Flow (templated
 * SMS API), rather than MSG91's managed OTP widget. The OTP is stored here
 * as a SHA-256 hash and verified locally in verifyOtp.
 * @param {string} countryCode e.g. "+91"
 * @param {string} mobile e.g. "9876543210"
 */
const sendOtp = async (countryCode, mobile) => {
  const otp = generateOtp();
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

  const expiresAt = new Date(Date.now() + env.msg91.otpExpiryMinutes * 60 * 1000);

  await Otp.findOneAndUpdate(
    { countryCode, mobile },
    { otpHash: hashToken(otp), expiresAt },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Verifies an OTP against the hash stored for this mobile number when it
 * was sent. Consumes the OTP on success so it cannot be replayed.
 * @param {string} countryCode e.g. "+91"
 * @param {string} mobile e.g. "9876543210"
 * @param {string} otp
 */
const verifyOtp = async (countryCode, mobile, otp) => {
  const record = await Otp.findOne({ countryCode, mobile });

  if (!record || record.expiresAt.getTime() < Date.now() || record.otpHash !== hashToken(otp)) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.OTP.VERIFY_FAILED);
  }

  await Otp.deleteOne({ _id: record._id });

  return true;
};

module.exports = { sendOtp, verifyOtp };
