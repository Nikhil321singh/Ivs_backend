/**
 * Dev helper: compute the Razorpay checkout signature the /wallet/topup/verify
 * endpoint expects, for manual testing WITHOUT the frontend.
 *
 *   node scripts/sign.js <orderId> <paymentId>
 *
 * signature = HMAC_SHA256(`${orderId}|${paymentId}`, RAZORPAY_KEY_SECRET)
 *
 * The orderId must be a real order you created via POST /wallet/topup/order
 * (the server looks up the Payment row). The paymentId can be any string for
 * manual testing — verifyCheckoutSignature only checks the HMAC, not that the
 * payment exists at Razorpay.
 *
 * NOTE: local/testing utility only — never expose signing server-side; the
 * secret must stay on the server.
 */
require('dotenv').config();
const crypto = require('crypto');

const [, , orderId, paymentId = `pay_test_${Date.now()}`] = process.argv;

if (!orderId) {
  console.error('Usage: node scripts/sign.js <orderId> [paymentId]');
  process.exit(1);
}

const secret = process.env.RAZORPAY_KEY_SECRET;
if (!secret || /^your_/.test(secret)) {
  console.error('RAZORPAY_KEY_SECRET is missing or still a placeholder in .env');
  process.exit(1);
}

const signature = crypto
  .createHmac('sha256', secret)
  .update(`${orderId}|${paymentId}`)
  .digest('hex');

// Print both a readable summary and a ready-to-paste JSON body for /verify.
console.log(JSON.stringify({ orderId, paymentId, signature }, null, 2));
