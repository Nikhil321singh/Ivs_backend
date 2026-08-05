const ImeiVerificationLog = require('../models/ImeiVerificationLog.model');
const ivsProvider = require('./providers/cdotIvsProvider');

/**
 * Verifies IMEI(s) against C-DOT's CEIR blocklist and logs the outcome.
 * The verification result is always returned to the caller even if writing
 * the audit log fails — losing the log entry shouldn't block a checkout.
 */
const verifyImei = async (userId, { imei1, imei2, deviceModel }) => {
  const result = await ivsProvider.verifyImei({ imei1, imei2, deviceModel });

  try {
    await ImeiVerificationLog.create({
      userId,
      imei1,
      imei2: imei2 || null,
      deviceModel: deviceModel || null,
      imei1Status: result.imei1Status,
      imei1CdotStatus: result.imei1CdotStatus,
      imei2Status: result.imei2Status,
      imei2CdotStatus: result.imei2CdotStatus,
      allowTransaction: result.allowTransaction,
      referenceId: result.referenceId,
      rawResponse: result.rawResponse,
      verifiedAt: new Date(result.verifiedAt),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[IVS] Failed to save verification log', result.referenceId, err.message);
  }

  return result;
};

module.exports = { verifyImei };
