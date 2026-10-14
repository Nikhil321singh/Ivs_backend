const express = require('express');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const repairAnalysisController = require('../controllers/repairAnalysis.controller');
const {
  analyzeFaultValidator,
  chatRepairValidator,
} = require('../validators/repairAnalysis.validator');

const router = express.Router();

/**
 * @openapi
 * /repair-analysis/analyze:
 *   post:
 *     tags: [Repair Analysis]
 *     summary: Analyze a device fault and get diagnostic decision tree
 *     description: >
 *       Provide a device description and symptom to get a step-by-step diagnostic tree
 *       with actions, tools, safety notes, and parts information.
 *       Example query: "Dell XPS 15 9560 not turning on, no power"
 *       Response time: 20-40 seconds (faster for repeated queries)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [query]
 *             properties:
 *               query: { type: string, maxLength: 1000, example: "Dell XPS 15 9560 not turning on" }
 *     responses:
 *       200:
 *         description: Analysis completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     device:
 *                       type: object
 *                       properties:
 *                         manufacturer: { type: string, example: "Dell" }
 *                         model: { type: string, example: "XPS 15 9560" }
 *                         device_id: { type: string }
 *                         checked_date: { type: string }
 *                     decision_tree:
 *                       type: object
 *                       properties:
 *                         root_id: { type: string }
 *                         nodes:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string }
 *                               type: { type: string, enum: [decision, action, info, safety, escalate] }
 *                               title: { type: string }
 *                               condition: { type: string }
 *                               actions: { type: array }
 *                               next_node_ids: { type: array, items: { type: string } }
 *                     summary:
 *                       type: object
 *                       properties:
 *                         top_findings: { type: array, items: { type: string } }
 *                         confidence_overall: { type: number }
 *       401: { description: Unauthorized - invalid or missing token }
 *       422: { description: Validation failed or analysis could not complete }
 *       503: { description: Repair API unavailable or not configured }
 *       504: { description: Request timeout }
 */
router.post(
  '/analyze',
  authenticate,
  analyzeFaultValidator,
  validateRequest,
  repairAnalysisController.analyzeFault
);

/**
 * @openapi
 * /repair-analysis/chat:
 *   post:
 *     tags: [Repair Analysis]
 *     summary: Ask a repair question or get clarification
 *     description: >
 *       Ask follow-up questions about a repair. Each request is independent —
 *       include relevant context (device, symptom, current step) in the message or context field
 *       for better answers.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 2000, example: "What voltage should I see at the DC-in jack?" }
 *               context: { type: string, maxLength: 4000, example: "Device: Dell XPS 15 9560. Symptom: no power. Step: Test DC-in jack." }
 *     responses:
 *       200:
 *         description: Chat response received
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reply: { type: string, example: "The Dell XPS 15 9560 adapter supplies 19.5V DC at the jack." }
 *       401: { description: Unauthorized - invalid or missing token }
 *       422: { description: Validation failed or chat could not complete }
 *       429: { description: Rate limit exceeded }
 *       503: { description: Repair API unavailable or not configured }
 */
router.post(
  '/chat',
  authenticate,
  chatRepairValidator,
  validateRequest,
  repairAnalysisController.chatRepair
);

module.exports = router;
