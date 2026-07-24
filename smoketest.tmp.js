process.env.MONGODB_URI = 'placeholder';

const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.PORT = '5055';
  process.env.API_BASE_URL = 'http://localhost:5055';

  const connectDB = require('/Users/admin/ivs-backend/src/config/database');
  const app = require('/Users/admin/ivs-backend/src/app');

  await connectDB();
  const server = app.listen(5055, async () => {
    console.log('SERVER_UP');

    try {
      const axios = require('axios');
      const base = 'http://localhost:5055/api/v1';

      // health
      const health = await axios.get(`${base}/health`);
      console.log('HEALTH', health.status, health.data);

      // 422 validation on bad mobile
      try {
        await axios.post(`${base}/auth/send-otp`, { mobile: '123' });
      } catch (e) {
        console.log('SEND_OTP_BAD_MOBILE', e.response.status, e.response.data);
      }

      // send-otp will fail against real MSG91 with dummy creds -> expect 400 from our ApiError, not a crash
      try {
        await axios.post(`${base}/auth/send-otp`, { mobile: '9876543210' });
        console.log("Test",base)
      } catch (e) {
        console.log('SEND_OTP_LIVE_CALL', e.response.status, e.response.data);
      }

      // 401 on protected route without token
      try {
        await axios.get(`${base}/auth/profile`);
      } catch (e) {
        console.log('PROFILE_NO_TOKEN', e.response.status, e.response.data);
      }

      // 404 handler
      try {
        await axios.get(`${base}/does-not-exist`);
      } catch (e) {
        console.log('NOT_FOUND', e.response.status, e.response.data);
      }

      // Directly exercise the auth flow bypassing MSG91 (unit-level, using services directly)
      const userService = require('/Users/admin/ivs-backend/src/services/user.service');
      const tokenService = require('/Users/admin/ivs-backend/src/services/token.service');

      const { user, isNewUser } = await userService.findOrCreateUserByMobile('+91', '9876543210');
      console.log('FIND_OR_CREATE', isNewUser, user.toJSON());

      const tokens = await tokenService.issueTokenPair(user, 'device-1');
      console.log('TOKENS_ISSUED', Object.keys(tokens));

      // Use the real access token against /auth/profile
      const profileRes = await axios.get(`${base}/auth/profile`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      console.log('PROFILE_WITH_TOKEN', profileRes.status, profileRes.data);

      // Refresh token rotation
      const refreshed = await tokenService.rotateRefreshToken(tokens.refreshToken, 'device-1');
      console.log('REFRESH_ROTATED', Object.keys(refreshed));

      // Old refresh token should now be rejected (rotation invalidates it)
      try {
        await tokenService.rotateRefreshToken(tokens.refreshToken, 'device-1');
        console.log('OLD_REFRESH_SHOULD_HAVE_FAILED_BUT_DID_NOT');
      } catch (e) {
        console.log('OLD_REFRESH_REJECTED_AS_EXPECTED', e.statusCode, e.message);
      }

      // Logout revokes
      await tokenService.revokeRefreshToken(user._id, 'device-1');
      try {
        await tokenService.rotateRefreshToken(refreshed.refreshToken, 'device-1');
        console.log('POST_LOGOUT_REFRESH_SHOULD_HAVE_FAILED_BUT_DID_NOT');
      } catch (e) {
        console.log('POST_LOGOUT_REFRESH_REJECTED_AS_EXPECTED', e.statusCode, e.message);
      }

      console.log('SMOKETEST_COMPLETE');
    } catch (err) {
      console.error('SMOKETEST_ERROR', err);
    } finally {
      server.close();
      await mongod.stop();
      process.exit(0);
    }
  });
})();
