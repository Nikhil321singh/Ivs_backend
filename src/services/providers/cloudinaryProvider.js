const { v2: cloudinary } = require('cloudinary');
const env = require('../../config/env');

/**
 * Cloudinary storage driver. Implements the storage contract consumed via
 * storageProvider.js:
 *   isConfigured(): boolean
 *   uploadImage(buffer, { folder, publicId }): Promise<{ url, publicId }>
 *   deleteImage(publicId): Promise<void>
 *
 * Configured once at module load from env; lazy `isConfigured()` guard
 * mirrors the other providers so the server still boots before credentials
 * are provisioned. Uploads accept an in-memory buffer (multer memory
 * storage) and stream straight to Cloudinary — nothing touches local disk.
 */

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
  secure: true,
});

const isConfigured = () =>
  !!env.cloudinary.cloudName && !!env.cloudinary.apiKey && !!env.cloudinary.apiSecret;

/**
 * Uploads an image buffer and returns the hosted URL plus the public_id
 * (needed later to delete/replace it). Applies auto format + quality so
 * delivery is optimized without a separate transformation step.
 */
const uploadImage = (buffer, { folder = env.storage.imageFolder, publicId } = {}) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        overwrite: true,
        // Re-uploads reuse the same public_id (stable URL), so purge the CDN
        // cache too — otherwise the old picture keeps being served.
        invalidate: true,
        fetch_format: 'auto',
        quality: 'auto',
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });

/**
 * Deletes a previously uploaded image by public_id. Safe to call with a
 * falsy id (no-op) — nothing to clean up.
 */
const deleteImage = async (publicId) => {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
};

module.exports = { isConfigured, uploadImage, deleteImage };
