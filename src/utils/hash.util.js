const crypto = require('crypto');

/**
 * Refresh tokens are never stored in plaintext. We persist a SHA-256 hash so a
 * database leak alone cannot be used to impersonate a session.
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = { hashToken };
