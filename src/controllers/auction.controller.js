const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const auctionService = require('../services/auction.service');
const bidService = require('../services/bid.service');
const auctionPaymentService = require('../services/auctionPayment.service');

const createAuction = asyncHandler(async (req, res) => {
  const auction = await auctionService.create(req.user.id, req.body);

  successResponse(res, httpStatus.CREATED, MESSAGES.AUCTION.CREATED, { auction });
});

const updateAuction = asyncHandler(async (req, res) => {
  const auction = await auctionService.update(req.user.id, req.params.auctionId, req.body);

  successResponse(res, httpStatus.OK, MESSAGES.AUCTION.UPDATED, { auction });
});

const addPhotos = asyncHandler(async (req, res) => {
  const auction = await auctionService.addPhotos(req.user.id, req.params.auctionId, req.files);

  successResponse(res, httpStatus.CREATED, MESSAGES.AUCTION.PHOTOS_ADDED, { auction });
});

const removePhoto = asyncHandler(async (req, res) => {
  const auction = await auctionService.removePhoto(
    req.user.id,
    req.params.auctionId,
    req.params.photoId
  );

  successResponse(res, httpStatus.OK, MESSAGES.AUCTION.PHOTO_REMOVED, { auction });
});

/**
 * Publishing is the billable moment — requireFeatureAccess has already decided
 * which system pays and, for the wallet path, the exact price it checked
 * against. Both are passed through rather than re-read, so a price changed
 * mid-request cannot alter what the seller is charged.
 */
const publishAuction = asyncHandler(async (req, res) => {
  const auction = await auctionService.publish(req.user.id, req.params.auctionId, {
    billingSource: req.billingSource,
    cost: req.featureCost,
  });

  successResponse(res, httpStatus.OK, MESSAGES.AUCTION.PUBLISHED, { auction });
});

const cancelAuction = asyncHandler(async (req, res) => {
  const auction = await auctionService.cancel(req.user.id, req.params.auctionId, req.body.reason);

  successResponse(res, httpStatus.OK, MESSAGES.AUCTION.CANCELLED, { auction });
});

const browseAuctions = asyncHandler(async (req, res) => {
  const data = await auctionService.browse(req.query, req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.AUCTION.LIST_FETCHED, data);
});

const getAuction = asyncHandler(async (req, res) => {
  const auction = await auctionService.getById(req.params.auctionId, req.user.id);

  successResponse(res, httpStatus.OK, MESSAGES.AUCTION.FETCHED, { auction });
});

const myListings = asyncHandler(async (req, res) => {
  const data = await auctionService.myListings(req.user.id, req.query);

  successResponse(res, httpStatus.OK, MESSAGES.AUCTION.LISTINGS_FETCHED, data);
});

const placeBid = asyncHandler(async (req, res) => {
  const result = await bidService.placeBid(req.user.id, req.params.auctionId, {
    amountPaise: req.body.amountPaise,
    idempotencyKey: req.body.idempotencyKey,
    ip: req.ip,
  });

  successResponse(res, httpStatus.CREATED, MESSAGES.BID.PLACED, {
    bid: {
      id: String(result.bid._id),
      amountPaise: result.bid.amountPaise,
      amountInr: result.bid.amountPaise / 100,
      status: result.bid.status,
      createdAt: result.bid.createdAt,
    },
    auction: auctionService.decorate(result.auction, { viewerId: req.user.id }),
    // True when this request was a retry of one already recorded — the client
    // can treat it as success without showing "bid placed" twice.
    duplicate: result.duplicate,
    // True when the bid landed late enough to push the end time out.
    extended: !!result.extended,
  });
});

const getBidHistory = asyncHandler(async (req, res) => {
  const data = await bidService.getHistory(req.params.auctionId, req.query);

  successResponse(res, httpStatus.OK, MESSAGES.BID.HISTORY_FETCHED, data);
});

const myBids = asyncHandler(async (req, res) => {
  const data = await bidService.getMyBids(req.user.id, req.query);

  successResponse(res, httpStatus.OK, MESSAGES.BID.MY_BIDS_FETCHED, data);
});

const createPaymentOrder = asyncHandler(async (req, res) => {
  const order = await auctionPaymentService.createOrder(req.user.id, req.params.auctionId);

  successResponse(res, httpStatus.CREATED, MESSAGES.AUCTION.PAYMENT_ORDER_CREATED, order);
});

module.exports = {
  createAuction,
  updateAuction,
  addPhotos,
  removePhoto,
  publishAuction,
  cancelAuction,
  browseAuctions,
  getAuction,
  myListings,
  placeBid,
  getBidHistory,
  myBids,
  createPaymentOrder,
};
