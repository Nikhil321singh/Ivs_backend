const express = require('express');
const wrapperController = require('../controllers/wrapper.controller');

const router = express.Router();

/**
 * DigiLocker wrapper — deliberately UNAUTHENTICATED.
 *
 * The caller is our own app on Lambda, whose egress IP rotates; this route
 * exists purely to lend it this server's fixed IP for the provider call.
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

module.exports = router;
