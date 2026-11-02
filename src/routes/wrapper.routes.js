const express = require('express');
const wrapperController = require('../controllers/wrapper.controller');
const vendorAuth = require('../middleware/vendorAuth.middleware');

const router = express.Router();

/**
 * DigiLocker wrapper — deliberately UNAUTHENTICATED.
 *
 * The caller is our own app on Lambda, whose egress IP rotates; these routes
 * exist purely to lend it this server's fixed IP for the provider calls.
 *
 * All five provider operations are covered — initiate, access-token,
 * issued-files, download-xml and revoke-token — because the allowlist applies to
 * every outbound call, not just the first. The caller drives the sequence and owns the refid; nothing here
 * stores a session or decides which document matters.
 * Everything it needs arrives in the body, and no user, JWT or shared secret is
 * involved, by design.
 *
 * Request validation has been removed at the caller's request: the body is
 * passed to the provider as given, so refid shape, redirect_url form and token
 * shape are all the caller's responsibility now.
 *
 * The consequence, recorded here so it is not rediscovered later: anyone who
 * finds this URL can make billable provider calls, and can supply their own
 * redirect_url — which points a genuine Aadhaar consent flow at a host they
 * choose. Nothing bounds that any more; DIGILOCKER_WRAPPER_REDIRECT_HOSTS is no
 * longer consulted. A malformed body is no longer refused for free either — it
 * reaches the provider, and a 422 there is billable. Every call is recorded in
 * ProviderRequestLog, which is the only way abuse would surface.
 */

/**
 * @openapi
 * /wrapper/digilocker/initiate:
 *   post:
 *     tags: [Wrapper]
 *     summary: Create a DigiLocker session on behalf of a caller without a stable IP
 *     description: >
 *       Unauthenticated server-to-server endpoint. Lends this server's fixed
 *       source IP to a caller whose own egress address rotates (the Lambda app),
 *       by making the provider's initiate_session call on its behalf. Every
 *       successful call is billed by the provider.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [redirect_url]
 *             properties:
 *               token: { type: string, description: "Optional. The caller's own Paysprint JWT, forwarded verbatim as the provider's Token header. Omit it and this server signs with its own PAYSPRINT_AUTHORISED_KEY instead." }
 *               user_agent: { type: string, example: "CORP00002424", description: "Optional. Partner CORP id, sent as the provider's User-Agent header. Only meaningful alongside token; defaults to the partnerId inside that token, then to this server's own." }
 *               redirect_url: { type: string, example: "https://your-app.example.com/digilocker/callback/abc123", description: "Where the provider sends the browser after consent. Not validated — sent to the provider as given." }
 *               refid: { type: string, example: "202df2ce82b6b9bebf00b491e61a70d3", description: "Caller's own session id, sent to the provider as given. Single-use: the provider rejects a refid it has already seen. Generated if omitted." }
 *     responses:
 *       200: { description: DigiLocker session created — returns refid and authorizationUrl }
 *       502: { description: Provider refused — providerStatus and providerMessage are passed through }
 */
router.post('/digilocker/initiate', wrapperController.initiateSession);

/**
 * @openapi
 * /wrapper/digilocker/access-token:
 *   post:
 *     tags: [Wrapper]
 *     summary: Exchange a completed DigiLocker authentication for provider access
 *     description: Step 2 of 4. Must run before issued-files.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refid]
 *             properties:
 *               refid: { type: string, description: "The refid the session was opened with." }
 *               token: { type: string, description: "Optional. Caller's own Paysprint JWT, forwarded verbatim." }
 *               user_agent: { type: string, example: "CORP00002424", description: "Optional. Partner CORP id; defaults to the partnerId inside the token." }
 *     responses:
 *       200: { description: Access granted }
 *       502: { description: Provider refused — providerStatus and providerMessage are passed through }
 */
router.post('/digilocker/access-token', wrapperController.accessToken);

/**
 * @openapi
 * /wrapper/digilocker/issued-files:
 *   post:
 *     tags: [Wrapper]
 *     summary: List the documents issued to the authenticated DigiLocker account
 *     description: Step 3 of 4. Returns the file list; the caller picks the Aadhaar uri itself.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refid]
 *             properties:
 *               refid: { type: string }
 *               token: { type: string, description: "Optional. Caller's own Paysprint JWT, forwarded verbatim." }
 *               user_agent: { type: string, example: "CORP00002424" }
 *     responses:
 *       200: { description: "Returns files[] with name, doctype, issuer and uri" }
 *       502: { description: Provider refused }
 */
router.post('/digilocker/issued-files', wrapperController.issuedFiles);

