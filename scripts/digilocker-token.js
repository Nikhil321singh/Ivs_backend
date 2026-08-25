/**
 * Dev helper: mint the SprintVerify JWT that every DigiLocker request must
 * carry, for manual testing WITHOUT the app.
 *
 *   node scripts/digilocker-token.js              # token + a ready-to-paste curl
 *   node scripts/digilocker-token.js --token-only # just the token, for scripting
 *   npm run token:digilocker
 *
 * Per the DigiLocker doc §2.1-2.3: HS256 over exactly
 * { timestamp, partnerId, reqid }, signed with PAYSPRINT_AUTHORISED_KEY, valid
 * five minutes, fresh for every request — the provider rejects a reused token.
 *
 * Delegates to src/utils/paysprintToken.js rather than reimplementing the
 * signing, so this can never drift from what the server actually sends.
 *
 * NOTE: local/testing utility only. There is deliberately no HTTP endpoint for
 * this — anything that hands out a signed token hands out five minutes of
 * partner impersonation. The key stays on the server; only the token leaves.
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const { generatePaysprintToken, TOKEN_SKEW_SECONDS } = require('../src/utils/paysprintToken');

const tokenOnly = process.argv.includes('--token-only');

if (!env.paysprint.partnerId || !env.paysprint.jwtKey) {
  console.error('PAYSPRINT_PARTNER_ID or PAYSPRINT_AUTHORISED_KEY missing — see .env.example');
  process.exit(1);
}

const token = generatePaysprintToken();

if (tokenOnly) {
  console.log(token);
  process.exit(0);
}

const payload = jwt.decode(token);
// Validity runs from the claim the provider reads, not from now — the backdate
// means the token is already TOKEN_SKEW_SECONDS old the moment it is minted.
const secondsLeft = 300 - (Math.floor(Date.now() / 1000) - payload.timestamp);
const line = (label, value) => console.log(`  ${label.padEnd(12)} ${value}`);

console.log('\nDigiLocker JWT\n');
line('payload', JSON.stringify(payload));
line('algorithm', 'HS256');
line('signed with', 'PAYSPRINT_AUTHORISED_KEY');
line('valid for', `~${secondsLeft}s (5 min from timestamp, backdated ${TOKEN_SKEW_SECONDS}s)`);
console.log(`\n${token}\n`);

// A whole working request, so testing an endpoint is one paste rather than a
// reconstruction of the header set. Authorisedkey is deliberately absent:
// production rejects a wrong value with "Invalid user.<ip>" and accepts none.
const redirectUrl = env.digilocker.redirectUrl;
console.log('Ready to paste — initiate_session:\n');
console.log(`curl -sS -X POST "${env.paysprint.baseUrl}/digilocker/initiate_session" \\
  -H "Token: ${token}" \\
  -H "User-Agent: ${env.paysprint.partnerId}" \\
  -F "refid=CURL${Date.now()}" \\
  -F "redirect_url=${redirectUrl}"
`);
console.log('  ⚠  Production — no UAT host. A 200 or 422 is billed; 201 is not.');
console.log('  ⚠  Do not add an Authorisedkey header; a wrong value is rejected.\n');
