const multer = require('multer');
const env = require('../config/env');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// Keep the uploaded file in memory (req.file.buffer) — it's streamed
// straight to the storage provider, so it never touches local disk.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new ApiError(httpStatus.BAD_REQUEST, 'Only JPG, PNG, and WEBP images are allowed.'));
  }
  cb(null, true);
};

const multerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.upload.maxSizeMb * 1024 * 1024 },
});

/**
 * Wraps multer's single-file upload so its errors (file too large, wrong
 * type) flow through the same global error handler as everything else,
 * instead of multer's own default error format.
 */
const uploadProfileImage = (req, res, next) => {
  multerUpload.single('profileImage')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(
            httpStatus.BAD_REQUEST,
            `Profile image must be smaller than ${env.upload.maxSizeMb}MB.`
          )
        );
      }
      return next(new ApiError(httpStatus.BAD_REQUEST, err.message));
    }
    if (err) return next(err);
    next();
  });
};

/**
 * complete-kyc accepts up to two images: the vendor's owner photo (profileImage)
 * and an optional business-proof photo (businessProofImage — GSTIN or Udyam
 * Aadhaar). multer .fields() populates req.files[field] as an array; the
 * controller reads [0] from each. Errors flow through the global handler as above.
 */
const uploadKycImages = (req, res, next) => {
  const handler = multerUpload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'businessProofImage', maxCount: 1 },
  ]);
  handler(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(
            httpStatus.BAD_REQUEST,
            `Images must be smaller than ${env.upload.maxSizeMb}MB.`
          )
        );
      }
      return next(new ApiError(httpStatus.BAD_REQUEST, err.message));
    }
    if (err) return next(err);
    next();
  });
};

/**
 * Auction device photos: several files under one field, unlike the two handlers
 * above which take one image each. `MAX_AUCTION_PHOTOS` is only multer's hard
 * ceiling for a single request — the real per-listing limit is the operator's
 * `auctionMaxPhotos` setting, enforced in auction.service.js where the existing
 * photo count is known.
 */
const MAX_AUCTION_PHOTOS = 20;

const uploadAuctionPhotos = (req, res, next) => {
  multerUpload.array('photos', MAX_AUCTION_PHOTOS)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(
            httpStatus.BAD_REQUEST,
            `Each photo must be smaller than ${env.upload.maxSizeMb}MB.`
          )
        );
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(
          new ApiError(
            httpStatus.BAD_REQUEST,
            `Send photos in the "photos" field, at most ${MAX_AUCTION_PHOTOS} per request.`
          )
        );
      }
      return next(new ApiError(httpStatus.BAD_REQUEST, err.message));
    }
    if (err) return next(err);
    next();
  });
};

const requireProfileImage = (req, res, next) => {
  if (!req.file) {
    return next(new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.USER.PROFILE_IMAGE_REQUIRED, [
      { field: 'profileImage', message: MESSAGES.USER.PROFILE_IMAGE_REQUIRED },
    ]));
  }
  next();
};

/**
 * Bidding KYC form: four required images uploaded in one multipart request.
 */
const uploadBiddingKycImages = (req, res, next) => {
  const handler = multerUpload.fields([
    { name: 'shopVisitingCardPhoto', maxCount: 1 },
    { name: 'gstPhoto', maxCount: 1 },
    { name: 'udyamAadhaarPhoto', maxCount: 1 },
    { name: 'shopPhoto', maxCount: 1 },
  ]);
  handler(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(
            httpStatus.BAD_REQUEST,
            `Images must be smaller than ${env.upload.maxSizeMb}MB.`
          )
        );
      }
      return next(new ApiError(httpStatus.BAD_REQUEST, err.message));
    }
    if (err) return next(err);
    next();
  });
};

const requireBiddingKycPhotos = (req, res, next) => {
  const files = req.files || {};
  const required = [
    ['shopVisitingCardPhoto', MESSAGES.BIDDING_KYC.VISITING_CARD_PHOTO_REQUIRED],
    ['gstPhoto', MESSAGES.BIDDING_KYC.GST_PHOTO_REQUIRED],
    ['udyamAadhaarPhoto', MESSAGES.BIDDING_KYC.UDYAM_AADHAAR_PHOTO_REQUIRED],
    ['shopPhoto', MESSAGES.BIDDING_KYC.SHOP_PHOTO_REQUIRED],
  ];
  const errors = required
    .filter(([field]) => !files[field] || !files[field].length)
    .map(([field, message]) => ({ field, message }));

  if (errors.length) {
    return next(new ApiError(httpStatus.UNPROCESSABLE_ENTITY, errors[0].message, errors));
  }
  next();
};

module.exports = {
  uploadProfileImage,
  uploadKycImages,
  uploadAuctionPhotos,
  requireProfileImage,
  uploadBiddingKycImages,
  requireBiddingKycPhotos,
};
