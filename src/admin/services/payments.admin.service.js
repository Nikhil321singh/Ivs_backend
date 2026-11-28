/**
 * Payments-by-purpose summary for the accounts team.
 *
 * Every payment purpose is already distinguished in the data — this service
 * just totals each one over a date range, across the four places money and
 * feature spend are recorded:
 *   - Payment            → real-money Razorpay orders (TOPUP / PLAN / AUCTION), ₹
 *   - VendorPayment      → real-money vendor licence buys, ₹
 *   - WalletTransaction  → token movements (feature charges, bonuses, refunds)
 *   - EntitlementTransaction → credit movements (plan grants, feature use)
 *
 * Cash (₹), tokens and credits are three different units, so each keeps its own
 * total — they are never added together.
 */
const Payment = require('../../models/Payment.model');
const VendorPayment = require('../../models/VendorPayment.model');
const WalletTransaction = require('../../models/WalletTransaction.model');
const EntitlementTransaction = require('../../models/EntitlementTransaction.model');
const User = require('../../models/User.model');
const Vendor = require('../../models/Vendor.model');
const { PAYMENT_STATUS, TXN_REASON } = require('../../constants/walletEnums');
const { PAYMENT_PURPOSE, ENTITLEMENT_REASON } = require('../../constants/entitlementEnums');

const humanize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

// Friendly names the accounts team sees, keyed by the raw enum value.
const CASH_LABEL = {
  [PAYMENT_PURPOSE.TOPUP]: 'Wallet top-up',
  [PAYMENT_PURPOSE.PLAN]: 'Credit pack / plan',
  [PAYMENT_PURPOSE.AUCTION]: 'Bidding / Buy-now (GMV)',
  VENDOR_LICENCE: 'Vendor licence purchase',
};
const FEATURE_LABEL = {
  IVS_CHECK: 'IMEI check',
  DIAGNOSE: 'Device diagnose',
  AUCTION_LISTING: 'Auction listing',
};
const WALLET_REASON_LABEL = {
  [TXN_REASON.TOPUP]: 'Top-up (tokens credited)',
  [TXN_REASON.REFERRAL_BONUS]: 'Referral bonus',
  [TXN_REASON.WELCOME_BONUS]: 'Welcome bonus',
  [TXN_REASON.SIGNUP_BONUS]: 'Signup bonus',
  [TXN_REASON.REFUND]: 'Refund (tokens)',
  [TXN_REASON.ADJUSTMENT]: 'Adjustment (tokens)',
};
const CREDIT_REASON_LABEL = {
  [ENTITLEMENT_REASON.PLAN_PURCHASE]: 'Credits granted (plan)',
  [ENTITLEMENT_REASON.ADMIN_ADJUSTMENT]: 'Adjustment (credits)',
  [ENTITLEMENT_REASON.REFUND]: 'Refund (credits)',
};

// `from`/`to` are 'YYYY-MM-DD' (or any Date-parseable) strings; `to` is made
// inclusive of its whole day. Returns {} when neither is given, so the summary
// covers all time.
// shortcut: groups on createdAt, not Razorpay paidAt — the one timestamp shared
// by all four collections; move Payment/VendorPayment to paidAt if finance needs
// capture-date recognition.
const dateMatch = (from, to) => {
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return Object.keys(range).length ? { createdAt: range } : {};
};

const sum = (rows) => rows.reduce((acc, r) => acc + r.amount, 0);

// Merge rows that share a key (e.g. ADMIN_ADJUSTMENT credits spread across several
// features collapse into one line), summing amount and count. Feature-scoped keys
// carry the feature in the key, so they stay separate.
const collapse = (rows) => {
  const byKey = new Map();
  for (const row of rows) {
    const existing = byKey.get(row.key);
    if (existing) {
      existing.amount += row.amount;
      existing.count += row.count;
    } else {
      byKey.set(row.key, { ...row });
    }
  }
  return [...byKey.values()];
};

