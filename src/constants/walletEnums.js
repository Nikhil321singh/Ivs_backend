/**
 * Enums shared by the wallet/payment/referral models and services so the
 * ledger vocabulary lives in exactly one place.
 */
const TXN_TYPE = Object.freeze({
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
});

const TXN_REASON = Object.freeze({
  TOPUP: 'TOPUP', // tokens bought via Razorpay
  FEATURE_CHARGE: 'FEATURE_CHARGE', // tokens spent on IVS / Diagnose / etc.
  REFERRAL_BONUS: 'REFERRAL_BONUS', // reward to the referrer
  WELCOME_BONUS: 'WELCOME_BONUS', // reward to the referred user
  SIGNUP_BONUS: 'SIGNUP_BONUS', // free tokens granted to every new account
  REFUND: 'REFUND', // tokens returned to the user
  ADJUSTMENT: 'ADJUSTMENT', // manual/admin correction
});

const TXN_STATUS = Object.freeze({
  COMPLETED: 'COMPLETED',
  REVERSED: 'REVERSED',
});

const TXN_REF_TYPE = Object.freeze({
  PAYMENT: 'PAYMENT',
  IVS_CHECK: 'IVS_CHECK',
  DIAGNOSE: 'DIAGNOSE',
  REFERRAL: 'REFERRAL',
});

const PAYMENT_STATUS = Object.freeze({
  CREATED: 'CREATED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
});

const REFERRAL_STATUS = Object.freeze({
  PENDING: 'PENDING',
  REWARDED: 'REWARDED',
});

module.exports = {
  TXN_TYPE,
  TXN_REASON,
  TXN_STATUS,
  TXN_REF_TYPE,
  PAYMENT_STATUS,
  REFERRAL_STATUS,
};
