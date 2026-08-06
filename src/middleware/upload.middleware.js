const multer = require('multer');
const env = require('../config/env');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// Keep the uploaded file in memory (req.file.buffer) — it's streamed
// straight to the storage provider, so it never touches local disk.
const storage = multer.memoryStorage();

// Builds a multer fileFilter that only accepts the given mime types and rejects
// anything else with a client-friendly error routed through the global handler.
const mimeFilter = (allowed, label) => (req, file, cb) => {
  if (!allowed.includes(file.mimetype)) {
    return cb(new ApiError(httpStatus.BAD_REQUEST, `Only ${label} are allowed.`));
  }
  cb(null, true);
};

const imageUpload = multer({
  storage,
  fileFilter: mimeFilter(IMAGE_MIME_TYPES, 'JPG, PNG, and WEBP images'),
  limits: { fileSize: env.upload.maxSizeMb * 1024 * 1024 },
});

// Wraps a multer middleware so its errors (file too large, wrong type) flow
// through the same global error handler as everything else, with a friendly
// size message.
const wrap = (mw, sizeLabel) => (req, res, next) => {
  mw(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(
            httpStatus.BAD_REQUEST,
            `${sizeLabel} must be smaller than ${env.upload.maxSizeMb}MB.`
          )
        );
      }
      return next(new ApiError(httpStatus.BAD_REQUEST, err.message));
    }
    if (err) return next(err);
    next();
  });
};

// --- Profile image (single, images only) ---
const uploadProfileImage = wrap(imageUpload.single('profileImage'), 'Profile image');

const requireProfileImage = (req, res, next) => {
  if (!req.file) {
    return next(new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.USER.PROFILE_IMAGE_REQUIRED, [
      { field: 'profileImage', message: MESSAGES.USER.PROFILE_IMAGE_REQUIRED },
    ]));
  }
  next();
};

// --- Generic media (multiple images under `files`) ---
const MEDIA_MAX_FILES = 10;
const uploadMediaFiles = wrap(imageUpload.array('files', MEDIA_MAX_FILES), 'Each image');

const requireMediaFiles = (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next(new ApiError(httpStatus.UNPROCESSABLE_ENTITY, MESSAGES.MEDIA.NO_FILES, [
      { field: 'files', message: MESSAGES.MEDIA.NO_FILES },
    ]));
  }
  next();
};

module.exports = {
  uploadProfileImage,
  requireProfileImage,
  uploadMediaFiles,
  requireMediaFiles,
};
