const { createUser, createAdmin, asUser, request, app } = require('./helpers/factory');
const Notification = require('../src/models/Notification.model');
const DeviceToken = require('../src/models/DeviceToken.model');
const notificationService = require('../src/services/notification.service');
const fcmProvider = require('../src/services/providers/fcmProvider');
const USER_STATUS = require('../src/constants/userStatus');
const { NOTIFICATION_TYPE, AUDIENCE_MODE, CAMPAIGN_STATUS } = require('../src/constants/notification');

/**
 * FCM is unconfigured under test (see test/setup/env.js), so no push leaves the
 * process. That is the point: these specs pin the guarantee the API actually
 * makes — the notification is recorded and the request succeeds regardless of
 * what FCM does — rather than asserting against a mocked Google.
 */

const TOKEN = 'fMEP0vJ-test-registration-token-0000000000';

const asAdmin = (token) => ({
  post: (path) => request(app).post(path).set('Authorization', `Bearer ${token}`),
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${token}`),
  put: (path) => request(app).put(path).set('Authorization', `Bearer ${token}`),
});

describe('device registration', () => {
  it('registers a token and reports that push is unavailable here', async () => {
    const { token } = await createUser();

    const res = await asUser(token)
      .post('/api/v1/notifications/devices')
      .send({ token: TOKEN, platform: 'android', appVersion: '1.3.0', deviceModel: 'Pixel 7a' });

    expect(res.status).toBe(200);
    expect(res.body.data.pushEnabled).toBe(false);
    expect(res.body.data.device.platform).toBe('android');
    expect(await DeviceToken.countDocuments({})).toBe(1);
  });

  it('never leaks the registration token back out', async () => {
    const { token } = await createUser();

    const res = await asUser(token)
      .post('/api/v1/notifications/devices')
      .send({ token: TOKEN, platform: 'android' });

    expect(res.body.data.device.token).toBeUndefined();
  });

  it('is idempotent — re-registering updates the same row', async () => {
    const { token } = await createUser();

    await asUser(token).post('/api/v1/notifications/devices').send({ token: TOKEN, platform: 'android', appVersion: '1.3.0' });
    await asUser(token).post('/api/v1/notifications/devices').send({ token: TOKEN, platform: 'android', appVersion: '1.4.0' });

    expect(await DeviceToken.countDocuments({})).toBe(1);
    const row = await DeviceToken.findOne({ token: TOKEN });
    expect(row.appVersion).toBe('1.4.0');
  });

  it('moves a token to the new owner when the handset changes hands', async () => {
    const first = await createUser();
    const second = await createUser();

    await asUser(first.token).post('/api/v1/notifications/devices').send({ token: TOKEN, platform: 'android' });
    await asUser(second.token).post('/api/v1/notifications/devices').send({ token: TOKEN, platform: 'android' });

    const row = await DeviceToken.findOne({ token: TOKEN });
    expect(String(row.userId)).toBe(String(second.user._id));
    expect(await DeviceToken.countDocuments({})).toBe(1);
  });

  it('rejects an unknown platform', async () => {
    const { token } = await createUser();

    const res = await asUser(token)
      .post('/api/v1/notifications/devices')
      .send({ token: TOKEN, platform: 'blackberry' });

    expect(res.status).toBe(422);
  });

  it('will not let one user unregister another user’s device', async () => {
    const owner = await createUser();
    const stranger = await createUser();

    await asUser(owner.token).post('/api/v1/notifications/devices').send({ token: TOKEN, platform: 'android' });

    const res = await asUser(stranger.token).delete('/api/v1/notifications/devices').send({ token: TOKEN });

    expect(res.body.data.removed).toBe(false);
    expect((await DeviceToken.findOne({ token: TOKEN })).isActive).toBe(true);
  });

  it('retires the device on logout when the client sends its token', async () => {
    const { token } = await createUser();

    await asUser(token).post('/api/v1/notifications/devices').send({ token: TOKEN, platform: 'android' });
    await asUser(token).post('/api/v1/auth/logout').send({ deviceId: 'device-1', fcmToken: TOKEN });

    const row = await DeviceToken.findOne({ token: TOKEN });
    expect(row.isActive).toBe(false);
    expect(row.inactiveReason).toBe('LOGOUT');
  });
});

describe('the inbox', () => {
  it('records a notification for a user with no device at all', async () => {
    const { user } = await createUser();

    const notification = await notificationService.notifyUser(user._id, {
      title: 'Tokens credited',
      body: '500 tokens added to your wallet.',
      type: NOTIFICATION_TYPE.WALLET,
    });

    expect(notification.pushed).toBe(false);
    // Nothing went wrong — there was simply nowhere to push to.
    expect(notification.pushError).toBeNull();
    expect(await Notification.countDocuments({ userId: user._id })).toBe(1);
  });

  it('records why a push did not land when the user does have a device', async () => {
    const { user, token } = await createUser();
    await asUser(token).post('/api/v1/notifications/devices').send({ token: TOKEN, platform: 'android' });

    const notification = await notificationService.notifyUser(user._id, {
      title: 'Tokens credited',
      body: '500 tokens added to your wallet.',
      type: NOTIFICATION_TYPE.WALLET,
    });

    expect(notification.pushed).toBe(false);
    expect(notification.pushError).toBe('FCM is not configured');
  });

  it('lists newest first with an unread count alongside', async () => {
    const { user, token } = await createUser();

    await notificationService.notifyUser(user._id, { title: 'First', body: 'one' });
    await notificationService.notifyUser(user._id, { title: 'Second', body: 'two' });

    const res = await asUser(token).get('/api/v1/notifications');

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((n) => n.title)).toEqual(['Second', 'First']);
    expect(res.body.data.unreadCount).toBe(2);
    expect(res.body.data.items[0].isRead).toBe(false);
  });

  it('shows only my notifications', async () => {
    const mine = await createUser();
    const theirs = await createUser();

    await notificationService.notifyUser(mine.user._id, { title: 'Mine', body: 'x' });
    await notificationService.notifyUser(theirs.user._id, { title: 'Theirs', body: 'y' });

    const res = await asUser(mine.token).get('/api/v1/notifications');

    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].title).toBe('Mine');
  });

  it('marks one read, and marking it twice is not an error', async () => {
    const { user, token } = await createUser();
    const notification = await notificationService.notifyUser(user._id, { title: 'Hi', body: 'x' });

    const first = await asUser(token).patch(`/api/v1/notifications/${notification._id}/read`);
    const second = await asUser(token).patch(`/api/v1/notifications/${notification._id}/read`);

    expect(first.status).toBe(200);
    expect(first.body.data.notification.isRead).toBe(true);
    expect(second.status).toBe(200);
    expect(await notificationService.unreadCount(user._id)).toBe(0);
  });

  it('will not mark another user’s notification read', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const notification = await notificationService.notifyUser(owner.user._id, { title: 'Hi', body: 'x' });

    const res = await asUser(stranger.token).patch(`/api/v1/notifications/${notification._id}/read`);

    expect(res.status).toBe(404);
    expect(await notificationService.unreadCount(owner.user._id)).toBe(1);
  });

  it('marks everything read at once', async () => {
    const { user, token } = await createUser();
    await notificationService.notifyUser(user._id, { title: 'a', body: 'x' });
    await notificationService.notifyUser(user._id, { title: 'b', body: 'x' });

    const res = await asUser(token).patch('/api/v1/notifications/read-all');

    expect(res.body.data.updated).toBe(2);
    expect(await notificationService.unreadCount(user._id)).toBe(0);
  });

  it('filters to unread only', async () => {
    const { user, token } = await createUser();
    const read = await notificationService.notifyUser(user._id, { title: 'read', body: 'x' });
    await notificationService.notifyUser(user._id, { title: 'unread', body: 'x' });
    await notificationService.markRead(user._id, read._id);

    const res = await asUser(token).get('/api/v1/notifications?unreadOnly=true');

    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].title).toBe('unread');
  });

  it('deletes only my own notification', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const notification = await notificationService.notifyUser(owner.user._id, { title: 'x', body: 'y' });

    expect((await asUser(stranger.token).delete(`/api/v1/notifications/${notification._id}`)).status).toBe(404);
    expect((await asUser(owner.token).delete(`/api/v1/notifications/${notification._id}`)).status).toBe(200);
    expect(await Notification.countDocuments({})).toBe(0);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
  });
});

describe('admin broadcasts', () => {
  it('reaches every active user and records the campaign', async () => {
    const { token: adminToken } = await createAdmin();
    await createUser();
    await createUser();

    const res = await asAdmin(adminToken)
      .post('/api/v1/admin/notifications/send')
      .send({ title: 'Maintenance', body: 'Down 1-2 AM.', type: NOTIFICATION_TYPE.SYSTEM });

    expect(res.status).toBe(200);
    expect(res.body.data.campaign.status).toBe(CAMPAIGN_STATUS.COMPLETED);
    expect(res.body.data.campaign.stats.targeted).toBe(2);
    expect(res.body.data.campaign.stats.delivered).toBe(2);
    expect(res.body.data.pushEnabled).toBe(false);
    expect(await Notification.countDocuments({})).toBe(2);
  });

  it('skips blocked and deleted accounts', async () => {
    const { token: adminToken } = await createAdmin();
    await createUser();
    await createUser({ status: USER_STATUS.BLOCKED });
    await createUser({ status: USER_STATUS.DELETED });

    const res = await asAdmin(adminToken)
      .post('/api/v1/admin/notifications/send')
      .send({ title: 'Hello', body: 'x' });

    expect(res.body.data.campaign.stats.targeted).toBe(1);
  });

  it('targets an explicit list of users', async () => {
    const { token: adminToken } = await createAdmin();
    const picked = await createUser();
    await createUser();

    const res = await asAdmin(adminToken)
      .post('/api/v1/admin/notifications/send')
      .send({
        title: 'Just you',
        body: 'x',
        audience: { mode: AUDIENCE_MODE.USER_IDS, userIds: [String(picked.user._id)] },
      });

    expect(res.body.data.campaign.stats.targeted).toBe(1);
    const rows = await Notification.find({});
    expect(rows).toHaveLength(1);
    expect(String(rows[0].userId)).toBe(String(picked.user._id));
  });

  it('filters by KYC state', async () => {
    const { token: adminToken } = await createAdmin();
    await createUser({ kycCompleted: true });
    await createUser({ kycCompleted: false });

    const res = await asAdmin(adminToken)
      .post('/api/v1/admin/notifications/send')
      .send({
        title: 'Finish your KYC',
        body: 'x',
        type: NOTIFICATION_TYPE.KYC,
        audience: { mode: AUDIENCE_MODE.FILTER, filter: { kycCompleted: false } },
      });

    expect(res.body.data.campaign.stats.targeted).toBe(1);
  });

  it('says so plainly when nobody matched', async () => {
    const { token: adminToken } = await createAdmin();

    const res = await asAdmin(adminToken)
      .post('/api/v1/admin/notifications/send')
      .send({ title: 'Hello', body: 'x' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/No users matched/i);
    expect(res.body.data.campaign.stats.targeted).toBe(0);
  });

  it('refuses a mistyped user id rather than failing mid-send', async () => {
    const { token: adminToken } = await createAdmin();

    const res = await asAdmin(adminToken)
      .post('/api/v1/admin/notifications/send')
      .send({ title: 'x', body: 'y', audience: { mode: AUDIENCE_MODE.USER_IDS, userIds: ['not-an-id'] } });

    expect(res.status).toBe(422);
  });

  it('requires a title and a body', async () => {
    const { token: adminToken } = await createAdmin();

    expect((await asAdmin(adminToken).post('/api/v1/admin/notifications/send').send({ body: 'x' })).status).toBe(422);
    expect((await asAdmin(adminToken).post('/api/v1/admin/notifications/send').send({ title: 'x' })).status).toBe(422);
  });

  it('is closed to user tokens', async () => {
    const { token } = await createUser();

    const res = await asUser(token).post('/api/v1/admin/notifications/send').send({ title: 'x', body: 'y' });

    expect(res.status).toBe(401);
  });

  it('lists past campaigns with their stats', async () => {
    const { token: adminToken } = await createAdmin();
    await createUser();

    await asAdmin(adminToken).post('/api/v1/admin/notifications/send').send({ title: 'One', body: 'x' });

    const res = await asAdmin(adminToken).get('/api/v1/admin/notifications/campaigns');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].title).toBe('One');
  });
});

describe('the FCM provider itself', () => {
  it('reports itself unconfigured and skips without touching the network', async () => {
    expect(fcmProvider.isConfigured()).toBe(false);

    const summary = await fcmProvider.sendToTokens([TOKEN], { title: 'x', body: 'y' });

    expect(summary.skipped).toBe(true);
    expect(summary.successCount).toBe(0);
  });

  it('does nothing at all when there are no tokens', async () => {
    const summary = await fcmProvider.sendToTokens([], { title: 'x', body: 'y' });

    expect(summary.skipped).toBe(false);
    expect(summary.failureCount).toBe(0);
  });

  it('coerces every data value to a string, as FCM requires', () => {
    const data = fcmProvider.stringifyData({ a: 'text', b: 7, c: true, d: undefined, e: { f: 1 } });

    expect(data).toEqual({ a: 'text', b: '7', c: 'true', e: '{"f":1}' });
  });

  it('puts the routing payload in both notification and data blocks', () => {
    const message = fcmProvider.buildMessage({
      token: TOKEN,
      title: 'Update available',
      body: 'Version 1.4.2 is out.',
      data: { screen: 'AppUpdate' },
    });

    expect(message.token).toBe(TOKEN);
    expect(message.notification.title).toBe('Update available');
    expect(message.data.screen).toBe('AppUpdate');
    expect(message.android.priority).toBe('high');
  });
});
