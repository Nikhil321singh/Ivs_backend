const axios = require('axios');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');

const POSTAL_API = 'https://api.postalpincode.in/pincode';
const TIMEOUT_MS = 5000;

const lookupPincode = async (pincode) => {
  let response;
  try {
    response = await axios.get(`${POSTAL_API}/${pincode}`, { timeout: TIMEOUT_MS });
  } catch (err) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Pincode lookup service is unavailable. Please try again.');
  }

  const [result] = response.data || [];

  if (!result || result.Status === 'Error' || !result.PostOffice?.length) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No state found for this pincode. Please check and try again.');
  }

  const { State, District, Division, Country } = result.PostOffice[0];

  return { pincode, state: State, district: District, division: Division, country: Country };
};

module.exports = { lookupPincode };
