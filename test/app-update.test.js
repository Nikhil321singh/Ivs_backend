const { createUser, createAdmin, asUser, request, app } = require('./helpers/factory');
const AppVersion = require('../src/models/AppVersion.model');
const Notification = require('../src/models/Notification.model');
const appVersionService = require('../src/services/appVersion.service');
const { compareVersions } = require('../src/utils/version.util');
const { UPDATE_ACTION, NOTIFICATION_TYPE } = require('../src/constants/notification');

const asAdmin = (token) => ({
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${token}`),
  put: (path) => request(app).put(path).set('Authorization', `Bearer ${token}`),
  post: (path) => request(app).post(path).set('Authorization', `Bearer ${token}`),
});

const publish = (attrs = {}) =>
  AppVersion.create({ platform: 'android', latestVersion: '1.4.2', ...attrs });

const check = (query) => request(app).get(`/api/v1/app/version?${query}`);

describe('version comparison', () => {
  it.each([
    ['1.4.1', '1.4.2', -1],
    ['1.4.2', '1.4.2', 0],
    ['1.5.0', '1.4.2', 1],
    ['1.4', '1.4.0', 0],
    ['v1.4.2', '1.4.2', 0],
    ['1.10.0', '1.9.0', 1],
    ['2.0.0', '1.99.99', 1],
  ])('%s vs %s is %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it('treats an unparseable version as equal, so nobody is force-updated over a typo', () => {
    expect(compareVersions('not-a-version', '1.4.2')).toBe(0);
  });

  it('does not rank a pre-release below its release', () => {
    expect(compareVersions('1.4.2-beta.3', '1.4.2')).toBe(0);
  });
});

describe('GET /app/version', () => {
  it('needs no authentication — an app too old to log in still has to be told', async () => {
    await publish();

    const res = await check('platform=android&version=1.4.2');

    expect(res.status).toBe(200);
    expect(res.body.data.updateAction).toBe(UPDATE_ACTION.NONE);
  });

  it('offers an optional update to a build behind the latest', async () => {
    await publish({ minSupportedVersion: '1.3.0', releaseNotes: 'Faster IMEI checks.' });

    const res = await check('platform=android&version=1.4.0');

    expect(res.body.data.updateAvailable).toBe(true);
    expect(res.body.data.updateAction).toBe(UPDATE_ACTION.OPTIONAL);
    expect(res.body.data.forceUpdate).toBe(false);
    expect(res.body.data.releaseNotes).toBe('Faster IMEI checks.');
  });

  it('forces a build below the minimum supported version', async () => {
    await publish({ minSupportedVersion: '1.4.0' });

    const res = await check('platform=android&version=1.2.0');

    expect(res.body.data.updateAction).toBe(UPDATE_ACTION.FORCE);
    expect(res.body.data.forceUpdate).toBe(true);
  });

  it('forces everyone behind the latest when the release is marked mandatory', async () => {
    await publish({ mandatory: true });

    const res = await check('platform=android&version=1.4.1');

    expect(res.body.data.updateAction).toBe(UPDATE_ACTION.FORCE);
  });

  it('never forces a client that is already current, even when mandatory is on', async () => {
    await publish({ mandatory: true, minSupportedVersion: '1.4.2' });

    const res = await check('platform=android&version=1.4.2');

    expect(res.body.data.updateAction).toBe(UPDATE_ACTION.NONE);
  });

  it('says NONE when no release has been published for the platform', async () => {
    const res = await check('platform=ios&version=1.0.0');

    expect(res.status).toBe(200);
    expect(res.body.data.updateAvailable).toBe(false);
    expect(res.body.data.updateAction).toBe(UPDATE_ACTION.NONE);
    // Still hands back the store link, so an app can offer it anyway.
    expect(res.body.data.storeUrl).toMatch(/apple\.com/);
  });

  it('offers — never forces — an update when the client cannot report its version', async () => {
    await publish({ minSupportedVersion: '1.4.0', mandatory: true });

    const res = await check('platform=android');

    expect(res.body.data.updateAction).toBe(UPDATE_ACTION.OPTIONAL);
  });

  it('resolves an unparseable client version to NONE rather than locking it out', async () => {
    await publish({ minSupportedVersion: '1.4.0', mandatory: true });

    const res = await check('platform=android&version=garbage');

    expect(res.body.data.updateAction).toBe(UPDATE_ACTION.NONE);
  });

  it('prefers the saved store URL over the configured fallback', async () => {
    await publish({ storeUrl: 'https://play.google.com/store/apps/details?id=custom' });

    const res = await check('platform=android&version=1.0.0');

    expect(res.body.data.storeUrl).toBe('https://play.google.com/store/apps/details?id=custom');
  });

  it('rejects an unknown platform', async () => {
    expect((await check('platform=symbian&version=1.0.0')).status).toBe(422);
    expect((await check('version=1.0.0')).status).toBe(422);
  });
});

describe('publishing a release', () => {
  it('creates the release and then edits it in place', async () => {
    const { token } = await createAdmin();

    const created = await asAdmin(token)
      .put('/api/v1/admin/app-versions/android')
      .send({ latestVersion: '1.4.2', minSupportedVersion: '1.4.0', releaseNotes: 'Notes.' });

    expect(created.status).toBe(200);
    expect(created.body.data.version.latestVersion).toBe('1.4.2');

    const edited = await asAdmin(token)
      .put('/api/v1/admin/app-versions/android')
      .send({ latestVersion: '1.4.3', mandatory: true });

    expect(edited.body.data.version.latestVersion).toBe('1.4.3');
    // Untouched fields survive a partial edit.
    expect(edited.body.data.version.minSupportedVersion).toBe('1.4.0');
    expect(edited.body.data.version.mandatory).toBe(true);
    expect(await AppVersion.countDocuments({})).toBe(1);
  });

  it('refuses a minimum newer than the latest version', async () => {
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .put('/api/v1/admin/app-versions/android')
      .send({ latestVersion: '1.4.2', minSupportedVersion: '1.5.0' });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/cannot be newer/i);
    expect(await AppVersion.countDocuments({})).toBe(0);
  });

  it('refuses a version string it cannot compare', async () => {
    const { token } = await createAdmin();

    const res = await asAdmin(token)
      .put('/api/v1/admin/app-versions/android')
      .send({ latestVersion: 'latest' });

    expect(res.status).toBe(422);
  });

  it('is closed to user tokens', async () => {
    const { token } = await createUser();

    const res = await asUser(token)
      .put('/api/v1/admin/app-versions/android')
      .send({ latestVersion: '1.4.2' });

    expect(res.status).toBe(401);
  });

  it('lists what is published per platform', async () => {
    const { token } = await createAdmin();
    await publish();

    const res = await asAdmin(token).get('/api/v1/admin/app-versions');

    expect(res.body.data.versions).toHaveLength(1);
    expect(res.body.data.versions[0].platform).toBe('android');
  });
});

describe('the app-update notification', () => {
  /** A user with one registered device reporting `appVersion`. */
  const userOnVersion = async (appVersion, platform = 'android') => {
    const created = await createUser();
    await asUser(created.token)
      .post('/api/v1/notifications/devices')
      .send({
        token: `token-${created.user._id}-${platform}-0000000000`,
        platform,
        ...(appVersion ? { appVersion } : {}),
      });
    return created;
  };

  it('notifies only the users on an older build', async () => {
    const { token: adminToken } = await createAdmin();
    await publish({ releaseNotes: 'Faster IMEI checks.' });

    const behind = await userOnVersion('1.3.0');
    await userOnVersion('1.4.2'); // already current

    const res = await asAdmin(adminToken).post('/api/v1/admin/app-versions/android/notify').send({});

    expect(res.status).toBe(200);
    expect(res.body.data.campaign.stats.targeted).toBe(1);

    const rows = await Notification.find({});
    expect(rows).toHaveLength(1);
    expect(String(rows[0].userId)).toBe(String(behind.user._id));
    expect(rows[0].type).toBe(NOTIFICATION_TYPE.APP_UPDATE);
  });

  it('counts a device that never reported a version as out of date', async () => {
    const { token: adminToken } = await createAdmin();
    await publish();
    await userOnVersion(null);

    const res = await asAdmin(adminToken).post('/api/v1/admin/app-versions/android/notify').send({});

    expect(res.body.data.campaign.stats.targeted).toBe(1);
  });

  it('leaves users on other platforms alone', async () => {
    const { token: adminToken } = await createAdmin();
    await publish();
    await userOnVersion('1.0.0', 'ios');

    const res = await asAdmin(adminToken).post('/api/v1/admin/app-versions/android/notify').send({});

    expect(res.body.data.campaign.stats.targeted).toBe(0);
  });

  it('carries everything the app needs to act on the tap', async () => {
    const { token: adminToken } = await createAdmin();
    await publish({ mandatory: true, storeUrl: 'https://play.google.com/store/apps/details?id=in.grest.ivs' });
    await userOnVersion('1.3.0');

    await asAdmin(adminToken).post('/api/v1/admin/app-versions/android/notify').send({});

    const notification = await Notification.findOne({});
    expect(notification.data.latestVersion).toBe('1.4.2');
    expect(notification.data.forceUpdate).toBe(true);
    expect(notification.data.storeUrl).toMatch(/play\.google\.com/);
    expect(notification.body).toMatch(/1\.4\.2/);
  });

  it('accepts custom copy', async () => {
    const { token: adminToken } = await createAdmin();
    await publish();
    await userOnVersion('1.3.0');

    await asAdmin(adminToken)
      .post('/api/v1/admin/app-versions/android/notify')
      .send({ title: 'New release', body: 'Tap to update.' });

    const notification = await Notification.findOne({});
    expect(notification.title).toBe('New release');
    expect(notification.body).toBe('Tap to update.');
  });

  it('publishes and announces in one call when asked', async () => {
    const { token: adminToken } = await createAdmin();
    await userOnVersion('1.3.0');

    const res = await asAdmin(adminToken)
      .put('/api/v1/admin/app-versions/android')
      .send({ latestVersion: '1.4.2', notify: true });

    expect(res.body.data.campaign.stats.targeted).toBe(1);
    expect(await Notification.countDocuments({})).toBe(1);
  });

  it('does not announce unless asked', async () => {
    const { token: adminToken } = await createAdmin();
    await userOnVersion('1.3.0');

    const res = await asAdmin(adminToken)
      .put('/api/v1/admin/app-versions/android')
      .send({ latestVersion: '1.4.2' });

    expect(res.body.data.campaign).toBeNull();
    expect(await Notification.countDocuments({})).toBe(0);
  });

  it('refuses to announce a release that was never published', async () => {
    const { token: adminToken } = await createAdmin();

    const res = await asAdmin(adminToken).post('/api/v1/admin/app-versions/ios/notify').send({});

    expect(res.status).toBe(404);
  });

  it('exposes the same decision to the client afterwards', async () => {
    const { token: adminToken } = await createAdmin();

    await asAdmin(adminToken)
      .put('/api/v1/admin/app-versions/android')
      .send({ latestVersion: '2.0.0', minSupportedVersion: '2.0.0' });

    const status = await appVersionService.checkForUpdate({
      platform: 'android',
      currentVersion: '1.9.9',
    });

    expect(status.updateAction).toBe(UPDATE_ACTION.FORCE);
  });
});
