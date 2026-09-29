# Repair Analysis API Integration Guide

## Overview
The Repair Analysis API (b2bai.gadgetguruz.com) provides:
- **Decision trees** for device fault diagnosis
- **Chat support** for repair questions
- **Tools, parts, and safety guidance**

This guide shows how to integrate it into your backend and expose it to the frontend.

---

## 1. Backend Integration

### 1.1 Create a Repair API Client Service

**File:** `src/services/repairAnalysis.service.js`

```javascript
const axios = require('axios');
const ApiError = require('../utils/apiError');
const httpStatus = require('../constants/httpStatus');

const API_BASE_URL = 'https://b2bai.gadgetguruz.com';
const API_KEY = process.env.REPAIR_API_KEY; // Store in .env

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60s for analyze (can take 20-40s)
});

/**
 * Analyze a device fault and get a decision tree
 * @param {string} query - Device description and symptom (e.g., "Dell XPS 15 9560 not turning on")
 * @returns {Promise<Object>} Decision tree with nodes, actions, tools, safety notes
 */
const analyzeFault = async (query) => {
  try {
    const response = await client.post('/v1/analyze', { query });

    if (!response.data.success) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Repair analysis failed: ${response.data.error?.message || 'Unknown error'}`
      );
    }

    return response.data.data; // Contains device, decision_tree, summary
  } catch (err) {
    if (err.response?.status === 401) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Repair API key is invalid');
    }
    if (err.response?.status === 429) {
      throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Repair API rate limit exceeded');
    }
    if (err.response?.status === 413) {
      throw new ApiError(httpStatus.PAYLOAD_TOO_LARGE, 'Query is too long (max 1000 chars)');
    }
    throw err;
  }
};

/**
 * Answer a repair-related question using chat
 * @param {string} message - The question (max 2000 chars)
 * @param {string} context - Background info (device, symptom, step) - optional
 * @returns {Promise<Object>} Chat response with reply
 */
