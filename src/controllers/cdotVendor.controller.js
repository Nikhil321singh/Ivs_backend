const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const cdotVendorService = require('../services/cdotVendor.service');

const register = asyncHandler(async (req, res) => {
  const result = await cdotVendorService.register(req.body);

  successResponse(res, httpStatus.CREATED, 'Vendor registered successfully.', {
    vendor: result.vendor,
    apiKey: result.apiKey,
    token: result.token,
  });
});

const login = asyncHandler(async (req, res) => {
  const result = await cdotVendorService.login(req.body);

  successResponse(res, httpStatus.OK, 'Logged in successfully.', {
    vendor: result.vendor,
    apiKey: result.apiKey,
    token: result.token,
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const result = await cdotVendorService.changePassword(req.vendor.id, req.body);

  successResponse(res, httpStatus.OK, result.message, result);
});

const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await cdotVendorService.getDashboard(req.vendor.id);

  successResponse(res, httpStatus.OK, 'Dashboard data fetched.', dashboard);
});

const getApiCalls = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  const result = await cdotVendorService.getApiCalls(req.vendor.id, { page, limit });

  successResponse(res, httpStatus.OK, 'API calls fetched.', result);
});

const getTransactions = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  const result = await cdotVendorService.getTransactions(req.vendor.id, { page, limit });

  successResponse(res, httpStatus.OK, 'Transactions fetched.', result);
});

const getApiKey = asyncHandler(async (req, res) => {
  const apiKey = await cdotVendorService.getApiKey(req.vendor.id);

  successResponse(res, httpStatus.OK, 'API key fetched.', apiKey);
});

const regenerateApiKey = asyncHandler(async (req, res) => {
  const result = await cdotVendorService.regenerateApiKey(req.vendor.id);

  successResponse(res, httpStatus.OK, result.message, { key: result.key });
});

module.exports = {
  register,
  login,
  changePassword,
  getDashboard,
  getApiCalls,
  getTransactions,
  getApiKey,
  regenerateApiKey,
};
