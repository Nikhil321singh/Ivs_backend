const express = require('express');
const mediaController = require('../controllers/media.controller');
const authenticate = require('../middleware/auth.middleware');
const { uploadMediaFiles, requireMediaFiles } = require('../middleware/upload.middleware');

const router = express.Router();

/**
 * @openapi
 * /media/upload:
 *   post:
 *     tags: [Media]
 *     summary: Upload one or more images to S3
 *     description: Stores images under ivs/<category>/<userId>/ and returns their public URLs + keys. Multipart field `files` (repeatable, max 10). Optional `category` (device-photos | signature | misc).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items: { type: string, format: binary }
 *               category: { type: string, example: device-photos }
 *     responses:
 *       201: { description: "Files uploaded; data.files is an array of url/key objects" }
 *       400: { description: Invalid category or file type }
 *       422: { description: No files provided }
 */
router.post('/upload', authenticate, uploadMediaFiles, requireMediaFiles, mediaController.uploadMedia);

module.exports = router;
