const {
  clientIpUnresolved,
  identityKey,
  otpKeyGenerator,
} = require('../src/middleware/rateLimiter.middleware');

/**
 * The limiters themselves are skipped under NODE_ENV=test (a shared 127.0.0.1
 * counter would make results depend on how many specs ran first), so these
 * assert the two pieces of logic that decide how a request is counted.
 */

const req = ({ ip = '203.0.113.9', headers = {}, body = {} } = {}) => ({ ip, headers, body });

describe('clientIpUnresolved — detects a proxy that is not forwarding the client IP', () => {
  it('is true for loopback with no X-Forwarded-For', () => {
    // Exactly what production logs: "::ffff:127.0.0.1" on every request.
    expect(clientIpUnresolved(req({ ip: '::ffff:127.0.0.1' }))).toBe(true);
    expect(clientIpUnresolved(req({ ip: '127.0.0.1' }))).toBe(true);
    expect(clientIpUnresolved(req({ ip: '::1' }))).toBe(true);
  });

  it('is false once the proxy forwards the header', () => {
    expect(
      clientIpUnresolved(
        req({ ip: '::ffff:127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } })
      )
    ).toBe(false);
  });

  it('is false for a real client IP', () => {
    expect(clientIpUnresolved(req({ ip: '203.0.113.9' }))).toBe(false);
  });
});

describe('otpKeyGenerator — counts per mobile number, not per IP', () => {
  it('gives two users on the same IP separate buckets', () => {
    const ip = '::ffff:127.0.0.1';
    const a = otpKeyGenerator(req({ ip, body: { countryCode: '+91', mobile: '9876543210' } }));
    const b = otpKeyGenerator(req({ ip, body: { countryCode: '+91', mobile: '9876543211' } }));

    expect(a).not.toBe(b);
  });

  it('gives the same user one bucket across different IPs', () => {
    const body = { countryCode: '+91', mobile: '9876543210' };
    const a = otpKeyGenerator(req({ ip: '203.0.113.9', body }));
    const b = otpKeyGenerator(req({ ip: '198.51.100.4', body }));

    expect(a).toBe(b);
  });

  it('normalises formatting so one number cannot claim several buckets', () => {
    const plain = otpKeyGenerator(req({ body: { countryCode: '+91', mobile: '9876543210' } }));
    const spaced = otpKeyGenerator(req({ body: { countryCode: '91', mobile: '98765 43210' } }));
    const dashed = otpKeyGenerator(req({ body: { countryCode: '+91', mobile: '987-654-3210' } }));

    expect(spaced).toBe(plain);
    expect(dashed).toBe(plain);
  });

  it('separates the same digits under different country codes', () => {
    const india = otpKeyGenerator(req({ body: { countryCode: '+91', mobile: '9876543210' } }));
    const other = otpKeyGenerator(req({ body: { countryCode: '+1', mobile: '9876543210' } }));

    expect(india).not.toBe(other);
  });

  it('falls back to the IP when no number was supplied', () => {
    const key = otpKeyGenerator(req({ ip: '203.0.113.9', body: {} }));

    expect(key).toBe('ip:203.0.113.9');
  });

  it('never returns the same key for a number and a missing number', () => {
    const withNumber = otpKeyGenerator(req({ body: { mobile: '9876543210' } }));
    const without = otpKeyGenerator(req({ body: {} }));

    expect(withNumber).not.toBe(without);
  });
});

describe('identityKey — counts per account, not per network', () => {
  it('prefers the authenticated user over everything else', () => {
    const key = identityKey(
      req({ ip: '203.0.113.9', body: { mobile: '9876543210' }, headers: { authorization: 'Bearer abc' } })
    );
    // req.user wins even when a number and a token are also present.
    expect(identityKey({ ...req(), user: { id: 'u1' }, body: { mobile: '9876543210' } })).toBe('user:u1');
    expect(key).toBe('otp:9876543210');
  });

  it('gives two users on one IP separate buckets', () => {
    const a = identityKey({ ...req({ ip: '::ffff:127.0.0.1' }), user: { id: 'u1' } });
    const b = identityKey({ ...req({ ip: '::ffff:127.0.0.1' }), user: { id: 'u2' } });

    expect(a).not.toBe(b);
  });

  it('keeps one user in one bucket across IPs', () => {
    const a = identityKey({ ...req({ ip: '203.0.113.9' }), user: { id: 'u1' } });
    const b = identityKey({ ...req({ ip: '198.51.100.4' }), user: { id: 'u1' } });

    expect(a).toBe(b);
  });

  it('keys admin login on the email being attempted', () => {
    const a = identityKey(req({ body: { email: 'Admin@Grest.in' } }));
    const b = identityKey(req({ body: { email: 'admin@grest.in' } }));

    expect(a).toBe('email:admin@grest.in');
    expect(b).toBe(a); // case-insensitive, so casing cannot buy extra attempts
  });

  it('falls back to the bearer token before auth middleware runs', () => {
    const key = identityKey(req({ headers: { authorization: 'Bearer secret-token-value' } }));

    expect(key).toMatch(/^tok:[0-9a-f]{32}$/);
    // The raw credential must never appear in the key.
    expect(key).not.toContain('secret-token-value');
  });

  it('gives two tokens separate buckets', () => {
    const a = identityKey(req({ headers: { authorization: 'Bearer token-a' } }));
    const b = identityKey(req({ headers: { authorization: 'Bearer token-b' } }));

    expect(a).not.toBe(b);
  });

  it('returns null for a fully anonymous request', () => {
    expect(identityKey(req({ body: {}, headers: {} }))).toBeNull();
  });
});
