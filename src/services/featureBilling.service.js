const walletService = require('./wallet.service');
const entitlementService = require('./entitlement.service');
const { TXN_REASON } = require('../constants/walletEnums');
const { BILLING_SOURCE, ENTITLEMENT_REASON } = require('../constants/entitlementEnums');

/**
 * Charges one use of a paid feature through whichever billing system approved
 * the request.
 *
 * `requireFeatureAccess` decides ENTITLEMENT vs WALLET up front and puts the
 * answer on the request; this takes that decision and executes it. The decision
 * is never re-derived here — an operator flipping `billingMode` mid-request must
 * not be able to charge someone through a system that never approved them.
 *
 * Both branches are the same atomic conditional decrement their own services
 * already provide, so neither can drive a balance or a counter negative, and
 * both are idempotent when given a key.
 */
const chargeFeature = async (
  userId,
  featureKey,
  { billingSource, cost = 0, referenceType = null, referenceId = null, idempotencyKey = null, metadata = null }
) => {
  if (billingSource === BILLING_SOURCE.ENTITLEMENT) {
    const txn = await entitlementService.consume(userId, featureKey, {
      reason: ENTITLEMENT_REASON.FEATURE_USE,
      referenceType,
      referenceId,
      idempotencyKey,
      metadata,
    });

    return { source: BILLING_SOURCE.ENTITLEMENT, cost: 0, creditsUsed: 1, txnId: txn._id };
  }

  // A feature priced at zero is free: debit() rejects a non-positive amount, and
  // writing a zero-value ledger row would be noise rather than an audit trail.
  if (!cost || cost <= 0) {
    return { source: BILLING_SOURCE.WALLET, cost: 0, creditsUsed: 0, txnId: null };
  }

  const txn = await walletService.debit(userId, cost, {
    reason: TXN_REASON.FEATURE_CHARGE,
    referenceType,
    referenceId,
    idempotencyKey,
    metadata: { feature: featureKey, ...(metadata || {}) },
  });

  return { source: BILLING_SOURCE.WALLET, cost, creditsUsed: 0, txnId: txn._id };
};

module.exports = { chargeFeature };