/**
 * @openapi
 * /wrapper/digilocker/download-xml:
 *   post:
 *     tags: [Wrapper]
 *     summary: Download one issued document as Base64 XML
 *     description: >
 *       Step 4 of 4. Returns the provider's Base64 XML unparsed and unstored —
 *       this server keeps no copy. The caller owns whatever it does with the
 *       Aadhaar data inside.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refid, uri]
 *             properties:
 *               refid: { type: string }
 *               uri: { type: string, example: "in.gov.uidai-ADHAR-f9044e68a093881d1ffb183f479b6959", description: "From the issued-files response." }
 *               token: { type: string, description: "Optional. Caller's own Paysprint JWT, forwarded verbatim." }
 *               user_agent: { type: string, example: "CORP00002424" }
 *     responses:
 *       200: { description: Returns base64Xml }
 *       502: { description: Provider refused }
 */
router.post('/digilocker/download-xml', wrapperController.downloadXml);

/**
 * @openapi
 * /wrapper/digilocker/revoke-token:
 *   post:
 *     tags: [Wrapper]
 *     summary: End the provider-side DigiLocker session for a refid
 *     description: >
 *       Optional teardown. The flow completes without it and the provider
 *       expires sessions on its own, but a consented session left open is an
 *       outstanding capability against someone's Aadhaar — a caller that is
 *       finished should revoke rather than wait for the timeout.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refid]
 *             properties:
 *               refid: { type: string, description: "The refid the session was opened with." }
 *               token: { type: string, description: "Optional. Caller's own Paysprint JWT, forwarded verbatim." }
 *               user_agent: { type: string, example: "CORP00002424" }
 *     responses:
 *       200: { description: Session revoked }
 *       502: { description: Provider refused — providerStatus and providerMessage are passed through }
 */
router.post('/digilocker/revoke-token', wrapperController.revokeToken);

/**
 * @openapi
 * /wrapper/check-imei:
 *   post:
 *     tags: [Wrapper]
 *     summary: Check an IMEI against C-DOT's CEIR blocklist on behalf of a caller without a stable IP
 *     description: >
 *       Unauthenticated server-to-server endpoint. Lends this server's fixed
 *       source IP to a caller whose egress address rotates. Returns the CEIR
 *       result verbatim, including upstreamAnswered:false cases — the caller
 *       decides whether to bill and whether to allow the transaction.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [imei1]
 *             properties:
 *               imei1: { type: string, example: "123456789012345" }
 *               imei2: { type: string, example: "123456789012346", description: "Optional second IMEI for dual-SIM devices." }
 *     responses:
 *       200: { description: "CEIR result — check upstreamAnswered and allowTransaction in the response body" }
 */
router.post('/check-imei', vendorAuth, wrapperController.checkImei);

/**
 * @openapi
 * /wrapper/licences/buy:
 *   post:
 *     tags: [Wrapper]
 *     summary: Create a Razorpay order to buy IMEI-check licences
 *     description: >
 *       Returns a Razorpay order the vendor opens in Checkout. Licences are
 *       credited only after payment is confirmed via /licences/verify or the
 *       shared Razorpay webhook.
 *     security: [{ apiKeyAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity: { type: integer, example: 100, description: "Number of licences to buy." }
 *     responses:
 *       201: { description: Order created — open Razorpay Checkout }
 *       400: { description: Invalid quantity }
 *       500: { description: Razorpay not configured }
 */
router.post('/licences/buy', vendorAuth, wrapperController.buyLicences);

/**
 * @openapi
 * /wrapper/licences/verify:
 *   post:
 *     tags: [Wrapper]
 *     summary: Verify a completed licence payment and credit licences immediately
 *     security: [{ apiKeyAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, paymentId, signature]
 *             properties:
 *               orderId: { type: string }
 *               paymentId: { type: string }
 *               signature: { type: string }
 *     responses:
 *       200: { description: Licences credited }
 *       400: { description: Signature invalid }
 *       404: { description: Order not found }
 */
router.post('/licences/verify', vendorAuth, wrapperController.verifyLicencePurchase);

/**
 * @openapi
 * /wrapper/me:
 *   get:
 *     tags: [Wrapper]
 *     summary: Vendor licence balance
 *     description: Returns how many licences remain, how many have been used, and the total ever granted.
 *     security: [{ apiKeyAuth: [] }]
 *     responses:
 *       200: { description: Balance fetched }
 *       401: { description: Missing or invalid API key }
 */
router.get('/me', vendorAuth, wrapperController.getMyBalance);

/**
 * @openapi
 * /wrapper/me/ledger:
 *   get:
 *     tags: [Wrapper]
 *     summary: Vendor licence transaction history
 *     description: Paginated log of every grant and debit on this vendor account.
 *     security: [{ apiKeyAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200: { description: Ledger fetched }
 *       401: { description: Missing or invalid API key }
 */
router.get('/me/ledger', vendorAuth, wrapperController.getMyLedger);

module.exports = router;
