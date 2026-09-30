const express = require('express');
const assistantController = require('../controllers/assistant.controller');
const authenticate = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest.middleware');
const { assistantLimiter } = require('../middleware/rateLimiter.middleware');
const { chatValidator } = require('../validators/assistant.validator');

const router = express.Router();

/**
 * @openapi
 * /assistant/chat:
 *   post:
 *     tags: [Assistant]
 *     summary: Free-text reply from the in-app "Gia" assistant (Claude-backed)
 *     description: >
 *       Answers off-script, conversational questions about the Grest app only —
 *       anything unrelated is politely declined server-side. The Anthropic key
 *       lives on the server; the app never sees it. Rate-limited per user.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messages]
 *             properties:
 *               messages:
 *                 type: array
 *                 description: The recent conversation, oldest first. Must start with a user turn.
 *                 items:
 *                   type: object
 *                   required: [role, content]
 *                   properties:
 *                     role: { type: string, enum: [user, assistant] }
 *                     content: { type: string, example: "Is this phone stolen if the IMEI is blocked?" }
 *     responses:
 *       200: { description: Assistant replied }
 *       422: { description: Validation failed }
 *       429: { description: Too many messages, slow down }
 *       502: { description: The assistant provider failed }
 *       503: { description: The assistant is not configured }
 */
router.post('/chat', authenticate, assistantLimiter, chatValidator, validateRequest, assistantController.chat);

module.exports = router;
