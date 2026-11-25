const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const pincodeService = require('../services/pincode.service');

const lookup = asyncHandler(async (req, res) => {
  const { pincode } = req.params;
  const result = await pincodeService.lookupPincode(pincode);
  successResponse(res, httpStatus.OK, 'Pincode details fetched successfully.', result);
});

module.exports = { lookup };
