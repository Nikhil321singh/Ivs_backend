const axios = require('axios');
const env = require('../../config/env');

/* eslint-disable no-console */

/**
 * Blancco Mobile Diagnostics — the device diagnosis vendor.
 *
 * IMPORTANT: this is a REPORT LOOKUP, not a "run a diagnosis" call. Blancco's
 * app runs the tests on the handset itself and uploads the report to Blancco's
 * cloud; we fetch what is already there, by IMEI. So a device that has never
 * been through the Blancco app has no report, and no amount of retrying will
 * produce one — that is a NOT FOUND, not an outage.
 *
 * Follows the same contract as cdotIvsProvider: it NEVER throws for an expected
 * failure (unconfigured, timeout, service down, no report). It returns an
 * ERROR/UNKNOWN status so the caller can log the attempt and NOT charge the
 * customer. Only a SUCCESS is billable.
 *
 * API:  POST {base}/reports/export
 *       header X-BLANCCO-API-KEY
 *       body   { category, filter: { date, fields:[{name:'@imei', like}] },
 *                cursor, format, container }
 */

const RESULT_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  UNKNOWN: 'UNKNOWN',
});

const REQUEST_TIMEOUT = 20000;

// Blancco filters by date and has no "any" option, so we pass a floor far
// enough back to include every report that could exist for a device.
const EARLIEST_REPORT = '2015-01-01T00:00:00Z';

const isConfigured = () => !!env.blancco.baseUrl && !!env.blancco.apiKey;

/**
 * Blancco returns every section as an array of single-key objects, each also
 * carrying an `@type` tag:
 *
 *   [ { "@type": "string", "imei": "3563…" }, { "@type": "uint", "ram": 6 } ]
 *
 * which is unusable for lookups. This collapses a section into a plain object
 * and drops the type tags.
 */
const flatten = (section) =>
  Object.assign(
    {},
    ...(Array.isArray(section) ? section : []).map((entry) => {
      const copy = { ...entry };
      delete copy['@type'];
      return copy;
    })
  );

/**
 * `hardware_tests` is a bag of test → outcome, EXCEPT for one entry that is not
 * a test at all: `testing_duration` holds a clock value like "00:07:59".
 * Counting it as a result would inflate every tally by one and label a duration
 * as a failed test.
 */
const NON_TEST_KEYS = new Set(['testing_duration']);

// Blancco's vocabulary. Anything unrecognised is treated as a failure rather
// than silently passing — an unknown outcome on a device someone is about to
// buy should read as a problem, not a clean bill of health.
const PASS_VALUES = new Set(['successful', 'passed', 'pass', 'ok']);
const SKIPPED_VALUES = new Set(['not available', 'not performed', 'skipped', 'n/a']);

const humanise = (key) =>
  key
    .replace(/_/g, ' ')
    .replace(/\bthreed\b/i, '3D')
    .replace(/\bwi fi\b/i, 'Wi-Fi')
    .replace(/\bagps\b/i, 'A-GPS')
    .replace(/\bsim\b/i, 'SIM')
    .replace(/^\w/, (c) => c.toUpperCase());

const classify = (value) => {
  const v = String(value || '').toLowerCase().trim();
  if (PASS_VALUES.has(v)) return 'PASS';
  if (SKIPPED_VALUES.has(v)) return 'SKIPPED';
  return 'FAIL';
};

/**
 * Grading thresholds. Deliberately data, not scattered literals, because this
 * is a commercial judgement that will be tuned once real stock goes through.
 */
const GRADE_RULES = Object.freeze({
  A: { maxFailures: 0, minBatteryHealth: 85 },
  B: { maxFailures: 0, minBatteryHealth: 75 },
  C: { maxFailures: 2, minBatteryHealth: 60 },
});

/**
 * A single letter for the listing card.
 *
 * LOCKED is not a grade on the same scale as A–D — it is a hard stop. A handset
 * still tied to an iCloud account or an MDM enrolment cannot be used by whoever
 * buys it, so it must never be presented as merely "lower grade".
 */
const gradeFor = ({ failed, battery, locks }) => {
  if (locks.findMyIphone === 'LOCKED' || locks.mdmStatus === 'LOCKED') return 'LOCKED';

  const health = battery.healthPercent;

  if (failed <= GRADE_RULES.A.maxFailures && health >= GRADE_RULES.A.minBatteryHealth) return 'A';
  if (failed <= GRADE_RULES.B.maxFailures && health >= GRADE_RULES.B.minBatteryHealth) return 'B';
  if (failed <= GRADE_RULES.C.maxFailures && health >= GRADE_RULES.C.minBatteryHealth) return 'C';
  return 'D';
};

const normaliseLock = (value) => {
  const v = String(value || '').toLowerCase();
  if (!v) return null;
  if (v.includes('unlock') || v === 'off' || v === 'disabled') return 'UNLOCKED';
  if (v.includes('lock') || v === 'on' || v === 'enabled') return 'LOCKED';
  return String(value).toUpperCase();
};

/**
 * Turns one Blancco report into the shape the rest of this system speaks:
 * device identity, the locks that decide resaleability, battery health, and a
 * flat list of tests with a pass/fail tally.
 *
 * Every field is optional on the way in. Blancco's payload varies by handset
 * and by app version, so a missing section must degrade to null rather than
 * throw — losing the battery block should not lose the whole report.
 */
