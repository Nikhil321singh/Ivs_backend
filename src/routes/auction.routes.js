const express = require('express');
const auctionController = require('../controllers/auction.controller');
const authenticate = require('../middleware/auth.middleware');
const requireKyc = require('../middleware/requireKyc.middleware');
const requireFeatureAccess = require('../middleware/requireFeatureAccess.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { uploadAuctionPhotos } = require('../middleware/upload.middleware');
const { bidLimiter } = require('../middleware/rateLimiter.middleware');
const {
  auctionIdParamValidator,
  createAuctionValidator,
  updateAuctionValidator,
  cancelAuctionValidator,
  placeBidValidator,
  browseAuctionsValidator,
  myListingsValidator,
  myBidsValidator,
  payAuctionValidator,
  buyNowValidator,
} = require('../validators/auction.validator');

const router = express.Router();

/**
 * Auctions. Two rules run through every route here:
 *
 *  - KYC is required to list or bid. Auctions are the one place users transact
 *    with each other rather than with us — see requireKyc.middleware.js.
 *  - Browsing and reading are open to any signed-in user; only the money paths
 *    are gated.
 *
 * All amounts on the wire are in PAISE. All times are decided by the server —
 * a response's `serverTime` and `secondsRemaining` are what a client should
 * count down from, never its own clock.
 *
 * NOTE: there is no auction-specific payment callback or webhook. Winner
 * payments run through the shared /wallet/topup/callback and
 * /wallet/webhook/razorpay, which dispatch on the order's `purpose`.
 */

/* ------------------------------------------------------------------ *
 * Fixed paths first — /my/... must be matched before /:auctionId, or
 * "my" would be parsed as an auction id.
 * ------------------------------------------------------------------ */

/**
 * @openapi
 * /auctions/my/listings:
 *   get:
 *     tags: [Auctions]
 *     summary: The caller's own listings (Draft / Live / Ended / Sold)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, example: "LIVE,SCHEDULED" }
 *         description: Comma-separated auction statuses.
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200: { description: Your listings fetched successfully }
 */
router.get(
  '/my/listings',
  authenticate,
  myListingsValidator,
  validateRequest,
  auctionController.myListings
);

/**
 * @openapi
 * /auctions/my/bids:
 *   get:
 *     tags: [Auctions]
 *     summary: The caller's bids, one row per auction
 *     description: >
 *       Grouped by auction and showing the caller's most recent bid on each, so
 *       a bidder who raised four times sees one row rather than four.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: group
 *         schema: { type: string, enum: [ongoing, won, lost] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200: { description: Your bids fetched successfully }
 */
router.get('/my/bids', authenticate, myBidsValidator, validateRequest, auctionController.myBids);

/* ------------------------------------------------------------------ *
 * Browsing
 * ------------------------------------------------------------------ */

/**
 * @openapi
 * /auctions:
 *   get:
 *     tags: [Auctions]
 *     summary: Live auctions, filterable
 *     description: >
 *       Only auctions that are LIVE and have not passed their end time. The
 *       expiry check is part of the query, so an auction the closing sweep has
 *       not reached yet can never appear as biddable.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: brand
 *         schema: { type: string, example: Apple }
 *       - in: query
 *         name: condition
 *         schema: { type: string, example: "LIKE_NEW,EXCELLENT" }
 *       - in: query
 *         name: storageGb
 *         schema: { type: integer, example: 128 }
 *       - in: query
 *         name: diagnosticStatus
 *         schema: { type: string, enum: [VERIFIED, UNVERIFIED] }
 *       - in: query
 *         name: minPricePaise
 *         schema: { type: integer }
 *       - in: query
 *         name: maxPricePaise
 *         schema: { type: integer }
 *       - in: query
 *         name: endingSoonMinutes
 *         schema: { type: integer, example: 60 }
 *         description: Only auctions ending within this many minutes.
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [ENDING_SOON, NEWEST, PRICE_LOW, PRICE_HIGH, MOST_BIDS] }
 *     responses:
 *       200: { description: Auctions fetched successfully }
 *   post:
 *     tags: [Auctions]
 *     summary: Create an auction draft
 *     description: >
 *       Creates a DRAFT. Nothing is visible or billable until it is published.
 *       Amounts are in paise; times are ISO 8601 and treated as intent only.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [device, condition, startPricePaise, bidIncrementPaise, startAt, endAt]
 *             properties:
 *               device:
 *                 type: object
 *                 example: { brand: "Apple", model: "iPhone 13", storageGb: 128, color: "Midnight", imei: "355301083783251" }
 *               condition: { type: string, enum: [LIKE_NEW, EXCELLENT, GOOD, FAIR, POOR] }
 *               conditionNotes: { type: string }
 *               diagnoseSessionId: { type: string, description: "A diagnosis this account ran on the device." }
 *               imeiVerificationId: { type: string, description: "An IMEI check this account ran. BLOCKED/STOLEN cannot be published." }
 *               startPricePaise: { type: integer, example: 1500000 }
 *               bidIncrementPaise: { type: integer, example: 50000 }
 *               startAt: { type: string, format: date-time }
 *               endAt: { type: string, format: date-time }
 *     responses:
 *       201: { description: Auction draft created successfully }
 *       403: { description: KYC not completed }
 *       422: { description: Validation failed }
 */
router.get(
  '/',
  authenticate,
  browseAuctionsValidator,
  validateRequest,
  auctionController.browseAuctions
);

router.post(
  '/',
  authenticate,
  requireKyc,
  createAuctionValidator,
  validateRequest,
  auctionController.createAuction
);

/**
 * @openapi
 * /auctions/{auctionId}:
 *   get:
 *     tags: [Auctions]
 *     summary: One auction in full, with its linked diagnosis and IMEI result
 *     description: >
 *       Carries `serverTime` and `secondsRemaining`. An auction found to be past
 *       its end time is closed before it is served, so this can never return a
 *       stale "live" listing.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Auction fetched successfully }
 *       404: { description: Auction not found }
 *   patch:
 *     tags: [Auctions]
 *     summary: Edit a draft
 *     description: Only a DRAFT can be edited. Once published, the terms are frozen — people bid against a price and a deadline.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Auction updated successfully }
 *       409: { description: Auction is already published }
 */
router.get(
  '/:auctionId',
  authenticate,
  auctionIdParamValidator,
  validateRequest,
  auctionController.getAuction
);

router.patch(
  '/:auctionId',
  authenticate,
  requireKyc,
  updateAuctionValidator,
  validateRequest,
  auctionController.updateAuction
);

/**
 * @openapi
 * /auctions/{auctionId}/photos:
 *   post:
 *     tags: [Auctions]
 *     summary: Upload device photos to a draft (multipart, field "photos")
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201: { description: Photos uploaded successfully }
 *       400: { description: Too many photos for this listing }
 *       409: { description: Auction is already published }
 */
router.post(
  '/:auctionId/photos',
  authenticate,
  requireKyc,
  auctionIdParamValidator,
  validateRequest,
  uploadAuctionPhotos,
  auctionController.addPhotos
);

/**
 * @openapi
 * /auctions/{auctionId}/photos/{photoId}:
 *   delete:
 *     tags: [Auctions]
 *     summary: Remove one photo from a draft
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Photo removed successfully }
 *       404: { description: Photo not found on this listing }
 */
router.delete(
  '/:auctionId/photos/:photoId',
  authenticate,
  requireKyc,
  auctionIdParamValidator,
  validateRequest,
  auctionController.removePhoto
);

/**
 * @openapi
 * /auctions/{auctionId}/publish:
 *   post:
 *     tags: [Auctions]
 *     summary: Publish a draft — the billable moment
 *     description: >
 *       Validates the listing, charges one AUCTION_LISTING credit (or the token
 *       price, under wallet billing), and puts the auction live — or schedules
 *       it if startAt is still in the future. A device whose linked IMEI check
 *       came back BLOCKED or STOLEN is refused. The charge is idempotent per
 *       auction, so a double-tapped publish never bills twice.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Auction published successfully }
 *       402: { description: No listing credits left }
 *       422: { description: Listing is not publishable (no photos, blocked IMEI, diagnosis required) }
 */
router.post(
  '/:auctionId/publish',
  authenticate,
  requireKyc,
  auctionIdParamValidator,
  validateRequest,
  requireFeatureAccess('AUCTION_LISTING'),
  auctionController.publishAuction
);

/**
 * @openapi
 * /auctions/{auctionId}/cancel:
 *   post:
 *     tags: [Auctions]
 *     summary: Cancel a listing that has no bids
 *     description: Once a bid exists the seller is committed — pulling a listing out from under live bidders is refused with 409.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Auction cancelled successfully }
 *       409: { description: Auction already has bids }
 */
router.post(
  '/:auctionId/cancel',
  authenticate,
  requireKyc,
  cancelAuctionValidator,
  validateRequest,
  auctionController.cancelAuction
);

/**
 * @openapi
 * /auctions/{auctionId}/bids:
 *   get:
 *     tags: [Auctions]
 *     summary: Complete bid history for an auction
 *     description: Bidders are shown by first name only — a public bid history naming everyone in full is a directory of who owns what.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bid history fetched successfully }
 *   post:
 *     tags: [Auctions]
 *     summary: Place a bid
 *     description: >
 *       Every rule — live, not expired, amount clears the current bid plus the
 *       increment — is evaluated in a single atomic update against the auction
 *       document, so of two simultaneous bids exactly one can win. A repeated
 *       bid (double tap, network retry) is recognised and returns the original
 *       bid with `duplicate: true` rather than bidding twice.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amountPaise]
 *             properties:
 *               amountPaise: { type: integer, example: 1550000 }
 *               idempotencyKey: { type: string, description: "Optional. Derived from the bid when omitted." }
 *     responses:
 *       201: { description: Bid placed successfully }
 *       403: { description: Cannot bid on your own listing }
 *       409: { description: Auction closed, you are already highest, or the minimum has moved }
 */
router.get(
  '/:auctionId/bids',
  authenticate,
  auctionIdParamValidator,
  validateRequest,
  auctionController.getBidHistory
);

router.post(
  '/:auctionId/bids',
  authenticate,
  requireKyc,
  bidLimiter,
  placeBidValidator,
  validateRequest,
  auctionController.placeBid
);

/**
 * @openapi
 * /auctions/{auctionId}/pay:
 *   post:
 *     tags: [Auctions]
 *     summary: Create a Razorpay order for the device you won
 *     description: >
 *       Winner only, while the auction is PAYMENT_PENDING and inside the payment
 *       window. Reuses an already-open order rather than creating a second one.
 *       Capture is handled by the shared wallet webhook, which marks the auction
 *       SOLD.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Payment order created; open Razorpay Checkout }
 *       403: { description: You are not the winning bidder }
 *       409: { description: Nothing to pay, or the payment window has closed }
 */
router.post(
  '/:auctionId/pay',
  authenticate,
  requireKyc,
  payAuctionValidator,
  validateRequest,
  auctionController.createPaymentOrder
);

/**
 * @openapi
 * /auctions/{auctionId}/buy-now:
 *   post:
 *     tags: [Auctions]
 *     summary: Buy the device instantly at the listed price
 *     description: >
 *       Ends the auction immediately at buyNowPricePaise and opens checkout.
 *       Offered only while the current bid is still below that price — once
 *       bidding passes it, selling at it would be selling below the book, and
 *       the call is refused with 409. Everyone who bid is marked LOST and
 *       notified. The delivery address is required up front.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shippingAddress]
 *             properties:
 *               shippingAddress:
 *                 type: object
 *                 description: name, phone, line1, city, state, pincode required; line2 and landmark optional.
 *     responses:
 *       201: { description: Device reserved; open Razorpay Checkout to confirm }
 *       403: { description: You cannot buy your own listing }
 *       409: { description: Not live, no instant price, or bidding has passed it }
 */
router.post(
  '/:auctionId/buy-now',
  authenticate,
  requireKyc,
  buyNowValidator,
  validateRequest,
  auctionController.buyNow
);

module.exports = router;
