const axios = require('axios');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');

const API_BASE_URL = 'https://b2bai.gadgetguruz.com';
const API_KEY = process.env.REPAIR_API_KEY;

if (!API_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[Repair Analysis] REPAIR_API_KEY not set in environment');
}

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 60000,
});

const analyzeFault = async (query) => {
  try {
    if (!API_KEY) {
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Repair API key not configured');
    }

    const response = await client.post('/v1/analyze', { query });

    if (!response.data.success) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Repair analysis failed: ${response.data.error?.message || 'Unknown error'}`
      );
    }

    return response.data.data;
  } catch (err) {
    if (err.response?.status === 401) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Repair API key is invalid');
    }
    if (err.response?.status === 429) {
      throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Repair API rate limit exceeded');
    }
    if (err.response?.status === 413) {
      throw new ApiError(httpStatus.PAYLOAD_TOO_LARGE, 'Query is too long (max 1000 characters)');
    }
    if (err.response?.status === 422) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        response.data.error?.message || 'Unable to analyze this device'
      );
    }
    if (err.code === 'ECONNABORTED') {
      throw new ApiError(httpStatus.GATEWAY_TIMEOUT, 'Repair API request timed out');
    }
    throw err;
  }
};

const chatRepair = async (message, context = null) => {
  try {
    if (!API_KEY) {
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Repair API key not configured');
    }

    const payload = { message };
    if (context) payload.context = context;

    const response = await client.post('/v1/chat', payload);

    if (!response.data.success) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Chat failed: ${response.data.error?.message || 'Unknown error'}`
      );
    }

    return response.data.data;
  } catch (err) {
    if (err.response?.status === 401) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Repair API key is invalid');
    }
    if (err.response?.status === 429) {
      throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Rate limit exceeded');
    }
    if (err.response?.status === 422) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        response.data.error?.message || 'Unable to answer this question'
      );
    }
    if (err.code === 'ECONNABORTED') {
      throw new ApiError(httpStatus.GATEWAY_TIMEOUT, 'Repair API request timed out');
    }
    throw err;
  }
};

module.exports = {
  analyzeFault,
  chatRepair,
};
