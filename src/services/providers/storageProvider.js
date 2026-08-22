const env = require('../../config/env');
const s3Provider = require('./s3Provider');

/**
 * Storage driver registry / resolver. Decouples the rest of the app from any
 * specific storage backend: callers go through upload.service.js, which asks
 * here for the active driver selected by env.storage.driver (STORAGE_DRIVER).
 *
 * Every driver implements the same contract:
 *   isConfigured(): boolean
 *   uploadImage(buffer, { folder, publicId, contentType }): Promise<{ url, publicId }>
 *   deleteImage(publicId): Promise<void>
 *
 * AWS S3 is the only backend today (Cognito-vended temp credentials — see
 * s3Provider.js). Register another driver here and select it via STORAGE_DRIVER
 * to swap; no other file changes required.
 */

const DRIVERS = {
  s3: s3Provider,
};

const getStorageProvider = () => {
  const provider = DRIVERS[env.storage.driver];
  if (!provider) {
    throw new Error(
      `Unknown STORAGE_DRIVER "${env.storage.driver}". Available: ${Object.keys(DRIVERS).join(', ')}`
    );
  }
  return provider;
};

module.exports = { getStorageProvider };