/** Totals per payment purpose over [from, to]. */
const getPaymentsSummary = async ({ from = null, to = null } = {}) => {
  const match = dateMatch(from, to);

  const [paymentAgg, vendorAgg, walletAgg, creditAgg] = await Promise.all([
    // Real-money orders, only what was captured, grouped by purpose. Legacy
    // rows written before the field existed have no purpose → TOPUP, matching
    // the schema default (see Payment.model.js).
    Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.PAID, ...match } },
      {
        $group: {
          _id: { $ifNull: ['$purpose', PAYMENT_PURPOSE.TOPUP] },
          amount: { $sum: '$amountPaise' },
          count: { $sum: 1 },
        },
      },
    ]),
    // Vendor licence purchases, captured only.
    VendorPayment.aggregate([
      { $match: { status: PAYMENT_STATUS.PAID, ...match } },
      { $group: { _id: null, amount: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    ]),
    // Token movements, split so a FEATURE_CHARGE lands under its feature.
    WalletTransaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: { reason: '$reason', refType: '$referenceType' },
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]),
    // Credit movements, split so a FEATURE_USE lands under its feature.
    EntitlementTransaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: { reason: '$reason', feature: '$feature' },
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const cashRows = paymentAgg.map((r) => ({
    group: 'CASH',
    key: r._id || 'UNSPECIFIED',
    label: CASH_LABEL[r._id] || humanize(r._id) || 'Unspecified purpose',
    unit: 'INR',
    amount: r.amount,
    count: r.count,
  }));
  if (vendorAgg[0]) {
    cashRows.push({
      group: 'CASH',
      key: 'VENDOR_LICENCE',
      label: CASH_LABEL.VENDOR_LICENCE,
      unit: 'INR',
      amount: vendorAgg[0].amount,
      count: vendorAgg[0].count,
    });
  }

  const walletRows = walletAgg.map(({ _id, amount, count }) => {
    const isCharge = _id.reason === TXN_REASON.FEATURE_CHARGE;
    return {
      group: 'WALLET',
      key: isCharge ? `FEATURE_CHARGE:${_id.refType || 'OTHER'}` : _id.reason,
      label: isCharge
        ? `${FEATURE_LABEL[_id.refType] || humanize(_id.refType || 'feature')} (wallet)`
        : WALLET_REASON_LABEL[_id.reason] || humanize(_id.reason),
      unit: 'TOKENS',
      amount,
      count,
    };
  });

  const creditRows = creditAgg.map(({ _id, amount, count }) => {
    const isUse = _id.reason === ENTITLEMENT_REASON.FEATURE_USE;
    return {
      group: 'CREDIT',
      key: isUse ? `FEATURE_USE:${_id.feature}` : _id.reason,
      label: isUse
        ? `${FEATURE_LABEL[_id.feature] || humanize(_id.feature)} (credits)`
        : CREDIT_REASON_LABEL[_id.reason] || humanize(_id.reason),
      unit: 'CREDITS',
      amount,
      count,
    };
  });

  const byAmountDesc = (a, b) => b.amount - a.amount;

  return {
    range: { from, to },
    rows: [
      ...collapse(cashRows).sort(byAmountDesc),
      ...collapse(walletRows).sort(byAmountDesc),
      ...collapse(creditRows).sort(byAmountDesc),
    ],
    totals: {
      cashPaise: sum(cashRows),
      walletTokens: sum(walletRows),
      creditUnits: sum(creditRows),
    },
  };
};

// Friendly category + bucket for one normalised detail row — same vocabulary as
// the summary, so a row's category matches the bucket it was totalled under.
const categoryOf = (r) => {
  if (r.kind === 'PAYMENT') return CASH_LABEL[r.purpose] || humanize(r.purpose) || 'Unspecified purpose';
  if (r.kind === 'VENDOR_PAYMENT') return CASH_LABEL.VENDOR_LICENCE;
  if (r.kind === 'WALLET') {
    return r.reason === TXN_REASON.FEATURE_CHARGE
      ? `${FEATURE_LABEL[r.refType] || humanize(r.refType || 'feature')} (wallet)`
      : WALLET_REASON_LABEL[r.reason] || humanize(r.reason);
  }
  return r.reason === ENTITLEMENT_REASON.FEATURE_USE
    ? `${FEATURE_LABEL[r.feature] || humanize(r.feature)} (credits)`
    : CREDIT_REASON_LABEL[r.reason] || humanize(r.reason);
};
const groupOf = (r) =>
  r.kind === 'PAYMENT' || r.kind === 'VENDOR_PAYMENT' ? 'CASH' : r.kind === 'WALLET' ? 'WALLET' : 'CREDIT';

// How the money arrived. Razorpay captures carry a `pay_…` id; an offline/manual
// payment (IMPS, local cash) is recorded with the bank UTR instead, so the id
// shape is the tell. Feature spend has no gateway.
// shortcut: derives Razorpay-vs-bank from the id, not Razorpay's own `method`
// (UPI/card/netbanking) which we don't store yet — capture entity.method on the
// webhook to show the exact instrument.
const methodOf = (r) => {
  if (!r.razorpayPaymentId) return null;
  return /^pay_/.test(r.razorpayPaymentId) ? 'Razorpay' : 'Bank / IMPS';
};

const GROUP_KINDS = {
  CASH: ['PAYMENT', 'VENDOR_PAYMENT'],
  WALLET: ['WALLET'],
  CREDIT: ['ENTITLEMENT'],
};

const paginate = ({ page = 1, limit = 20 }) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { safePage, safeLimit, skip: (safePage - 1) * safeLimit };
};

/**
 * One time-ordered statement across all four payment sources, each normalised to
 * a common shape and enriched with the payer's full details. Razorpay / status
 * columns are null for internal feature spend, which carries no gateway order.
 *
 * shortcut: the merged feed sorts on createdAt with no single cross-collection
 * index, so this is admin-scale, not hot-path; add a covering strategy if the
 * ledgers grow past ~1e5 rows.
 */
const PROJECT = {
  _id: 0,
  date: '$createdAt',
  recordId: '$_id',
};

