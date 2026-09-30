const nock = require('nock');
const fixture = require('./fixtures/blancco-report.json');
const blancco = require('../src/services/providers/blanccoProvider');
const env = require('../src/config/env');
const { createAdmin, request, app } = require('./helpers/factory');
const Auction = require('../src/models/Auction.model');
const { AUCTION_STATUS } = require('../src/constants/auctionEnums');

const BASE = 'https://api.eu-west-1.blancco.cloud';
const IMEI = '356370162838962';

const asAdmin = (token) => ({
  post: (path) => request(app).post(path).set('Authorization', `Bearer ${token}`),
});

// The fixture is the real vendor payload, trimmed and with identifiers
// replaced. Its structure — arrays of single-key objects carrying @type tags —
// is exactly what Blancco returns, because that shape is the whole reason the
// flattener exists.
const stubBlancco = (body = fixture, status = 200) =>
  nock(BASE).post('/v1/reports/export').reply(status, body);

const stubEmpty = () => nock(BASE).post('/v1/reports/export').times(2).reply(200, { reports: [] });

describe('parsing a Blancco report', () => {
  const report = blancco.normalise(fixture.reports[0]);

  it('flattens the vendor arrays into usable device fields', () => {
    expect(report.device.marketName).toBe('iPhone 13 Pro Max');
    expect(report.device.manufacturer).toBe('Apple, Inc.');
    expect(report.device.imei).toBe(IMEI);
    expect(report.device.ram).toBe('6GB');
  });

  it('reads the locks that decide whether a device is resaleable', () => {
    expect(report.locks.findMyIphone).toBe('UNLOCKED');
    expect(report.locks.mdmStatus).toBe('UNLOCKED');
    expect(report.locks.componentsAuthentic).toBe(true);
  });

  it('extracts battery health', () => {
    expect(report.battery.healthPercent).toBe(82);
    expect(report.battery.cycles).toBe(779);
  });

  it('excludes testing_duration from the test tally', () => {
    // It lives in hardware_tests but holds "00:07:59", not a result. Counting
    // it would inflate the total and read as a failed test.
    expect(report.tests.some((t) => t.key === 'testing_duration')).toBe(false);
    expect(report.total).toBe(report.passed + report.failed + report.skipped);
  });

  it('classifies vendor vocabulary into PASS, SKIPPED and FAIL', () => {
    const one = (v) =>
      blancco.normalise({
        blancco_data: {
          blancco_hardware_report: { hardware_tests: [{ '@type': 'string', wi_fi: v }] },
        },
      }).tests[0].result;

    expect(one('successful')).toBe('PASS');
    expect(one('not available')).toBe('SKIPPED');
    expect(one('failed')).toBe('FAIL');
    // An outcome nobody anticipated must read as a problem, not a clean bill
    // of health, on a device somebody is about to buy.
    expect(one('something new')).toBe('FAIL');
  });

  it('survives a report with sections missing', () => {
    const sparse = blancco.normalise({ blancco_data: {} });

    expect(sparse.tests).toEqual([]);
    expect(sparse.battery.healthPercent).toBeNull();
    expect(sparse.device.imei).toBeNull();
  });
});

describe('grading', () => {
  const grade = (failed, healthPercent, locks = {}) =>
    blancco.gradeFor({
      failed,
      battery: { healthPercent },
      locks: { findMyIphone: 'UNLOCKED', mdmStatus: 'UNLOCKED', ...locks },
    });

  it('grades a clean device by battery health', () => {
    expect(grade(0, 90)).toBe('A');
    expect(grade(0, 82)).toBe('B');
    expect(grade(0, 65)).toBe('C');
  });

  it('drops the grade as failures mount', () => {
    expect(grade(2, 90)).toBe('C');
    expect(grade(5, 95)).toBe('D');
  });

  it('marks a locked device LOCKED regardless of how well it tests', () => {
    // A flawless handset nobody can actually use is not an A.
    expect(grade(0, 100, { findMyIphone: 'LOCKED' })).toBe('LOCKED');
    expect(grade(0, 100, { mdmStatus: 'LOCKED' })).toBe('LOCKED');
  });
});

