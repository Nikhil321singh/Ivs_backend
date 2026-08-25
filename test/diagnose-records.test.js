const { app, request, createUser, createFundedUser, asUser, balanceOf } = require('./helpers/factory');
const DiagnoseRecord = require('../src/models/DiagnoseRecord.model');

const RECORDS = '/api/v1/diagnose/records';

const validPayload = (overrides = {}) => ({
  customerName: 'Aniket Agrawal',
  customerPhone: '9003748031',
  customerEmail: 'aniketagr501@gmail.com',
  aadhaarNumber: '234567890123',
  report: { battery: 'degraded', screen: 'ok', verdict: 'Battery replacement advised' },
  price: 499,
  ...overrides,
});

describe('diagnosis records', () => {
  it('stores a record and returns it', async () => {
    const { token } = await createUser();

    const res = await asUser(token).post(RECORDS).send(validPayload());

    expect(res.status).toBe(201);
    expect(res.body.data.customerName).toBe('Aniket Agrawal');
    expect(res.body.data.price).toBe(499);
    expect(res.body.data.report.verdict).toBe('Battery replacement advised');
    expect(res.body.data.diagnosedAt).toBeTruthy();
  });

  it('never persists the full Aadhaar number', async () => {
    const { user, token } = await createUser();

    const res = await asUser(token).post(RECORDS).send(validPayload());

    expect(res.body.data.aadhaarNumber).toBe('XXXXXXXX0123');

    // The full number must be absent from the stored document, not merely
    // hidden from the response.
    const stored = await DiagnoseRecord.findOne({ userId: user._id }).lean();
    expect(stored.customerAadhaarNumber).toBe('XXXXXXXX0123');
    expect(JSON.stringify(stored)).not.toContain('234567890123');
  });

  it('costs no tokens', async () => {
    const { user, token } = await createFundedUser(100);

    await asUser(token).post(RECORDS).send(validPayload());

    expect(await balanceOf(user._id)).toBe(100);
  });

  it('accepts a free-text report and a zero price', async () => {
    const { token } = await createUser();

    const res = await asUser(token)
      .post(RECORDS)
      .send(validPayload({ report: 'Water damage, beyond economical repair.', price: 0 }));

    expect(res.status).toBe(201);
    expect(res.body.data.price).toBe(0);
  });

  it('stores a backdated diagnosis at the time given', async () => {
    const { token } = await createUser();
    const when = '2026-08-20T10:30:00.000Z';

    const res = await asUser(token).post(RECORDS).send(validPayload({ diagnosedAt: when }));

    expect(new Date(res.body.data.diagnosedAt).toISOString()).toBe(when);
  });

  it('works without the optional email and Aadhaar', async () => {
    const { token } = await createUser();
    const { customerEmail, aadhaarNumber, ...rest } = validPayload();

    const res = await asUser(token).post(RECORDS).send(rest);

    expect(res.status).toBe(201);
    expect(res.body.data.customerEmail).toBeNull();
    expect(res.body.data.aadhaarNumber).toBeNull();
  });

  it('rejects a missing report, a bad phone and a negative price', async () => {
    const { token } = await createUser();

    const missingReport = await asUser(token)
      .post(RECORDS)
      .send(validPayload({ report: '   ' }));
    expect(missingReport.status).toBe(422);

    const badPhone = await asUser(token)
      .post(RECORDS)
      .send(validPayload({ customerPhone: '12345' }));
    expect(badPhone.status).toBe(422);

    const negativePrice = await asUser(token)
      .post(RECORDS)
      .send(validPayload({ price: -1 }));
    expect(negativePrice.status).toBe(422);
  });

  it('rejects a malformed Aadhaar rather than storing it', async () => {
    const { token } = await createUser();

    const res = await asUser(token).post(RECORDS).send(validPayload({ aadhaarNumber: '123' }));

    expect(res.status).toBe(422);
    expect(await DiagnoseRecord.countDocuments()).toBe(0);
  });

  it('requires auth', async () => {
    expect((await request(app).post(RECORDS).send(validPayload())).status).toBe(401);
    expect((await request(app).get(RECORDS)).status).toBe(401);
  });
});

describe('diagnosis record listing', () => {
  it('lists newest diagnosis first and pages', async () => {
    const { token } = await createUser();

    await asUser(token)
      .post(RECORDS)
      .send(validPayload({ customerName: 'Older', diagnosedAt: '2026-08-01T00:00:00.000Z' }));
    await asUser(token)
      .post(RECORDS)
      .send(validPayload({ customerName: 'Newer', diagnosedAt: '2026-08-20T00:00:00.000Z' }));

    const res = await asUser(token).get(`${RECORDS}?page=1&limit=1`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].customerName).toBe('Newer');
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.totalPages).toBe(2);
  });

  it('searches by customer name and by price', async () => {
    const { token } = await createUser();
    await asUser(token).post(RECORDS).send(validPayload({ customerName: 'Ravi Kumar', price: 250 }));
    await asUser(token).post(RECORDS).send(validPayload({ customerName: 'Sita Devi', price: 999 }));

    const byName = await asUser(token).get(`${RECORDS}?search=ravi`);
    expect(byName.body.data.items).toHaveLength(1);
    expect(byName.body.data.items[0].customerName).toBe('Ravi Kumar');

    const byPrice = await asUser(token).get(`${RECORDS}?search=999`);
    expect(byPrice.body.data.items).toHaveLength(1);
    expect(byPrice.body.data.items[0].customerName).toBe('Sita Devi');
  });

  it("never returns another vendor's records", async () => {
    const { token: mine } = await createUser();
    const { token: theirs } = await createUser();

    const created = await asUser(theirs).post(RECORDS).send(validPayload());
    const theirId = created.body.data.id;

    const list = await asUser(mine).get(RECORDS);
    expect(list.body.data.items).toHaveLength(0);

    const detail = await asUser(mine).get(`${RECORDS}/${theirId}`);
    expect(detail.status).toBe(404);
  });

  it('fetches one record by id, and 404s on an unknown or malformed id', async () => {
    const { token } = await createUser();
    const created = await asUser(token).post(RECORDS).send(validPayload());

    const found = await asUser(token).get(`${RECORDS}/${created.body.data.id}`);
    expect(found.status).toBe(200);
    expect(found.body.data.report.battery).toBe('degraded');

    expect((await asUser(token).get(`${RECORDS}/64b7d3f9a1b2c3d4e5f60718`)).status).toBe(404);
    expect((await asUser(token).get(`${RECORDS}/not-an-id`)).status).toBe(404);
  });
});
