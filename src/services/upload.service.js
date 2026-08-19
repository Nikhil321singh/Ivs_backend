const { getStorageProvider } = require('./providers/storageProvider');

/**
 * Storage-agnostic profile-image operations. Delegates to whichever backend
 * is configured (AWS S3) via storageProvider.js, so
 * nothing here — or upstream — depends on the concrete provider.
 */

/**
 * Uploads a profile-image buffer for a user and returns the hosted URL plus
 * the storage public_id (persisted so the image can be deleted/replaced).
 * A deterministic per-user publicId means a re-upload overwrites the old
 * asset instead of accumulating orphans.
 */
const uploadProfileImage = async (buffer, userId, contentType) => {
  const storage = getStorageProvider();
  return storage.uploadImage(buffer, { publicId: String(userId), contentType });
};

/**
 * Uploads a vendor's business-proof image (GSTIN / Udyam Aadhaar). Uses a
 * distinct per-user publicId suffix so it lives alongside — not on top of —
 * the profile image, while still overwriting an earlier proof on re-upload.
 */
const uploadBusinessProofImage = async (buffer, userId, contentType) => {
  const storage = getStorageProvider();
  return storage.uploadImage(buffer, { publicId: `${userId}-business-proof`, contentType });
};

/**
 * Deletes a previously uploaded image (profile or business proof) by its stored
 * public_id. No-op for a falsy id.
 */
const deleteProfileImage = async (publicId) => {
  const storage = getStorageProvider();
  await storage.deleteImage(publicId);
};

module.exports = { uploadProfileImage, uploadBusinessProofImage, deleteProfileImage };
