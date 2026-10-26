const express = require('express');
const biddingKycController = require('../controllers/biddingKyc.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { uploadBiddingKycImages, requireBiddingKycPhotos } = require('../middleware/upload.middleware');
const { submitBiddingKycValidator } = require('../validators/biddingKyc.validator');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const USER_TYPE = require('../constants/userType');

const router = express.Router();

// Only individuals can submit a bidding KYC application.
const requireIndividual = (req, res, next) => {
  if (req.user.userType !== USER_TYPE.INDIVIDUAL) {
    return next(new ApiError(httpStatus.FORBIDDEN, MESSAGES.BIDDING_KYC.VENDOR_NOT_ELIGIBLE));
  }
  if (!req.user.kycCompleted) {
    return next(new ApiError(httpStatus.FORBIDDEN, MESSAGES.AUCTION.KYC_REQUIRED));
  }
  next();
};

/**
 * @openapi
 * /bidding-kyc:
 *   post:
 *     tags: [BiddingKYC]
 *     summary: Submit a bidding KYC application (individuals only)
 *     description: >
 *       Individuals who have completed their account KYC can submit this form to
 *       apply for bidding eligibility. Admin reviews and approves or rejects.
 *       Re-submission is allowed only after rejection.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [shopAddress, shopVisitingCardNumber, googleMapLink, gstNumber, shopVisitingCardPhoto, gstPhoto, udyamAadhaarPhoto, shopPhoto]
 *             properties:
 *               shopAddress: { type: string }
 *               shopVisitingCardNumber: { type: string }
 *               googleMapLink: { type: string }
 *               gstNumber: { type: string, example: "29ABCDE1234F1Z5" }
 *               shopVisitingCardPhoto: { type: string, format: binary }
 *               gstPhoto: { type: string, format: binary }
 *               udyamAadhaarPhoto: { type: string, format: binary }
 *               shopPhoto: { type: string, format: binary }
 *     responses:
 *       201: { description: Application submitted successfully }
 *       409: { description: Application already pending or approved }
 *       422: { description: Validation failed or missing photos }
 */
router.post(
  '/',
  authenticate,
  requireIndividual,
  uploadBiddingKycImages,
  requireBiddingKycPhotos,
  submitBiddingKycValidator,
  validateRequest,
  biddingKycController.submit
);

/**
 * @openapi
 * /bidding-kyc:
 *   get:
 *     tags: [BiddingKYC]
 *     summary: Get your current bidding KYC application status
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Status fetched — application may be null if not yet submitted }
 */
router.get('/', authenticate, biddingKycController.getStatus);

module.exports = router;
