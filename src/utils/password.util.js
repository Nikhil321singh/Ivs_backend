const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

/**
 * Password hashing for admin accounts.
 *
 * Uses Node's built-in scrypt rather than bcrypt/argon2 so the API keeps a
 * zero-native-dependency install — `npm ci --omit=dev` on the EC2 box needs no
 * compiler. scrypt is memory-hard and a sound choice for this.
 *
 * Stored format: scrypt$N$r$p$<salt-hex>$<hash-hex>, so the work factors travel
 * with the hash and can be raised later without invalidating existing rows.
 */
const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

const hashPassword = async (plain) => {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(plain, salt, KEYLEN, PARAMS);

  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
};

const verifyPassword = async (plain, stored) => {
  if (typeof stored !== 'string') return false;

  const [scheme, N, r, p, saltHex, hashHex] = stored.split('$');

  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  let derived;

  try {
    derived = await scrypt(plain, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }

  // Constant-time compare so a wrong password can't be narrowed down by timing.
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
};

module.exports = { hashPassword, verifyPassword };
