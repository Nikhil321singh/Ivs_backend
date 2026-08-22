const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { fromCognitoIdentityPool } = require('@aws-sdk/credential-providers');
const env = require('../../config/env');

/**
 * AWS S3 storage driver. Implements the storage contract consumed via
 * storageProvider.js:
 *   isConfigured(): boolean
 *   uploadImage(buffer, { folder, publicId, contentType }): Promise<{ url, publicId }>
 *   deleteImage(publicId): Promise<void>
 *
 * Auth mirrors the web client (src/lib/amplify.js) exactly: the Cognito Identity
 * Pool has guest access disabled, so the backend signs a shared "service account"
 * User Pool user in (USER_PASSWORD_AUTH) to get an ID token, which the Identity
 * Pool exchanges for temporary credentials carrying the authenticated IAM role
 * (s3:PutObject on ivs/*). No static access keys. Objects are public-read via the
 * bucket policy and served at https://<bucket>.s3.<region>.amazonaws.com/<key>.
 *
 * `publicId` is the S3 object key relative to `folder` — the returned publicId is
 * the full key, which deleteImage takes back verbatim. Buffers come from multer's
 * memory storage and stream straight up; nothing touches local disk.
 */

const cfg = env.s3;

const isConfigured = () =>
  !!cfg.bucket &&
  !!cfg.region &&
  !!cfg.identityPoolId &&
  !!cfg.userPoolId &&
  !!cfg.userPoolClientId &&
  !!cfg.svcUsername &&
  !!cfg.svcPassword;

const publicUrl = (key) => `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`;

// The Cognito ID token lives ~1h; cache the built S3 client and rebuild before
// it lapses. A single-flight promise stops concurrent uploads re-authenticating.
let cached = null; // { client, expiresAt }
let inflight = null;

const getIdToken = async () => {
  const idp = new CognitoIdentityProviderClient({ region: cfg.identityPoolRegion });
  const res = await idp.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: cfg.userPoolClientId,
      AuthParameters: { USERNAME: cfg.svcUsername, PASSWORD: cfg.svcPassword },
    })
  );
  const idToken = res.AuthenticationResult && res.AuthenticationResult.IdToken;
  if (!idToken) {
    throw new Error('Cognito sign-in returned no ID token for the S3 service account.');
  }
  return idToken;
};

const buildClient = async () => {
  const idToken = await getIdToken();
  const providerName = `cognito-idp.${cfg.identityPoolRegion}.amazonaws.com/${cfg.userPoolId}`;
  const credentials = fromCognitoIdentityPool({
    identityPoolId: cfg.identityPoolId,
    logins: { [providerName]: idToken },
    clientConfig: { region: cfg.identityPoolRegion },
  });
  const client = new S3Client({ region: cfg.region, credentials });
  // Rebuild well before the ~1h ID token expires so a refresh never uses a
  // stale login (the login map here is a fixed token, not self-refreshing).
  cached = { client, expiresAt: Date.now() + 50 * 60 * 1000 };
  return client;
};

const getClient = async () => {
  if (cached && cached.expiresAt > Date.now()) return cached.client;
  if (!inflight) {
    inflight = buildClient().finally(() => {
      inflight = null;
    });
  }
  return inflight;
};

const uploadImage = async (buffer, { folder = env.storage.imageFolder, publicId, contentType } = {}) => {
  const key = `${folder}/${publicId}`;
  const client = await getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    })
  );
  return { url: publicUrl(key), publicId: key };
};

const deleteImage = async (publicId) => {
  if (!publicId) return;
  const client = await getClient();
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: publicId }));
};

module.exports = { isConfigured, uploadImage, deleteImage };
