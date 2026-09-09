const { app, request } = require('./helpers/factory');
const PRICING = require('../src/constants/pricing');

describe('public endpoints', () => {
  it('serves the liveness probe', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('serves the API health check', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('serves pricing with effective feature costs', async () => {
    const res = await request(app).get('/api/v1/pricing');
    expect(res.status).toBe(200);
    expect(res.body.data.features.IVS_CHECK).toBe(PRICING.FEATURES.IVS_CHECK);
    expect(res.body.data.signupBonus).toBe(PRICING.SIGNUP_BONUS);
  });

  it('serves the public feature flags unauthenticated', async () => {
    const res = await request(app).get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      aadhaarVerificationEnabled: true,
      kycRequired: true,
      ivsCheckCost: PRICING.FEATURES.IVS_CHECK,
      diagnoseCost: PRICING.FEATURES.DIAGNOSE,
      // Credit packs. The client needs billingMode to know whether to offer
      // plans or a wallet top-up, and the custom rules to render the fourth
      // plan card without a round trip.
      billingMode: 'SUBSCRIPTION',
      ivsListPricePaise: PRICING.FEATURES.IVS_CHECK * 100,
      diagnoseListPricePaise: PRICING.FEATURES.DIAGNOSE * 100,
      customMinIvsCheck: 100,
      customMinDiagnose: 50,
      customDiscountPercent: 5,
    });
  });

  it('serves the legal pages app stores require', async () => {
    for (const path of ['/privacy', '/account-deletion']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.text.startsWith('<!doctype html>')).toBe(true);
    }
  });

  it('404s an unknown route with the standard error shape', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
