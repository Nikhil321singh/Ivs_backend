/**
 * In-memory MongoDB lifecycle (jest `setupFilesAfterEach`).
 *
 * One server for the whole file, wiped between tests, so specs never see each
 * other's users or ledger rows. Nothing touches a real database — MONGODB_URI
 * is overwritten here before mongoose connects.
 *
 * Also asserts that no test made a real outbound HTTP call: nock is put in
 * charge of the network, so a forgotten stub fails loudly instead of silently
 * hitting MSG91 or a government API from CI.
 */
const mongoose = require('mongoose');
const nock = require('nock');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();

  await mongoose.connect(process.env.MONGODB_URI);

  // Block every real outbound request; each spec declares the stubs it needs.
  nock.disableNetConnect();
  // ...except the in-memory Mongo and supertest's own ephemeral listener.
  nock.enableNetConnect((host) => host.startsWith('127.0.0.1') || host.startsWith('localhost'));
});

afterEach(async () => {
  const { collections } = mongoose.connection;

  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({}))
  );

  // A leftover interceptor would otherwise leak into the next test and make
  // failures depend on file order.
  nock.cleanAll();

  // Settings are cached in-process for 15s; without this a toggle set in one
  // test would still be live in the next even though its row is gone.
  // eslint-disable-next-line global-require
  require('../../src/services/settings.service').invalidateCache();
});

afterAll(async () => {
  nock.enableNetConnect();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
