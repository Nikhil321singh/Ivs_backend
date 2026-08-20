const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');
const env = require('../config/env');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'IVS Mobile Application API',
      version: '1.0.0',
      description: [
        'REST API for the IVS Mobile Application. Handles Mobile Number + OTP authentication (via MSG91), JWT + Refresh Token session management, and KYC.',
        '',
        '## CORS',
        'Browser requests must originate from an allowed origin, and credentials (cookies/Authorization headers) are permitted (`Access-Control-Allow-Credentials: true`).',
        '',
        'Allowed origins:',
        "- The host actually serving the request (same-origin) — so Swagger UI \"Try it out\" works from this docs page on any deployment",
        '- The configured client URL (`CLIENT_URL`)',
        '- `http://localhost:5713` (Vite dev frontend)',
        '- `http://localhost:3000`',
        '- `http://localhost` / `https://localhost` (Capacitor WebView)',
        '- `capacitor://localhost` (Capacitor WebView)',
        '',
        'Requests without an `Origin` header (curl, server-to-server) are allowed through.',
      ].join('\n'),
    },
    // A relative server URL ('/api/v1') makes Swagger UI's "Try it out" target
    // whatever host is actually serving the docs — localhost in dev, the Render
    // URL in production — with no API_BASE_URL to keep in sync. The configured
    // absolute URL is offered as a second option in the dropdown for
    // convenience (e.g. hitting the deployed API from a local docs page).
    servers: [
      {
        url: '/api/v1',
        description: 'Current host',
      },
      {
        url: `${env.apiBaseUrl}/api/v1`,
        description: `Configured ${env.nodeEnv} server`,
      },
    ],
    tags: [
      { name: 'Health', description: 'API health check' },
      { name: 'Auth', description: 'Mobile + OTP login/signup and session management' },
      { name: 'KYC', description: 'Aadhaar e-KYC authentication and KYC submission' },
      { name: 'User', description: 'Profile management' },
      { name: 'IVS', description: 'Device IMEI blocklist verification (C-DOT CEIR)' },
      { name: 'Wallet', description: 'Token wallet: balance, ledger, and Razorpay top-ups' },
      { name: 'Referral', description: 'Referral code and earnings' },
      { name: 'Diagnose', description: 'Third-party device diagnosis (token-billed)' },
      { name: 'Pricing', description: 'Per-feature token costs and referral rewards' },
      { name: 'Notifications', description: 'Push notifications via Firebase Cloud Messaging (FCM)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: { type: 'object' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            errors: { type: 'array', items: { type: 'object' } },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            mobile: { type: 'string' },
            countryCode: { type: 'string' },
            name: { type: 'string' },
            companyName: { type: 'string' },
            email: { type: 'string' },
            panNumber: { type: 'string' },
            isGstRegistered: { type: 'boolean' },
            gstNumber: { type: 'string' },
            aadhaarNumber: { type: 'string', description: 'Masked, e.g. XXXXXXXX1234' },
            aadhaarVerified: { type: 'boolean' },
            profileImage: { type: 'string' },
            isMobileVerified: { type: 'boolean' },
            kycCompleted: { type: 'boolean' },
            status: { type: 'string', enum: ['ACTIVE', 'BLOCKED'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [path.join(__dirname, '../routes/*.js')],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