const chatRepair = async (message, context = null) => {
  try {
    const payload = { message };
    if (context) payload.context = context;

    const response = await client.post('/v1/chat', payload);

    if (!response.data.success) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Chat failed: ${response.data.error?.message || 'Unknown error'}`
      );
    }

    return response.data.data; // Contains reply
  } catch (err) {
    if (err.response?.status === 401) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Repair API key is invalid');
    }
    if (err.response?.status === 429) {
      throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Rate limit exceeded');
    }
    throw err;
  }
};

module.exports = {
  analyzeFault,
  chatRepair,
};
```

### 1.2 Create a Controller to Handle Requests

**File:** `src/controllers/repairAnalysis.controller.js`

```javascript
const asyncHandler = require('../helpers/asyncHandler');
const { successResponse } = require('../helpers/apiResponse');
const httpStatus = require('../constants/httpStatus');
const repairAnalysisService = require('../services/repairAnalysis.service');

/**
 * POST /repair-analysis/analyze
 * Analyze a device fault and get diagnostic decision tree
 */
const analyzeFault = asyncHandler(async (req, res) => {
  const { query } = req.body;

  const result = await repairAnalysisService.analyzeFault(query);

  successResponse(res, httpStatus.OK, 'Device fault analysis completed', result);
});

/**
 * POST /repair-analysis/chat
 * Ask a follow-up repair question
 */
const chatRepair = asyncHandler(async (req, res) => {
  const { message, context } = req.body;

  const result = await repairAnalysisService.chatRepair(message, context);

  successResponse(res, httpStatus.OK, 'Chat response received', result);
});

module.exports = {
  analyzeFault,
  chatRepair,
};
```

### 1.3 Create Validators

**File:** `src/validators/repairAnalysis.validator.js`

```javascript
const { body } = require('express-validator');

const analyzeFaultValidator = [
  body('query')
    .trim()
    .notEmpty()
    .withMessage('Device description (query) is required.')
    .isLength({ min: 5, max: 1000 })
    .withMessage('Query must be between 5 and 1000 characters.'),
];

const chatRepairValidator = [
  body('message')
    .trim()
    .notEmpty()
    .withMessage('Message is required.')
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters.'),
  body('context')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 4000 })
    .withMessage('Context must be max 4000 characters.'),
];

module.exports = {
  analyzeFaultValidator,
  chatRepairValidator,
};
```

### 1.4 Create Routes

**File:** `src/routes/repairAnalysis.routes.js`

```javascript
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
 *       Provide a device description and symptom to get a step-by-step diagnostic tree.
 *       Example: "Dell XPS 15 9560 not turning on, no power"
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
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     device:
 *                       type: object
 *                       properties:
 *                         manufacturer: { type: string }
 *                         model: { type: string }
 *                         device_id: { type: string }
 *                         checked_date: { type: string }
 *                     decision_tree:
 *                       type: object
 *                       properties:
 *                         root_id: { type: string }
 *                         nodes: { type: array }
 *                     summary:
 *                       type: object
 *                       properties:
 *                         top_findings: { type: array }
 *                         confidence_overall: { type: number }
 *       422: { description: Query too short/long or analysis failed }
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
 *       include relevant context (device, symptom, step) in the message or context field.
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
 *               context: { type: string, maxLength: 4000, example: "Device: Dell XPS 15 9560. Symptom: no power." }
 *     responses:
 *       200:
 *         description: Chat response received
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reply: { type: string }
 *       422: { description: Message too long or chat failed }
 */
router.post(
  '/chat',
  authenticate,
  chatRepairValidator,
  validateRequest,
  repairAnalysisController.chatRepair
);

module.exports = router;
```

### 1.5 Add Route to Main Routes File

**File:** `src/routes/index.js`

```javascript
const repairAnalysisRoutes = require('./repairAnalysis.routes');

// Add to router
router.use('/repair-analysis', repairAnalysisRoutes);
```

### 1.6 Update .env

```
REPAIR_API_KEY=your_api_key_here
```

---

## 2. Frontend Usage

### 2.1 Analyze a Device Fault

```javascript
async function analyzeDevice() {
  try {
    const response = await fetch('/api/v1/repair-analysis/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        query: 'Dell XPS 15 9560 not turning on, no power',
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      const { device, decision_tree, summary } = result.data;
      
      console.log('Device:', device); // { manufacturer, model, device_id }
      console.log('Decision Tree:', decision_tree); // { root_id, nodes[] }
      console.log('Summary:', summary); // { top_findings[], confidence_overall }
      
      // Render decision tree
      displayDecisionTree(decision_tree);
    }
  } catch (error) {
    console.error('Analysis failed:', error);
  }
}
```

### 2.2 Ask a Follow-up Question

```javascript
async function askRepairQuestion() {
  try {
    const response = await fetch('/api/v1/repair-analysis/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        message: 'What voltage should I see at the DC-in jack?',
        context: 'Device: Dell XPS 15 9560. Symptom: no power. Step: Test DC-in jack.',
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('Reply:', result.data.reply);
      displayChatResponse(result.data.reply);
    }
  } catch (error) {
    console.error('Chat failed:', error);
  }
}
```

### 2.3 Render Decision Tree

```javascript
function displayDecisionTree(tree) {
  const rootNode = tree.nodes.find(n => n.id === tree.root_id);
  
  function renderNode(node) {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'decision-node';
    nodeEl.innerHTML = `
      <h3>${node.title}</h3>
      ${node.type === 'decision' ? `<p>${node.condition}</p>` : ''}
      ${node.actions ? `
        <div class="actions">
          ${node.actions.map(action => `
            <div class="action">
              <h4>${action.title}</h4>
              <ul>
                ${action.steps.map(step => `<li>${step}</li>`).join('')}
              </ul>
              <p><strong>Tools:</strong> ${action.tools_required?.join(', ')}</p>
              <p><strong>Time:</strong> ${action.time_estimate_minutes} mins</p>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${node.next_node_ids?.length ? `
        <div class="next-steps">
          ${node.next_node_ids.map(nextId => {
            const nextNode = tree.nodes.find(n => n.id === nextId);
            return renderNode(nextNode);
          }).join('')}
        </div>
      ` : '<p class="end-of-path">End of diagnostic path</p>'}
    `;
    return nodeEl;
  }
  
  document.getElementById('diagnosis').appendChild(renderNode(rootNode));
}
```

---

## 3. Flow Summary

```
Frontend Request
    ↓
POST /api/v1/repair-analysis/analyze
    ↓
Backend Controller (validateRequest)
    ↓
repairAnalysisService.analyzeFault()
    ↓
Call external API: POST https://b2bai.gadgetguruz.com/v1/analyze
    ↓
Parse response (device, decision_tree, summary)
    ↓
Return to Frontend
    ↓
Frontend renders decision tree with nodes, actions, tools, safety notes
```

---

## 4. Key Points

| Aspect | Details |
|--------|---------|
| **Authentication** | X-API-Key header (backend only) |
| **Rate Limiting** | Implement on backend to prevent quota overages |
| **Timeout** | /analyze takes 20-40s, use long timeout |
| **Caching** | Cache results by query to speed up repeated requests |
| **Error Handling** | 422 = analysis failed, 429 = rate limited, 401 = invalid key |
| **Context** | Include device/symptom/step in chat context for better answers |

---

## 5. Optional: Add Caching

```javascript
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 86400 }); // 24h cache

const analyzeFault = async (query) => {
  const cacheKey = `analyze:${query}`;
  
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  
  // Call API
  const result = await client.post('/v1/analyze', { query });
  
  // Cache result
  cache.set(cacheKey, result.data.data);
  
  return result.data.data;
};
```

---

## Testing

```bash
# Test analyze endpoint
curl -X POST http://localhost:5000/api/v1/repair-analysis/analyze \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"query":"Dell XPS 15 9560 not turning on"}'

# Test chat endpoint
curl -X POST http://localhost:5000/api/v1/repair-analysis/chat \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"message":"What voltage should I see?","context":"Device: Dell XPS 15 9560"}'
```