const normalise = (report) => {
  const data = report?.blancco_data || {};
  const hardware = data.blancco_hardware_report || {};

  const system = flatten(hardware.system);
  const battery = flatten(hardware.mobile_battery);
  const rawTests = flatten(hardware.hardware_tests);
  const components = flatten(hardware.device_components);

  const tests = Object.entries(rawTests)
    .filter(([key]) => !NON_TEST_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      name: humanise(key),
      raw: String(value),
      result: classify(value),
    }));

  const passed = tests.filter((t) => t.result === 'PASS').length;
  const failed = tests.filter((t) => t.result === 'FAIL').length;
  const skipped = tests.filter((t) => t.result === 'SKIPPED').length;

  const locks = {
    findMyIphone: normaliseLock(system.find_my_iphone),
    mdmStatus: normaliseLock(system.mdm_status),
    // "false" means at least one part has been swapped for a non-original —
    // material to a buyer, and the reason this is surfaced rather than buried.
    componentsAuthentic:
      components.all_authenticated === undefined
        ? null
        : String(components.all_authenticated) === 'true',
  };

  const batteryOut = {
    healthPercent: Number(battery.battery_health_metric ?? battery.battery_capacity_health_level) || null,
    cycles: Number(battery.battery_cycles) || null,
    designCapacityMah: Number(battery.battery_capacity_design) || null,
    currentCapacityMah: Number(battery.battery_capacity_current) || null,
    chargeLevelPercent: Number(battery.battery_charge_level) || null,
  };

  const log = data.description?.document_log?.[0] || {};

  return {
    reportId: data.description?.document_id || null,
    diagnosedAt: log.date || null,
    source: log.author?.product_name?.value || 'Blancco',
    sourceVersion: log.author?.product_version || null,

    device: {
      manufacturer: system.manufacturer || null,
      marketName: system.market_name || null,
      model: system.model || system.name || null,
      color: system.device_color || null,
      ram: system.ram || null,
      serial: system.serial || null,
      imei: system.imei || null,
      imei2: system.imei_two || null,
      firmwareVersion: system.firmware_version || null,
      modelNumber: system.a_model_number || null,
    },

    locks,
    battery: batteryOut,

    tests,
    passed,
    failed,
    skipped,
    total: tests.length,

    grade: gradeFor({ failed, battery: batteryOut, locks }),
  };
};

/**
 * Fetches the most recent Blancco report for an IMEI.
 *
 * `category` is a parameter because Blancco partitions reports by what produced
 * them: a device that was diagnosed but not wiped lives under "Diagnostics",
 * one that was wiped lives under "Erasure". Callers that want "whatever exists"
 * try both.
 */
const fetchReports = async (imei, category = 'Erasure') => {
  const response = await axios.post(
    `${env.blancco.baseUrl}/reports/export`,
    {
      category,
      filter: {
        date: { gt: EARLIEST_REPORT },
        fields: [{ name: '@imei', like: String(imei) }],
      },
      cursor: '',
      format: 'JSON',
      container: 'NONE',
    },
    {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'X-BLANCCO-API-KEY': env.blancco.apiKey,
      },
    }
  );

  return response.data?.reports || [];
};

/**
 * The provider contract the diagnose service consumes.
 *
 * Returns SUCCESS only when a report actually came back. "No report for this
 * IMEI" is UNKNOWN, not ERROR: nothing is broken, the device has simply never
 * been through the Blancco app — and either way the customer is not charged.
 */
const diagnose = async ({ imei } = {}) => {
  if (!isConfigured()) {
    console.warn('[Blancco] not configured — set BLANCCO_API_KEY');
    return { resultStatus: RESULT_STATUS.UNKNOWN, providerRefId: null, result: null, rawResponse: null };
  }

  if (!imei) {
    return { resultStatus: RESULT_STATUS.UNKNOWN, providerRefId: null, result: null, rawResponse: null };
  }

  try {
    // Erasure first: a wiped device is the common case for resale stock, and a
    // device that was both diagnosed and wiped has the fuller report there.
    let reports = await fetchReports(imei, 'Erasure');
    if (reports.length === 0) reports = await fetchReports(imei, 'Diagnostics');

    if (reports.length === 0) {
      return {
        resultStatus: RESULT_STATUS.UNKNOWN,
        providerRefId: null,
        result: null,
        rawResponse: null,
      };
    }

    // Newest first, so a device diagnosed more than once reports its current
    // condition rather than whatever it was in months ago.
    const sorted = [...reports].sort((a, b) => {
      const da = a?.blancco_data?.description?.document_log?.[0]?.date || '';
      const db = b?.blancco_data?.description?.document_log?.[0]?.date || '';
      return db.localeCompare(da);
    });

    const result = normalise(sorted[0]);

    return {
      resultStatus: RESULT_STATUS.SUCCESS,
      providerRefId: result.reportId,
      result,
      // The untouched payload is kept so a parsing gap can be reconstructed
      // later without re-querying a vendor that may have rotated the report.
      rawResponse: sorted[0],
    };
  } catch (err) {
    console.error('[Blancco] report lookup failed', imei, err.response?.status, err.message);
    return {
      resultStatus: RESULT_STATUS.ERROR,
      providerRefId: null,
      result: null,
      rawResponse: err.response?.data || null,
    };
  }
};

module.exports = {
  diagnose,
  isConfigured,
  RESULT_STATUS,
  // Exported for the specs, which assert on the parsing rather than the network.
  normalise,
  flatten,
  gradeFor,
};
