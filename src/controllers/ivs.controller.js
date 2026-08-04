const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const ApiError = require('../utils/apiError');
const ivsService = require('../services/ivs.service');
const walletService = require('../services/wallet.service');
const { parseBulkCsv } = require('../validators/ivs.validator');

const verifyImei = asyncHandler(async (req, res) => {
  const result = await ivsService.verifyImei(req.user.id, req.body);

  // Billing rule lives in the service so single + bulk stay in sync.
  const { charged, cost } = await ivsService.chargeIfBillable(req.user.id, result);
  const balance = await walletService.getBalance(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.IVS.VERIFIED, {
    ...result,
    wallet: { balance, charged, cost },
  });
});

const verifyBulkImei = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.IVS.CSV_REQUIRED);
  }

  // Parses, validates and caps rows (throws 422 with per-row errors on any
  // bad row, so nothing is verified or charged unless the whole file is good).
  const rows = parseBulkCsv(req.file.buffer);

  const result = await ivsService.verifyBulk(req.user.id, rows);

  successResponse(res, httpStatus.OK, MESSAGES.IVS.BULK_COMPLETED, result);
});

const getHistory = asyncHandler(async (req, res) => {
  const result = await ivsService.getHistory(req.user.id, req.query);

  successResponse(res, httpStatus.OK, MESSAGES.IVS.HISTORY_FETCHED, result);
});

module.exports = { verifyImei, verifyBulkImei, getHistory };
