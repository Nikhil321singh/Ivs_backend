const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const env = require('../config/env');
const walletService = require('../services/wallet.service');
const paymentService = require('../services/payment.service');

const getWallet = asyncHandler(async (req, res) => {
  const wallet = await walletService.getWallet(req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.WALLET.FETCHED, { wallet });
});

const getTransactions = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  const result = await walletService.getStatement(req.user.id, { page, limit });

  successResponse(res, httpStatus.OK, MESSAGES.WALLET.TRANSACTIONS_FETCHED, result);
});

const createTopupOrder = asyncHandler(async (req, res) => {
  const order = await paymentService.createTopupOrder(req.user.id, req.body.amount);

  successResponse(res, httpStatus.CREATED, MESSAGES.PAYMENT.ORDER_CREATED, order);
});

const verifyPayment = asyncHandler(async (req, res) => {
  const { orderId, paymentId, signature } = req.body;

  const result = await paymentService.verifyPayment(req.user.id, { orderId, paymentId, signature });

  successResponse(res, httpStatus.OK, MESSAGES.PAYMENT.VERIFIED, result);
});

/**
 * Builds the URL the WebView is sent to once the callback has been processed.
 * Query params are appended by hand rather than via URL/searchParams so that
 * custom deep-link schemes (ivsapp://payment/result) survive untouched.
 */
const buildResultUrl = (base, params) => {
  const query = Object.entries(params)
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  return `${base}${base.includes('?') ? '&' : '?'}${query}`;
};

/**
 * Razorpay redirect-mode callback: a form POST from the user's WebView, not an
 * API call — no auth header, no JSON, and the response has to be a navigation.
 * Public by design; the checkout signature is what authenticates it. Tokens are
 * credited server-side here (the `redirect: true` flow never runs the client
 * handler, so /topup/verify is not called in the WebView flow).
 */
const handleTopupCallback = asyncHandler(async (req, res) => {
  const result = await paymentService.handleCheckoutCallback({
    orderId: req.body.razorpay_order_id,
    paymentId: req.body.razorpay_payment_id,
    signature: req.body.razorpay_signature,
  });

  const base =
    env.razorpay.webviewReturnUrl || `${env.apiBaseUrl}/api/v1/wallet/topup/result`;

  res.redirect(
    httpStatus.SEE_OTHER,
    buildResultUrl(base, {
      status: result.status,
      order_id: result.orderId,
      payment_id: result.paymentId,
    })
  );
});

/**
 * Fallback landing page for the redirect above when no deep link is
 * configured. Deliberately script- and style-free: helmet's CSP allows neither
 * inline, and the app is expected to detect this URL (and its `status` query
 * param) in its WebView navigation listener and close the WebView itself.
 */
const renderTopupResult = (req, res) => {
  const paid = req.query.status === 'success';
  const message = paid ? MESSAGES.PAYMENT.VERIFIED : MESSAGES.PAYMENT.CALLBACK_FAILED;

  res
    .status(httpStatus.OK)
    .type('html')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>Payment ${paid ? 'successful' : 'failed'}</title></head>` +
        `<body><h1>Payment ${paid ? 'successful' : 'failed'}</h1><p>${message}</p>` +
        `<p>You can return to the app.</p></body></html>`
    );
};

/**
 * Razorpay webhook. Mounted with a raw-body parser in app.js (before
 * express.json) so the signature can be verified over the exact bytes
 * Razorpay signed. Never trust the client callback alone — this is the source
 * of truth for crediting tokens.
 */
const handleRazorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  await paymentService.handleWebhook(req.body, signature);

  successResponse(res, httpStatus.OK, MESSAGES.PAYMENT.WEBHOOK_RECEIVED, {});
});

module.exports = {
  getWallet,
  getTransactions,
  createTopupOrder,
  verifyPayment,
  handleTopupCallback,
  renderTopupResult,
  handleRazorpayWebhook,
};
