const { body, query } = require('express-validator');
const { parse } = require('csv-parse/sync');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const PRICING = require('../constants/pricing');
const { IVS_STATUS } = require('../services/providers/cdotIvsProvider');

const IMEI_REGEX = /^\d{15}$/;
const MOBILE_REGEX = /^[6-9]\d{9}$/;
const AADHAAR_REGEX = /^[2-9]{1}[0-9]{11}$/;

const verifyImeiValidator = [
  body('imei1')
    .trim()
    .notEmpty()
    .withMessage('IMEI 1 is required.')
    .matches(IMEI_REGEX)
    .withMessage('IMEI 1 must be exactly 15 numeric digits.'),
  body('imei2')
    .optional({ checkFalsy: true })
    .trim()
    .matches(IMEI_REGEX)
    .withMessage('IMEI 2 must be exactly 15 numeric digits.')
    .custom((value, { req }) => value !== req.body.imei1)
    .withMessage('IMEI 1 and IMEI 2 must be different.'),
  body('deviceModel')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Device model must be at most 200 characters.'),
  // Customer details captured at the point of verification (the person whose
  // device is being checked — distinct from the authenticated vendor).
  body('customerName')
    .trim()
    .notEmpty()
    .withMessage('Customer name is required.')
    .isLength({ min: 2, max: 100 })
    .withMessage('Customer name must be between 2 and 100 characters.'),
  body('customerMobile')
    .trim()
    .notEmpty()
    .withMessage('Customer mobile number is required.')
    .matches(MOBILE_REGEX)
    .withMessage('Please provide a valid 10-digit customer mobile number.'),
  body('aadhaarNumber')
    .trim()
    .notEmpty()
    .withMessage('Customer Aadhaar number is required.')
    .matches(AADHAAR_REGEX)
    .withMessage('Please provide a valid 12-digit Aadhaar number.'),
];

/**
 * Query params for the verification-history endpoint. All optional — they
 * narrow the result set. `aadhaarNumber`/`customerMobile`/`imei` let the UI
 * look a customer or device up; `aadhaarNumber` is hashed server-side to
 * match the stored hash (the full number is never persisted).
 */
const historyQueryValidator = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer.').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100.').toInt(),
  query('imei').optional({ checkFalsy: true }).trim().matches(IMEI_REGEX).withMessage('imei must be 15 digits.'),
  query('customerMobile').optional({ checkFalsy: true }).trim().matches(MOBILE_REGEX).withMessage('customerMobile must be a valid 10-digit number.'),
  query('aadhaarNumber').optional({ checkFalsy: true }).trim().matches(AADHAAR_REGEX).withMessage('aadhaarNumber must be a valid 12-digit number.'),
  query('status').optional({ checkFalsy: true }).trim().toUpperCase().isIn(Object.values(IVS_STATUS)).withMessage('status is not a valid IMEI status.'),
  query('from').optional({ checkFalsy: true }).isISO8601().withMessage('from must be an ISO date.').toDate(),
  query('to').optional({ checkFalsy: true }).isISO8601().withMessage('to must be an ISO date.').toDate(),
];

/**
 * Parses and validates a bulk-verification CSV buffer. Expected headers:
 *   imei1, imei2, deviceModel, customerName, customerMobile, aadhaarNumber
 * (imei2 and deviceModel optional). Returns a clean array of row objects, or
 * throws an ApiError with per-row errors so nothing is verified/charged when
 * any row is malformed. Enforces the 1..IVS_BULK_MAX_ROWS limit.
 */
const parseBulkCsv = (buffer) => {
  let records;
  try {
    records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.IVS.CSV_INVALID);
  }

  if (!records.length) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.IVS.BULK_EMPTY);
  }
  if (records.length > PRICING.IVS_BULK_MAX_ROWS) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.IVS.BULK_TOO_MANY);
  }

  const rowErrors = [];
  const rows = [];

  records.forEach((rec, i) => {
    const line = i + 2; // +1 for zero-index, +1 for the header row
    const imei1 = (rec.imei1 || '').trim();
    const imei2 = (rec.imei2 || '').trim();
    const deviceModel = (rec.deviceModel || '').trim();
    const customerName = (rec.customerName || '').trim();
    const customerMobile = (rec.customerMobile || '').trim();
    const aadhaarNumber = (rec.aadhaarNumber || '').trim();

    const errors = [];
    if (!IMEI_REGEX.test(imei1)) errors.push('imei1 must be exactly 15 digits.');
    if (imei2 && !IMEI_REGEX.test(imei2)) errors.push('imei2 must be exactly 15 digits.');
    if (imei2 && imei2 === imei1) errors.push('imei1 and imei2 must be different.');
    if (customerName.length < 2 || customerName.length > 100) errors.push('customerName must be 2-100 characters.');
    if (!MOBILE_REGEX.test(customerMobile)) errors.push('customerMobile must be a valid 10-digit number.');
    if (!AADHAAR_REGEX.test(aadhaarNumber)) errors.push('aadhaarNumber must be a valid 12-digit number.');

    if (errors.length) {
      rowErrors.push({ row: line, errors });
    } else {
      rows.push({
        imei1,
        imei2: imei2 || undefined,
        deviceModel: deviceModel || undefined,
        customerName,
        customerMobile,
        aadhaarNumber,
      });
    }
  });

  if (rowErrors.length) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.IVS.CSV_ROW_ERRORS, rowErrors);
  }

  return rows;
};

module.exports = { verifyImeiValidator, historyQueryValidator, parseBulkCsv };
