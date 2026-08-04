const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const nock = require('nock');

/**
 * In-memory Mongo lifecycle for the whole test run:
 *   - beforeAll: boot a throwaway mongod and connect mongoose to it.
 *   - afterEach: wipe every collection so tests never see each other's data.
 *   - afterAll: disconnect and shut the server down.
 *
 * Also disables real outbound HTTP (nock.disableNetConnect) so a test can
 * never accidentally hit the real Razorpay API — only explicitly nock'd
 * hosts are reachable.
 */
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  // Block real outbound HTTP so no test hits the real Razorpay API, but allow
  // loopback so supertest can reach the app it binds on an ephemeral port.
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  nock.cleanAll();
});

afterAll(async () => {
  nock.enableNetConnect();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});
