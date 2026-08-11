/**
 * Jest config for the API test suite.
 *
 * - setupFiles runs BEFORE any test module is imported, so it seeds the
 *   process.env that src/config/env.js validates at import time (that module
 *   calls process.exit(1) on missing vars — see test/setup/env.js).
 * - setupFilesAfterEnv runs after Jest's globals exist, wiring the in-memory
 *   Mongo lifecycle (connect once, wipe between tests).
 * - Tests run serially (maxWorkers: 1): they share one in-memory Mongo and
 *   assert on global ledger state, so parallel files would cross-contaminate.
 */
module.exports = {
  testEnvironment: 'node',
  // grest-partners-backend is a separate project nested in this repo; without
  // this jest sees two package.json files named ivs-backend and warns on every run.
  modulePathIgnorePatterns: ['<rootDir>/grest-partners-backend/'],
  setupFiles: ['<rootDir>/test/setup/env.js'],
  setupFilesAfterEnv: ['<rootDir>/test/setup/db.js'],
  testMatch: ['<rootDir>/test/**/*.test.js'],
  maxWorkers: 1,
  testTimeout: 30000,
  clearMocks: true,
};
