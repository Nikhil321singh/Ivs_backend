/**
 * Confirms whether this machine can reach the DigiLocker APIs.
 *
 *   node scripts/check-digilocker.js
 *   npm run check:digilocker
 *
 * Run it on the SERVER (not a laptop) the moment the provider says the IP is
 * whitelisted — that is the whole point: the provider gates on source IP, so
 * the answer differs per host and only the server's answer matters.
 *
 * Interpreting the result:
 *
 *   "Invalid user.<ip>"  the IP is still not whitelisted. Nothing else is
 *                        wrong; this rejection happens before credentials are
 *                        checked, verified by sending a deliberately invalid
 *                        JWT key and getting the identical response.
 *
 *   200 + authorization_url  whitelisting is live and the integration works.
 *
 * Nothing is written to the database and no user data is involved. The call is
 * non-billable while it fails (201) and billable only once it succeeds (200).
 */
const env = require('../src/config/env');
const provider = require('../src/services/providers/digiLockerProvider');

const line = (label, value) => console.log(`  ${label.padEnd(16)} ${value}`);

(async () => {
  console.log('\nDigiLocker connectivity check\n');
  line('base URL', env.paysprint.baseUrl || '(unset)');
  line('partner ID', env.paysprint.partnerId || '(unset)');
  line('JWT key', env.paysprint.jwtKey ? 'set' : 'MISSING');
  line('Authorisedkey', process.env.PAYSPRINT_AUTHORISEDKEY ? 'set' : 'falling back to JWT key');
  line('redirect URL', env.digilocker.redirectUrl);

  if (!env.paysprint.baseUrl || !env.paysprint.partnerId || !env.paysprint.jwtKey) {
    console.log('\n  ✗ Configuration incomplete — see .env.example\n');
    process.exit(1);
  }

  const refid = `CHECK${Date.now()}`;
  const startedAt = Date.now();
  const result = await provider.initiateSession(refid, env.digilocker.redirectUrl);

  console.log('\nResult\n');
  line('http status', result.status === null ? 'no response' : result.status);
  line('billable', result.billable);
  line('elapsed', `${Date.now() - startedAt}ms`);
  line('message', result.message || '(none)');

  // pickMessage() returns null for a non-JSON body, which is exactly what an
  // edge rejection looks like — an HTML error page. Print it, or the whole
  // failure is invisible and indistinguishable from a silent provider bug.
  if (!result.message && result.data != null) {
    const raw =
      typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    line('raw body', raw.replace(/\s+/g, ' ').slice(0, 300));
  }

  if (result.ok) {
    line('authorization', result.authorizationUrl);
    console.log('\n  ✓ Working. The IP is whitelisted and a session was created.\n');
    process.exit(0);
  }

  if (/invalid user/i.test(result.message || '')) {
    // Anchored to four octets so the separating dot after "user" is not captured.
    const ip = (result.message.match(/(\d{1,3}(?:\.\d{1,3}){3})\s*$/) || [])[1];
    console.log(`\n  ✗ Still blocked. Ask the provider to whitelist${ip ? ` ${ip}` : ' this host'}.`);
    console.log('    Everything else is configured correctly — this rejection');
    console.log('    happens before any credential is validated.\n');
    process.exit(2);
  }

  // A 403 carrying no parseable message is NOT the documented rejection: it
  // comes from the edge (WAF/CDN/nginx) before the provider application runs,
  // which is how a production host normally enforces an IP allow-list. The
  // tell is an empty body plus a sub-100ms response — far too fast for a
  // request that validated a JWT and reached UIDAI.
  if (result.status === 403) {
    console.log('\n  ✗ Blocked at the edge, before the provider application ran.');
    console.log('    Most likely the same IP allow-list: production gates at the');
    console.log('    gateway instead of returning "Invalid user.<ip>". Confirm the');
    console.log('    egress IP with `curl -s https://api.ipify.org` and send it to');
    console.log('    the provider, asking whether they gate at the gateway.\n');
    process.exit(2);
  }

  console.log('\n  ✗ Failed for a different reason than IP whitelisting — see message above.\n');
  process.exit(3);
})().catch((err) => {
  console.error('\n  ✗ Check threw:', err.message, '\n');
  process.exit(1);
});
