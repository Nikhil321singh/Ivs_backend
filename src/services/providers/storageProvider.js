const s3Provider = require('./s3Provider');

/**
 * Storage driver resolver. The app stores all images/files in AWS S3; this
 * indirection stays so callers (upload.service.js) remain decoupled from the
 * concrete driver and a different backend could be swapped in later without
 * touching them.
 *
 * The driver implements:
 *   isConfigured(): boolean
 *   uploadImage(buffer, { folder, publicId }): Promise<{ url, publicId }>
 *   deleteImage(publicId): Promise<void>
 * (plus generic putObject/deleteObject/getPublicUrl helpers on s3Provider).
 */
const getStorageProvider = () => s3Provider;

module.exports = { getStorageProvider };
