const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

/**
 * Builds the publicly accessible URL for an uploaded profile image, served
 * statically by express from the /uploads directory.
 */
const buildProfileImageUrl = (filename) => `${env.apiBaseUrl}/uploads/profile/${filename}`;

/**
 * Deletes a previously uploaded profile image from disk when it is replaced.
 * Silently ignores a missing file — nothing to clean up.
 */
const deleteProfileImageByUrl = async (imageUrl) => {
  if (!imageUrl) return;

  const filename = path.basename(imageUrl);
  const filePath = path.join(__dirname, '../uploads/profile', filename);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

module.exports = { buildProfileImageUrl, deleteProfileImageByUrl };
