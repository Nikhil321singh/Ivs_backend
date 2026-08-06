const crypto = require('crypto');
const s3Provider = require('./providers/s3Provider');

/**
 * Generic media storage (device photos, signatures, and other non-profile
 * uploads). Puts each file in S3 under a per-user, per-category key prefix and
 * returns the public URLs + keys. Unlike the profile image, these keys are
 * randomised (not deterministic) so multiple files can coexist.
 *
 * NOTE: this only stores the objects and hands back the URLs — persisting the
 * association (which verification / trade-in a photo belongs to) is the
 * caller's responsibility once those domains exist.
 */

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const buildKey = (userId, category, mimetype) => {
  const ext = EXT_BY_MIME[mimetype] || 'bin';
  const rand = crypto.randomBytes(8).toString('hex');
  return `ivs/${category}/${userId}/${Date.now()}-${rand}.${ext}`;
};

/**
 * Uploads an array of multer files (memory storage) and returns
 * [{ url, key }] in the same order.
 */
const uploadMany = async (files, { userId, category }) => {
  return Promise.all(
    files.map((file) =>
      s3Provider.putObject(file.buffer, {
        key: buildKey(userId, category, file.mimetype),
        contentType: file.mimetype,
      })
    )
  );
};

/** Deletes a stored object by key. */
const remove = (key) => s3Provider.deleteObject(key);

module.exports = { uploadMany, remove };
