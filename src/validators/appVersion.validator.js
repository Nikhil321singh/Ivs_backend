const { body, param, query } = require('express-validator');
const { DEVICE_PLATFORM } = require('../constants/notification');
const { isValidVersion } = require('../utils/version.util');

const PLATFORMS = Object.values(DEVICE_PLATFORM);

const checkUpdateValidator = [
  query('platform')
    .trim()
    .notEmpty()
    .withMessage('Platform is required.')
    .bail()
    .toLowerCase()
    .isIn(PLATFORMS)
    .withMessage(`Platform must be one of: ${PLATFORMS.join(', ')}.`),
  // The version is optional so a client too old to send it still gets an
  // answer (it is treated as "behind" — see appVersion.service.js).
  query('version')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 32 })
    .withMessage('version is too long to be an app version.'),
];

const platformParamValidator = [
  param('platform')
    .trim()
    .toLowerCase()
    .isIn(PLATFORMS)
    .withMessage(`Platform must be one of: ${PLATFORMS.join(', ')}.`),
];

// A version that cannot be parsed would silently compare equal to everything —
// meaning no user is ever told to update — so it is refused at the door rather
// than stored and quietly ignored.
const versionField = (field, { required }) => {
  const chain = body(field);
  const validate = (value) => {
    if (!isValidVersion(value)) {
      throw new Error(`${field} must be a dotted version number, e.g. 1.4.2.`);
    }
    return true;
  };

  return required
    ? chain.trim().notEmpty().withMessage(`${field} is required.`).bail().custom(validate)
    : chain.optional({ values: 'null' }).trim().custom((value) => (value ? validate(value) : true));
};

const upsertAppVersionValidator = [
  ...platformParamValidator,
  versionField('latestVersion', { required: true }),
  versionField('minSupportedVersion', { required: false }),
  body('mandatory').optional().isBoolean().withMessage('mandatory must be true or false.').toBoolean(),
  body('releaseNotes').optional({ values: 'null' }).trim().isLength({ max: 2000 }),
  body('storeUrl')
    .optional({ values: 'falsy' })
    .trim()
    .isURL({ require_protocol: true })
    .withMessage('storeUrl must be a full URL including https://'),
  body('notify').optional().isBoolean().withMessage('notify must be true or false.').toBoolean(),
];

const notifyUpdateValidator = [
  ...platformParamValidator,
  body('title').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('body').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
];

module.exports = {
  checkUpdateValidator,
  platformParamValidator,
  upsertAppVersionValidator,
  notifyUpdateValidator,
};
