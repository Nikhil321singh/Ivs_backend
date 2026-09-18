const { body, param, query } = require('express-validator');
const { DEVICE_CONDITION, AUCTION_STATUS, AUCTION_SORT } = require('../constants/auctionEnums');

/**
 * Money is always in PAISE on the wire, matching Payment.amountPaise and the
 * credit-pack endpoints. Accepting rupees anywhere would guarantee that one
 * client eventually sends 1500 meaning ₹1,500 and gets ₹15.
 *
 * Times are ISO 8601 strings and are only ever used as the seller's INTENT.
 * Whether an auction is actually running is decided server-side against the
 * database clock — see auction.service.js.
 */

const auctionIdParamValidator = [
  param('auctionId').isMongoId().withMessage('A valid auction id is required.'),
];

const deviceRules = (optional) => {
  const maybe = (chain) => (optional ? chain.optional() : chain);

  return [
    maybe(body('device').isObject().withMessage('device is required.')),
    maybe(
      body('device.brand')
        .trim()
        .notEmpty()
        .withMessage('Device brand is required.')
        .isLength({ max: 60 })
        .withMessage('Device brand must be 60 characters or fewer.')
    ),
    maybe(
      body('device.model')
        .trim()
        .notEmpty()
        .withMessage('Device model is required.')
        .isLength({ max: 120 })
        .withMessage('Device model must be 120 characters or fewer.')
    ),
    body('device.storageGb').optional({ nullable: true }).isInt({ min: 0, max: 4096 }).toInt(),
    body('device.ramGb').optional({ nullable: true }).isInt({ min: 0, max: 1024 }).toInt(),
    body('device.color').optional({ nullable: true }).trim().isLength({ max: 40 }),
    body('device.imei')
      .optional({ nullable: true })
      .trim()
      .matches(/^\d{15}$/)
      .withMessage('IMEI must be exactly 15 digits.'),
  ];
};

const termRules = (optional) => {
  const maybe = (chain) => (optional ? chain.optional() : chain);

  return [
    maybe(
      body('condition')
        .isIn(Object.values(DEVICE_CONDITION))
        .withMessage(`condition must be one of: ${Object.values(DEVICE_CONDITION).join(', ')}.`)
    ),
    body('conditionNotes').optional({ nullable: true }).trim().isLength({ max: 2000 }),
    // Grest c2b diagnostic snapshot (see Auction.model diagnosisReport). Whole
    // object optional; when present its shape is lightly checked.
    body('diagnosisReport').optional({ nullable: true }).isObject(),
    body('diagnosisReport.grade').optional({ nullable: true }).trim().isLength({ max: 8 }),
    body('diagnosisReport.estimatedValueInr').optional({ nullable: true }).isInt({ min: 0 }).toInt(),
    body('diagnosisReport.imei').optional({ nullable: true }).trim().isLength({ max: 20 }),
    body('diagnosisReport.properties').optional({ nullable: true }).isObject(),
    body('diagnosisReport.passed').optional({ nullable: true }).isInt({ min: 0 }).toInt(),
    body('diagnosisReport.failed').optional({ nullable: true }).isInt({ min: 0 }).toInt(),
    body('diagnosisReport.total').optional({ nullable: true }).isInt({ min: 0 }).toInt(),
    body('diagnosisReport.tests').optional({ nullable: true }).isArray({ max: 100 }),
    body('diagnosisReport.tests.*.name').optional({ nullable: true }).trim().isLength({ max: 120 }),
    body('diagnosisReport.tests.*.result').optional({ nullable: true }).trim().isLength({ max: 40 }),
    body('diagnoseSessionId').optional({ nullable: true }).isMongoId(),
    body('imeiVerificationId').optional({ nullable: true }).isMongoId(),
    maybe(
      body('startPricePaise')
        .isInt({ min: 0 })
        .withMessage('startPricePaise must be a whole number of paise.')
        .toInt()
    ),
    maybe(
      body('bidIncrementPaise')
        .isInt({ min: 1 })
        .withMessage('bidIncrementPaise must be at least 1 paisa.')
        .toInt()
    ),
    maybe(body('startAt').isISO8601().withMessage('startAt must be an ISO 8601 date.').toDate()),
    maybe(body('endAt').isISO8601().withMessage('endAt must be an ISO 8601 date.').toDate()),
  ];
};

const createAuctionValidator = [...deviceRules(false), ...termRules(false)];

// Every field optional — a PATCH may carry any subset of a draft's fields.
const updateAuctionValidator = [
  ...auctionIdParamValidator,
  ...deviceRules(true),
  ...termRules(true),
];

const cancelAuctionValidator = [
  ...auctionIdParamValidator,
  body('reason').optional({ nullable: true }).trim().isLength({ max: 500 }),
];

const placeBidValidator = [
  ...auctionIdParamValidator,
  body('amountPaise')
    .notEmpty()
    .withMessage('amountPaise is required.')
    .bail()
    .isInt({ min: 1 })
    .withMessage('amountPaise must be a positive whole number of paise.')
    .toInt(),
  // Optional: the client may supply its own key for a retry it knows about.
  // When absent the service derives one from the bid itself, which is what
  // makes a double-tapped button harmless.
  body('idempotencyKey').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
];

const browseAuctionsValidator = [
  query('brand').optional().trim().isLength({ max: 60 }),
  query('condition').optional().trim(),
  query('storageGb').optional().isInt({ min: 0 }).toInt(),
  query('diagnosticStatus').optional().trim(),
  query('minPricePaise').optional().isInt({ min: 0 }).toInt(),
  query('maxPricePaise').optional().isInt({ min: 0 }).toInt(),
  query('endingSoonMinutes').optional().isInt({ min: 1, max: 10080 }).toInt(),
  query('search').optional().trim().isLength({ max: 100 }),
  query('sort')
    .optional()
    .isIn(Object.values(AUCTION_SORT))
    .withMessage(`sort must be one of: ${Object.values(AUCTION_SORT).join(', ')}.`),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
];

const myListingsValidator = [
  query('status')
    .optional()
    .custom((value) => {
      const allowed = Object.values(AUCTION_STATUS);
      const invalid = String(value)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !allowed.includes(s));

      if (invalid.length) {
        throw new Error(`Unknown status: ${invalid.join(', ')}.`);
      }
      return true;
    }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
];

const myBidsValidator = [
  query('group')
    .optional()
    .isIn(['ongoing', 'won', 'lost'])
    .withMessage('group must be one of: ongoing, won, lost.'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = {
  auctionIdParamValidator,
  createAuctionValidator,
  updateAuctionValidator,
  cancelAuctionValidator,
  placeBidValidator,
  browseAuctionsValidator,
  myListingsValidator,
  myBidsValidator,
};
