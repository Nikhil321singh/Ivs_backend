const { getStorageProvider } = require('./providers/storageProvider');

/**
 * Storage-agnostic profile-image operations. Delegates to whichever backend
 * is configured (Cloudinary today, S3 tomorrow) via storageProvider.js, so
 * nothing here — or upstream — depends on the concrete provider.
 */

/**
 * Uploads a profile-image buffer for a user and returns the hosted URL plus
 * the storage public_id (persisted so the image can be deleted/replaced).
 * A deterministic per-user publicId means a re-upload overwrites the old
 * asset instead of accumulating orphans.
 */
const uploadProfileImage = async (buffer, userId) => {
  const storage = getStorageProvider();
  return storage.uploadImage(buffer, { publicId: String(userId) });
};

/**
 * Deletes a previously uploaded profile image by its stored public_id.
 * No-op for a falsy id.
 */
const deleteProfileImage = async (publicId) => {
  const storage = getStorageProvider();
  await storage.deleteImage(publicId);
};

module.exports = { uploadProfileImage, deleteProfileImage };
