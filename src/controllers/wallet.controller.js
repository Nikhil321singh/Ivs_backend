const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
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
  handleRazorpayWebhook,
};
