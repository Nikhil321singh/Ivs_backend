const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const ApiError = require('../utils/apiError');
const mediaService = require('../services/media.service');

// Categories a client may upload under. Each maps to an S3 key prefix
// (ivs/<category>/<userId>/...). Kept to a known set so callers can't write to
// arbitrary paths.
const ALLOWED_CATEGORIES = ['device-photos', 'signature', 'misc'];

/**
 * Uploads one or more images to S3 under the requested category and returns
 * their public URLs + keys. Auth + multer (req.files) run in the route.
 */
const uploadMedia = asyncHandler(async (req, res) => {
  const category = (req.body.category || 'misc').trim();
  if (!ALLOWED_CATEGORIES.includes(category)) {
    throw new ApiError(httpStatus.BAD_REQUEST, MESSAGES.MEDIA.INVALID_CATEGORY, [
      { field: 'category', message: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` },
    ]);
  }

  const files = await mediaService.uploadMany(req.files, { userId: req.user.id, category });
  successResponse(res, httpStatus.CREATED, MESSAGES.MEDIA.UPLOADED, { files });
});

module.exports = { uploadMedia };
