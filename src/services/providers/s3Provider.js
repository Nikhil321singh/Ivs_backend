const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { fromCognitoIdentityPool } = require('@aws-sdk/credential-providers');
const env = require('../../config/env');

/**
 * AWS S3 storage driver. Serves images as public direct URLs
 *   https://<bucket>.s3.<region>.amazonaws.com/<key>
 *
 * Implements the storage contract consumed via storageProvider.js:
 *   isConfigured(): boolean
 *   uploadImage(buffer, { folder, publicId }): Promise<{ url, publicId }>
 *   deleteImage(publicId): Promise<void>
 *
 * and also exposes the lower-level generic helpers (putObject/deleteObject/
 * getPublicUrl) so future features that store other files (device photos,
 * certificates, signatures) can reuse the same client without going through
 * the image-specific contract.
 *
 * Credentials come from an AWS Cognito Identity Pool: fromCognitoIdentityPool
 * exchanges the pool id for temporary, auto-refreshing S3 credentials (the
 * pool's unauthenticated/guest role must grant s3:PutObject/DeleteObject on
 * the bucket). No long-lived access keys live in the backend. The client is
 * created lazily and the `isConfigured()` guard mirrors the other
 * integrations (Razorpay/C-DOT) so the server still boots before the pool is
 * provisioned. Uploads take an in-memory buffer (multer memory storage) —
 * nothing touches local disk. No object ACL is set: modern buckets have ACLs
 * disabled, so public read comes from the bucket policy.
 */

const isConfigured = () =>
  !!env.s3.region && !!env.s3.bucket && !!env.s3.identityPoolId;

let cachedClient;
const client = () => {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: env.s3.region,
      credentials: fromCognitoIdentityPool({
        identityPoolId: env.s3.identityPoolId,
        clientConfig: { region: env.s3.identityPoolRegion || env.s3.region },
      }),
    });
  }
  return cachedClient;
};

/** Virtual-hosted-style public URL for an object key. */
const getPublicUrl = (key) => `https://${env.s3.bucket}.s3.${env.s3.region}.amazonaws.com/${key}`;

/**
 * Sniff the Content-Type from a buffer's magic bytes so S3 stores/serves it
 * with the right type without the caller having to thread the mimetype
 * through. Covers the image types multer already allows (JPG/PNG/WEBP);
 * anything else falls back to a generic binary type.
 */
const sniffContentType = (buffer) => {
  if (!buffer || buffer.length < 12) return 'application/octet-stream';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return 'application/octet-stream';
};

/**
 * Generic object upload. Puts `buffer` at `key` and returns the public URL
 * plus the key. Content-Type is inferred from the buffer when not supplied.
 * Re-using the same key overwrites the object (stable URL, no orphans).
 */
const putObject = async (buffer, { key, contentType } = {}) => {
  await client().send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || sniffContentType(buffer),
    })
  );
  return { url: getPublicUrl(key), key };
};

/** Deletes an object by key. Safe to call with a falsy key (no-op). */
const deleteObject = async (key) => {
  if (!key) return;
  await client().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
};

// --- image storage contract (storageProvider.js / upload.service.js) ---

/**
 * Uploads an image buffer under `<folder>/<publicId>` and returns the hosted
 * URL plus the object key (persisted as publicId so the image can be
 * deleted/replaced). A deterministic per-user key means a re-upload overwrites
 * the old object instead of accumulating orphans.
 */
const uploadImage = async (buffer, { folder = env.storage.imageFolder, publicId } = {}) => {
  const key = `${folder}/${publicId}`;
  const { url } = await putObject(buffer, { key });
  return { url, publicId: key };
};

/** Deletes a previously uploaded image by its stored key (publicId). */
const deleteImage = (publicId) => deleteObject(publicId);

module.exports = {
  isConfigured,
  uploadImage,
  deleteImage,
  putObject,
  deleteObject,
  getPublicUrl,
};