const listPaymentsDetailed = async ({ page, limit, group = null, status = null, method = null, from = null, to = null } = {}) => {
  const { safePage, safeLimit, skip } = paginate({ page, limit });
  const match = dateMatch(from, to);

  const normalised = [
    { $match: match },
    {
      $project: {
        ...PROJECT,
        kind: 'PAYMENT',
        purpose: { $ifNull: ['$purpose', PAYMENT_PURPOSE.TOPUP] },
        reason: null,
        refType: null,
        feature: null,
        txnType: null,
        unit: 'INR',
        amount: '$amountPaise',
        status: '$status',
        razorpayOrderId: '$razorpayOrderId',
        razorpayPaymentId: '$razorpayPaymentId',
        userId: '$userId',
        vendorId: null,
      },
    },
    {
      $unionWith: {
        coll: VendorPayment.collection.name,
        pipeline: [
          { $match: match },
          {
            $project: {
              ...PROJECT,
              kind: 'VENDOR_PAYMENT',
              purpose: 'VENDOR_LICENCE',
              reason: null,
              refType: null,
              feature: null,
              txnType: null,
              unit: 'INR',
              amount: '$amountPaise',
              status: '$status',
              razorpayOrderId: '$razorpayOrderId',
              razorpayPaymentId: '$razorpayPaymentId',
              userId: null,
              vendorId: '$vendorId',
            },
          },
        ],
      },
    },
    {
      $unionWith: {
        coll: WalletTransaction.collection.name,
        pipeline: [
          { $match: match },
          {
            $project: {
              ...PROJECT,
              kind: 'WALLET',
              purpose: null,
              reason: '$reason',
              refType: '$referenceType',
              feature: null,
              txnType: '$type',
              unit: 'TOKENS',
              amount: '$amount',
              status: null,
              razorpayOrderId: null,
              razorpayPaymentId: null,
              userId: '$userId',
              vendorId: null,
            },
          },
        ],
      },
    },
    {
      $unionWith: {
        coll: EntitlementTransaction.collection.name,
        pipeline: [
          { $match: match },
          {
            $project: {
              ...PROJECT,
              kind: 'ENTITLEMENT',
              purpose: null,
              reason: '$reason',
              refType: null,
              feature: '$feature',
              txnType: '$type',
              unit: 'CREDITS',
              amount: '$amount',
              status: null,
              razorpayOrderId: null,
              razorpayPaymentId: null,
              userId: '$userId',
              vendorId: null,
            },
          },
        ],
      },
    },
  ];

  // An unpaid (CREATED) order is an abandoned checkout, not a transaction the
  // accounts team reconciles — only PAID / FAILED / REFUNDED cash rows belong on
  // the statement. Feature spend (wallet/credit) carries null status, so $ne
  // keeps it.
  normalised.push({ $match: { status: { $ne: PAYMENT_STATUS.CREATED } } });

  if (group && GROUP_KINDS[group]) {
    normalised.push({ $match: { kind: { $in: GROUP_KINDS[group] } } });
  }
  // Status lives only on cash rows (payments have a lifecycle; feature spend does
  // not), so filtering by it naturally narrows to those.
  if (status) {
    normalised.push({ $match: { status } });
  }
  // Method is the id shape: Razorpay captures carry `pay_…`; a manually-entered
  // offline/IMPS payment carries a bank transaction id instead. Mirrors methodOf.
  if (method === 'RAZORPAY') {
    normalised.push({ $match: { razorpayPaymentId: { $regex: /^pay_/ } } });
  } else if (method === 'BANK_IMPS') {
    normalised.push({ $match: { razorpayPaymentId: { $ne: null, $not: /^pay_/ } } });
  }

  const [facet] = await Payment.aggregate([
    ...normalised,
    {
      $facet: {
        items: [
          { $sort: { date: -1 } },
          { $skip: skip },
          { $limit: safeLimit },
          { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', as: 'user' } },
          { $lookup: { from: Vendor.collection.name, localField: 'vendorId', foreignField: '_id', as: 'vendor' } },
          {
            $project: {
              date: 1,
              recordId: 1,
              kind: 1,
              purpose: 1,
              reason: 1,
              refType: 1,
              feature: 1,
              txnType: 1,
              unit: 1,
              amount: 1,
              status: 1,
              razorpayOrderId: 1,
              razorpayPaymentId: 1,
              user: {
                $let: {
                  vars: { u: { $first: '$user' } },
                  in: {
                    id: '$$u._id',
                    name: '$$u.name',
                    mobile: '$$u.mobile',
                    countryCode: '$$u.countryCode',
                    email: '$$u.email',
                    companyName: '$$u.companyName',
                    userType: '$$u.userType',
                    panNumber: '$$u.panNumber',
                    gstNumber: '$$u.gstNumber',
                  },
                },
              },
              vendor: {
                $let: {
                  vars: { v: { $first: '$vendor' } },
                  in: { id: '$$v._id', name: '$$v.name', email: '$$v.email' },
                },
              },
            },
          },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ]);

  const items = (facet?.items || []).map((r) => ({
    ...r,
    group: groupOf(r),
    category: categoryOf(r),
    method: methodOf(r),
  }));
  const total = facet?.total?.[0]?.n || 0;

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 0,
    },
  };
};

module.exports = { getPaymentsSummary, listPaymentsDetailed };
