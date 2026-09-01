const { body } = require('express-validator');
const env = require('../config/env');
const MESSAGES = require('../constants/messages');

/**
 * The provider accepts any string as a refid — it imposes no character or
 * length rules of its own — so the bounds here are ours. A refid round-trips
 * through a URL on the way back, and the caller is free to choose its own
 * format, so anything that would not survive that trip is refused at the door.
 */
const REFID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const initiateSessionValidator = [
  // The provider's own JWT, minted by the caller and forwarded verbatim as the
  // Token header. Optional: omitted, this server signs with its own key. Only
  // the shape is checked — three dot-separated segments — because whether the
  // signature is valid is the provider's judgement to make, not ours, and
  // guessing at it here would only add a second place that can be wrong.
  body('token')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .withMessage('token must be a JWT of the form header.payload.signature.'),

  // Travels with the token — the provider reads User-Agent as the partner id,
  // so it has to name the same partner that signed. Accepts either key, since
  // the header it becomes is spelled differently from either.
  body(['user_agent', 'partnerId'])
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 3, max: 64 })
    .withMessage('user_agent must be the partner CORP id, 3-64 characters.'),

  body('refid')
    .optional({ values: 'falsy' })
    .trim()
    .matches(REFID_PATTERN)
    .withMessage(
      'refid must be 8-64 characters of letters, digits, hyphen or underscore. ' +
        'Omit it to have one generated.'
    ),

  body('redirect_url')
    .trim()
    .notEmpty()
    .withMessage('redirect_url is required.')
    .bail()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('redirect_url must be an absolute http(s) URL.')
    .bail()
    // Host allowlisting lives here rather than in the controller so a rejected
    // host costs nothing — it never reaches the billable provider call.
    .custom((value) => {
      const { allowedRedirectHosts } = env.digilockerWrapper;
      if (allowedRedirectHosts.length === 0) return true;

      const host = new URL(value).hostname.toLowerCase();
      if (!allowedRedirectHosts.includes(host)) {
        throw new Error(MESSAGES.WRAPPER.REDIRECT_HOST_NOT_ALLOWED);
      }

      return true;
    }),
];

module.exports = { initiateSessionValidator, REFID_PATTERN };
