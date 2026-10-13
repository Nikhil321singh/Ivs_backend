const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const cdotAdminService = require('../services/cdotAdmin.service');

const createVendor = asyncHandler(async (req, res) => {
  const result = await cdotAdminService.createVendor(req.body);

  successResponse(res, httpStatus.CREATED, 'Vendor created successfully.', result);
});

const listVendors = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const search = req.query.search || null;
  const isActive = req.query.isActive ? req.query.isActive === 'true' : undefined;

  const result = await cdotAdminService.listVendors({ page, limit, search, isActive });

  successResponse(res, httpStatus.OK, 'Vendors fetched successfully.', result);
});

const getVendorDetail = asyncHandler(async (req, res) => {
  const detail = await cdotAdminService.getVendorDetail(req.params.vendorId);

  successResponse(res, httpStatus.OK, 'Vendor details fetched.', detail);
});

const adjustWallet = asyncHandler(async (req, res) => {
  const result = await cdotAdminService.adjustWallet(req.params.vendorId, req.body);

  successResponse(res, httpStatus.OK, 'Wallet adjusted successfully.', result);
});

const suspendVendor = asyncHandler(async (req, res) => {
  const result = await cdotAdminService.suspendVendor(req.params.vendorId);

  successResponse(res, httpStatus.OK, result.message, {});
});

const unsuspendVendor = asyncHandler(async (req, res) => {
  const result = await cdotAdminService.unsuspendVendor(req.params.vendorId);

  successResponse(res, httpStatus.OK, result.message, {});
});

const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await cdotAdminService.getAnalytics();

  successResponse(res, httpStatus.OK, 'Analytics fetched.', analytics);
});

const exportVendorData = asyncHandler(async (req, res) => {
  const format = req.query.format || 'json';
  const data = await cdotAdminService.exportVendorData(req.params.vendorId, format);

  if (format === 'csv') {
    res.type('text/csv').send(data.calls);
  } else {
    successResponse(res, httpStatus.OK, 'Vendor data exported.', data);
  }
});

module.exports = {
  createVendor,
  listVendors,
  getVendorDetail,
  adjustWallet,
  suspendVendor,
  unsuspendVendor,
  getAnalytics,
  exportVendorData,
};
