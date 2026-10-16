const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const MESSAGES = require('../constants/messages');
const blanccoService = require('../services/blancco.service');

const createSession = asyncHandler(async (req, res) => {
  // requireFeatureAccess('DIAGNOSE') already 402'd anyone who can't pay and set
  // which system pays + the price it checked. Both pass through so a setting
  // changed mid-request can't alter the charge — same contract as /diagnose.
  const result = await blanccoService.createSession(req.user.id, req.body, {
    billingSource: req.billingSource,
    cost: req.featureCost,
  });

  successResponse(res, httpStatus.CREATED, MESSAGES.BLANCCO.SESSION_CREATED, result);
});

const scanQr = asyncHandler(async (req, res) => {
  const { redirectUrl } = await blanccoService.scanSession(req.params.sessionToken);

  res.redirect(302, redirectUrl);
});

const getSession = asyncHandler(async (req, res) => {
  const result = await blanccoService.getSessionById(req.user.id, req.params.id);

  successResponse(res, httpStatus.OK, MESSAGES.BLANCCO.SESSION_FETCHED, result);
});

const getReport = asyncHandler(async (req, res) => {
  console.log('[Blancco API] report request started', 'session', req.params.id);
  const result = await blanccoService.getReport(req.user.id, req.params.id);

  if (!result.diagnoseCompleted) {
    console.log('[Blancco API] report is pending', 'session', req.params.id);
    return successResponse(res, httpStatus.OK, MESSAGES.BLANCCO.DIAGNOSIS_PENDING, result);
  }

  console.log(
    '[Blancco API] report returned',
    'session', req.params.id,
    'report', result.report?.reportId || '(no report id)'
  );
  successResponse(res, httpStatus.OK, MESSAGES.BLANCCO.REPORT_FETCHED, result);
});

const getSessions = asyncHandler(async (req, res) => {
  const result = await blanccoService.getSessions(req.user.id, req.query);

  successResponse(res, httpStatus.OK, MESSAGES.BLANCCO.SESSIONS_FETCHED, result);
});

const getStats = asyncHandler(async (req, res) => {
  const result = await blanccoService.getStats(req.user.id);

  successResponse(res, httpStatus.OK, 'Diagnosis stats fetched.', result);
});

const exportSessions = asyncHandler(async (req, res) => {
  const items = await blanccoService.exportSessions(req.user.id);

  successResponse(res, httpStatus.OK, 'Diagnosis data exported.', { items, total: items.length });
});

module.exports = { createSession, scanQr, getSession, getReport, getSessions, getStats, exportSessions };
