const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const subscriptionService = require('../services/subscription.service');
const paymentService = require('../services/payment.service');

const createOrder = asyncHandler(async (req, res) => {
  const order = await subscriptionService.createOrder(req.user.id, {
    planCode: req.body.planCode,
    custom: req.body.quantities,
  });

  successResponse(res, httpStatus.CREATED, MESSAGES.SUBSCRIPTION.ORDER_CREATED, order);
});

/**
 * Client-side fast-path, identical to the wallet one — it shares
 * paymentService.verifyPayment, which dispatches on the order's `purpose`, so
 * the webhook stays the source of truth and both paths are idempotent.
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const { orderId, paymentId, signature } = req.body;

  const result = await paymentService.verifyPayment(req.user.id, { orderId, paymentId, signature });

  successResponse(res, httpStatus.OK, MESSAGES.SUBSCRIPTION.PURCHASED, result);
});

const listPurchases = asyncHandler(async (req, res) => {
  const data = await subscriptionService.listPurchases(req.user.id, {
    page: req.query.page,
    limit: req.query.limit,
  });

  successResponse(res, httpStatus.OK, MESSAGES.SUBSCRIPTION.PURCHASES_FETCHED, data);
});

module.exports = { createOrder, verifyPayment, listPurchases };
