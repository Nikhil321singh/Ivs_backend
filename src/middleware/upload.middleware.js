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

const requireProfileImage = (req, res, next) => {
  if (!req.file) {
    return next(new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.USER.PROFILE_IMAGE_REQUIRED, [
      { field: 'profileImage', message: MESSAGES.USER.PROFILE_IMAGE_REQUIRED },
    ]));
  }
  next();
};

// CSV upload for bulk IMEI verification. Kept in memory (req.file.buffer) and
// parsed downstream; capped at 1MB (a 10-row CSV is tiny). Accepts by .csv
// extension since CSV MIME types vary wildly across clients.
const CSV_MAX_BYTES = 1 * 1024 * 1024;
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!/\.csv$/i.test(file.originalname || '')) {
      return cb(new ApiError(httpStatus.BAD_REQUEST, 'Only .csv files are allowed.'));
    }
    cb(null, true);
  },
});

const uploadCsv = (req, res, next) => {
  csvUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(httpStatus.BAD_REQUEST, 'CSV file must be smaller than 1MB.'));
      }
      return next(new ApiError(httpStatus.BAD_REQUEST, err.message));
    }
    if (err) return next(err);
    next();
  });
};

module.exports = { uploadProfileImage, requireProfileImage, uploadCsv };
