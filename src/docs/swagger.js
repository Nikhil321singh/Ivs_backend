const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');
const env = require('../config/env');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'IVS Mobile Application API',
      version: '1.0.0',
      description:
        'REST API for the IVS Mobile Application. Handles Mobile Number + OTP authentication (via MSG91), JWT + Refresh Token session management, and KYC.',
    },
    servers: [
      {
        url: `${env.apiBaseUrl}/api/v1`,
        description: `${env.nodeEnv} server`,
      },
    ],
    tags: [
      { name: 'Health', description: 'API health check' },
      { name: 'Auth', description: 'Mobile + OTP login/signup and session management' },
      { name: 'KYC', description: 'Aadhaar e-KYC authentication and KYC submission' },
      { name: 'User', description: 'Profile management' },
      { name: 'IVS', description: 'Device IMEI blocklist verification (C-DOT CEIR)' },
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
