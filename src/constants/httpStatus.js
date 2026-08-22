module.exports = {
  OK: 200,
  CREATED: 201,
  // POST -> GET redirect. 303 (not 302) so the Razorpay callback's form POST
  // is guaranteed to be re-issued as a GET of the result page.
  SEE_OTHER: 303,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  // An upstream provider failed, not us — distinguishes "their outage" from
  // "our bug", which matters when a client decides whether retrying can help.
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
};