describe('fetching a report', () => {
  afterEach(() => nock.cleanAll());

  it('returns SUCCESS with a normalised report', async () => {
    stubBlancco();

    const out = await blancco.diagnose({ imei: IMEI });

    expect(out.resultStatus).toBe('SUCCESS');
    expect(out.providerRefId).toBe('test-report-0001');
    expect(out.result.grade).toBe('B');
    // The untouched payload is kept so a parsing gap can be reconstructed.
    expect(out.rawResponse).toBeTruthy();
  });

  it('sends the IMEI filter Blancco expects', async () => {
    let sent = null;
    nock(BASE)
      .post('/v1/reports/export', (body) => {
        sent = body;
        return true;
      })
      .reply(200, fixture);

    await blancco.diagnose({ imei: IMEI });

    expect(sent.filter.fields[0]).toEqual({ name: '@imei', like: IMEI });
    expect(sent.format).toBe('JSON');
  });

  it('reports UNKNOWN when the device has no report, so nobody is charged', async () => {
    stubEmpty();

    const out = await blancco.diagnose({ imei: '999999999999999' });

    // Nothing is broken — the handset has simply never been through the
    // diagnostics app. That is not an error state.
    expect(out.resultStatus).toBe('UNKNOWN');
    expect(out.result).toBeNull();
  });

  it('reports ERROR without throwing when Blancco fails', async () => {
    nock(BASE).post('/v1/reports/export').reply(500, { message: 'boom' });

    const out = await blancco.diagnose({ imei: IMEI });

    expect(out.resultStatus).toBe('ERROR');
  });

  it('reports UNKNOWN when not configured, without calling out', async () => {
    // The key is blanked on the resolved config rather than by reloading the
    // module: jest.resetModules() swaps the registry mid-file, leaving this
    // spec holding one mongoose instance while later specs get another.
    const saved = env.blancco.apiKey;
    env.blancco.apiKey = undefined;

    try {
      const out = await blancco.diagnose({ imei: IMEI });
      expect(out.resultStatus).toBe('UNKNOWN');
      // No nock stub is registered here, so any outbound call fails the spec.
    } finally {
      env.blancco.apiKey = saved;
    }
  });
});

describe('admin device lookup', () => {
  afterEach(() => nock.cleanAll());

  it('returns the report plus form prefill', async () => {
    stubBlancco();
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .post('/api/v1/admin/auctions/lookup-imei')
      .send({ imei: IMEI });

    expect(res.status).toBe(200);
    expect(res.body.data.prefill.device.brand).toBe('Apple');
    expect(res.body.data.prefill.device.model).toBe('iPhone 13 Pro Max');
    expect(res.body.data.report.grade).toBe('B');
    expect(res.body.data.sellable).toBe(true);
  });

  it('404s when the handset has never been diagnosed', async () => {
    stubEmpty();
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .post('/api/v1/admin/auctions/lookup-imei')
      .send({ imei: '999999999999999' });

    expect(res.status).toBe(404);
  });

  it('rejects a malformed IMEI before calling the vendor', async () => {
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .post('/api/v1/admin/auctions/lookup-imei')
      .send({ imei: '123' });

    expect(res.status).toBe(422);
    // No stub was registered, so a call would have failed the suite.
  });

  it('attaches the report automatically when a listing is created with an IMEI', async () => {
    stubBlancco();
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .post('/api/v1/admin/auctions')
      .send({
        device: { brand: 'Apple', model: 'iPhone 13 Pro Max', imei: IMEI },
        condition: 'EXCELLENT',
        photos: [{ url: 'https://example.test/a.jpg', publicId: 'auctions/a.jpg' }],
        startPricePaise: 1500000,
        bidIncrementPaise: 50000,
        startAt: new Date(Date.now() - 1000).toISOString(),
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      });

    expect(res.status).toBe(201);
    const auction = await Auction.findById(res.body.data.auction.id);
    expect(auction.diagnosisReport.grade).toBe('B');
    expect(auction.diagnosisReport.battery.healthPercent).toBe(82);
    expect(auction.diagnosisReport.locks.findMyIphone).toBe('UNLOCKED');
  });

  it('still creates the listing when Blancco has nothing', async () => {
    stubEmpty();
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .post('/api/v1/admin/auctions')
      .send({
        device: { brand: 'Samsung', model: 'S21', imei: '999999999999999' },
        condition: 'GOOD',
        photos: [{ url: 'https://example.test/b.jpg', publicId: 'auctions/b.jpg' }],
        startPricePaise: 900000,
        bidIncrementPaise: 25000,
        startAt: new Date(Date.now() - 1000).toISOString(),
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      });

    // A device Blancco has never seen is still a device Grest can sell.
    expect(res.status).toBe(201);
    const auction = await Auction.findById(res.body.data.auction.id);
    expect(auction.diagnosisReport).toBeNull();
  });
});

describe('locked devices cannot be listed', () => {
  afterEach(() => nock.cleanAll());

  it('refuses to publish a handset still tied to an iCloud account', async () => {
    const { token } = await createAdmin();
    stubBlancco();
    const created = await asAdmin(token)
      .post('/api/v1/admin/auctions')
      .send({
        // The IMEI is what makes the report attach on create; without one
        // there is no report to lock.
        device: { brand: 'Apple', model: 'iPhone 13', imei: IMEI },
        condition: 'EXCELLENT',
        photos: [{ url: 'https://example.test/a.jpg', publicId: 'auctions/a.jpg' }],
        startPricePaise: 1500000,
        bidIncrementPaise: 50000,
        startAt: new Date(Date.now() - 1000).toISOString(),
        endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      });

    await Auction.updateOne(
      { _id: created.body.data.auction.id },
      { 'diagnosisReport.locks.findMyIphone': 'LOCKED' }
    );

    const res = await asAdmin(token).post(
      `/api/v1/admin/auctions/${created.body.data.auction.id}/publish`
    );

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('diagnosisReport');
    // Still a draft — a locked device never reaches a buyer.
    const auction = await Auction.findById(created.body.data.auction.id);
    expect(auction.status).toBe(AUCTION_STATUS.DRAFT);
  });
});
