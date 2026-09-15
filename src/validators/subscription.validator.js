const { body } = require('express-validator');

/**
 * Quantities only — never a price. What a custom pack costs is decided by
 * plan.service.quoteCustom and nowhere else; a price in the body is ignored.
 */
const quantitiesValidator = [
  body('quantities')
    .exists()
    .withMessage('quantities is required.')
    .bail()
    .isObject()
    .withMessage('quantities must be an object, e.g. { "IVS_CHECK": 120, "DIAGNOSE": 60 }.'),
  body('quantities.*')
    .isInt({ min: 0 })
    .withMessage('Each quantity must be a whole number.')
    .toInt(),
];

/**
 * An order is either a catalogue plan (`planCode`) or a custom quantity
 * (`quantities`). Exactly one of them must be present — accepting both would
 * leave which one wins to the reading order of the service.
 */
const createOrderValidator = [
  body().custom((_value, { req }) => {
    const hasCode = typeof req.body.planCode === 'string' && req.body.planCode.trim() !== '';
    const hasQuantities = req.body.quantities && typeof req.body.quantities === 'object';

    if (!hasCode && !hasQuantities) {
      throw new Error('Provide either planCode or quantities.');
    }
    if (hasCode && hasQuantities) {
      throw new Error('Provide planCode or quantities, not both.');
    }
    return true;
  }),
  body('planCode').optional().isString().trim(),
  body('quantities').optional().isObject(),
  body('quantities.*').optional().isInt({ min: 0 }).toInt(),
];

module.exports = { quantitiesValidator, createOrderValidator };
