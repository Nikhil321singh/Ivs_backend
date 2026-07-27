const env = require('../../config/env');
const cloudinaryProvider = require('./cloudinaryProvider');

/**
 * Storage driver registry / resolver. Decouples the rest of the app from any
 * specific storage backend: callers go through upload.service.js, which asks
 * here for the active driver selected by env.storage.driver (STORAGE_DRIVER).
 *
 * Every driver implements the same contract:
 *   isConfigured(): boolean
 *   uploadImage(buffer, { folder, publicId }): Promise<{ url, publicId }>
 *   deleteImage(publicId): Promise<void>
 *
 * To add AWS S3 later: create s3Provider.js implementing this contract
 * (put/delete against the bucket, publicId = the object key, url = the
 * object URL), register it below, and set STORAGE_DRIVER=s3. No other file
 * changes required.
 */

const DRIVERS = {
  cloudinary: cloudinaryProvider,
  // s3: require('./s3Provider'),
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
