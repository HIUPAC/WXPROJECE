const test = require('node:test');
const assert = require('node:assert/strict');
const path = require.resolve('../miniprogram/services/community');
const config = require('../miniprogram/config');
const SESSION_KEY = 'herb-origin:community:session:v1';
let community;
let mock;
let originalConsoleError;

function authResult(id = 'u_alice') {
  return {
    ok: true, user: { id, studentId: 'A001', phone: '13800000001', username: 'Alice', tags: [], bio: '', avatarUrl: '', avatarText: 'A' },
    sessionToken: (id === 'u_alice' ? 'a' : 'b').repeat(64), expiresAt: Date.now() + 60000
  };
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
test.beforeEach(() => {
  const data = new Map();
  mock = {
    data, calls: [], inits: [],
    getStorageSync: (key) => data.get(key),
    setStorageSync: (key, value) => { data.set(key, JSON.parse(JSON.stringify(value))); },
    removeStorageSync: (key) => { data.delete(key); },
    cloud: {
      init: (options) => { mock.inits.push(options); },
      callFunction: async (options) => {
        mock.calls.push(options);
        return { result: mock.result || { ok: true } };
      },
      uploadFile: async () => ({ fileID: 'cloud://env.bucket/avatars/openid/valid.png' })
    }
  };
  global.wx = mock;
  originalConsoleError = console.error;
  mock.logs = [];
  console.error = (...values) => mock.logs.push(values);
  delete require.cache[path];
  community = require(path);
});
test.afterEach(() => { console.error = originalConsoleError; });
test.after(() => { delete global.wx; delete require.cache[path]; });

test('cloud service failures never synthesize accounts or a public note feed', async () => {
  delete mock.cloud;
  assert.equal(community.getUser(), null);
  assert.equal(community.getStorageScope(), 'guest');
  assert.equal((await community.register({ username: '甲', password: '12345678' })).ok, false);
  assert.equal((await community.listNotes({ scope: 'public' })).ok, false);
  assert.equal(community.getUser(), null);
  assert.equal(mock.data.size, 0);
});

test('the explicit local edition stops cloud requests even after a cloud session was initialized', async () => {
  mock.result = authResult();
  await community.login({ account: 'A001', password: '12345678' });
  const calls = mock.calls.length;
  const mode = config.serviceMode;
  try {
    config.serviceMode = 'local';
    assert.equal((await community.listNotes({ scope: 'public' })).code, 'LOCAL_EDITION');
    assert.equal((await community.saveNote({ title: '待保存' })).code, 'LOCAL_EDITION');
    assert.equal(mock.calls.length, calls);
    assert.equal(community.getUser().id, 'u_alice');
  } finally { config.serviceMode = mode; }
});

test('reports use the current protected cloud transport without exposing credentials in the result', async () => {
  mock.result = { ok: true, duplicate: false };
  const result = await community.reportNote('n_report', 'privacy');
  assert.deepEqual(result, { ok: true, duplicate: false });
  assert.deepEqual(mock.calls[0].data, { action: 'reportNote', sessionToken: '', id: 'n_report', reason: 'privacy', detail: '' });
});
test('view recording uses the existing protected note API and supports both current and earlier cloud responses', async () => {
  mock.result = { ok: true, note: { viewCount: 8, todayViewCount: 2, viewDay: 20000 }, view: { counted: true, reason: 'COUNTED', day: 20000 } };
  const recorded = await community.recordNoteView('n_1', { viewKey: 'receipt-key-001', view: false, id: 'n_other' });
  assert.equal(recorded.view.viewCount, 8);
  assert.equal(recorded.view.todayViewCount, 2);
  assert.equal(recorded.view.reason, 'COUNTED');
  assert.deepEqual(mock.calls[0].data, { id: 'n_1', action: 'getNote', sessionToken: '', view: true, viewKey: 'receipt-key-001' });
  mock.result = { ok: true, note: { viewCount: 9 } };
  const older = await community.recordNoteView('n_1', { viewKey: 'receipt-key-001' });
  assert.equal(older.ok, true);
  assert.equal(older.view.viewCount, 9);
  assert.equal(older.view.todayViewCount, null);
  mock.result = { ok: true, note: { viewCount: -1 } };
  assert.equal((await community.recordNoteView('n_1', { viewKey: 'receipt-key-001' })).ok, false);
});

test('login caches only safe credentials and routes cloud initialization and calls to the configured environment', async () => {
  mock.result = authResult();
  const result = await community.login({ account: 'A001', password: 'sensitive-password' });
  assert.deepEqual(result, { ok: true, user: mock.result.user });
  assert.equal(community.getStorageScope(), 'u_alice');
  assert.deepEqual(mock.inits, [config.cloudEnv ? { traceUser: true, env: config.cloudEnv } : { traceUser: true }]);
  assert.deepEqual(mock.calls[0].config, config.cloudEnv ? { env: config.cloudEnv } : undefined);
  assert.equal(JSON.stringify(Array.from(mock.data)).includes('sensitive-password'), false);
  assert.equal(result.sessionToken, undefined);
  const user = community.getUser();
  user.username = 'changed externally';
  assert.equal(community.getUser().username, 'Alice');
  delete require.cache[path];
  community = require(path);
  assert.equal(community.getUser().id, 'u_alice');
});

test('note reactions preserve the requested target state and protect note identity and action', async () => {
  mock.result = { ok: true, note: { id: 'n_1', liked: true, favorite: false } };
  await community.toggleLike('n_1', { active: true, id: 'n_other', action: 'deleteNote', sessionToken: 'forged' });
  assert.deepEqual(mock.calls.at(-1).data, { active: true, id: 'n_1', action: 'toggleLike', sessionToken: '' });
  await community.toggleNoteFavorite('n_1', { active: false });
  assert.deepEqual(mock.calls.at(-1).data, { active: false, id: 'n_1', action: 'toggleNoteFavorite', sessionToken: '' });
  await community.toggleLike('n_1');
  assert.deepEqual(mock.calls.at(-1).data, { id: 'n_1', action: 'toggleLike', sessionToken: '' });
});

test('all requests safely convert thrown network and malformed server responses into Chinese failures', async () => {
  mock.cloud.callFunction = async () => { throw new Error('network timeout'); };
  assert.deepEqual(await community.getStats(), { ok: false, error: '网络连接失败，请稍后重试' });
  mock.cloud.callFunction = async () => ({ result: {} });
  const malformed = await community.getNote('n_01');
  assert.equal(malformed.ok, false);
  assert.match(malformed.error, /社区服务暂不可用/);
  assert.equal(community.getUser(), null);
});

test('cloud failure diagnostics identify deployment errors without logging submitted passwords or raw error data', async () => {
  mock.cloud.callFunction = async () => {
    const error = new Error('function not exists; sensitive-password; private-body');
    error.errCode = -501005;
    error.requestID = 'request-123';
    error.data = { password: 'sensitive-password' };
    throw error;
  };
  const result = await community.login({ account: 'A001', password: 'sensitive-password' });
  assert.equal(result.ok, false);
  assert.equal(mock.logs[0][1].reason, 'FUNCTION_MISSING');
  assert.equal(mock.logs[0][1].code, '-501005');
  assert.equal(mock.logs[0][1].requestId, 'request-123');
  const printed = JSON.stringify(mock.logs);
  assert.equal(printed.includes('sensitive-password'), false);
  assert.equal(printed.includes('private-body'), false);
});

test('expired or server-rejected sessions immediately clear the current account and its storage scope', async () => {
  mock.data.set(SESSION_KEY, Object.assign(authResult(), { expiresAt: Date.now() - 1 }));
  assert.equal(community.getUser(), null);
  assert.equal(mock.data.has(SESSION_KEY), false);
  mock.result = authResult();
  await community.login({ account: 'A001', password: '12345678' });
  mock.result = { ok: false, code: 'AUTH_REQUIRED', error: '登录已失效，请重新登录' };
  assert.equal((await community.getStats()).code, 'AUTH_REQUIRED');
  assert.equal(community.getUser(), null);
  assert.equal(community.getStorageScope(), 'guest');
});

test('the session and action are assigned by the service and cannot be overridden by page input', async () => {
  mock.result = authResult();
  await community.login({ account: 'A001', password: '12345678' });
  mock.result = { ok: true, notes: [], total: 0, hasMore: false };
  await community.listNotes({ scope: 'my', action: 'deleteNote', sessionToken: 'forged' });
  const call = mock.calls.at(-1);
  assert.equal(call.data.action, 'listNotes');
  assert.equal(call.data.sessionToken, 'a'.repeat(64));
});

test('late replies from another account are rejected, and logout cannot erase a newer login', async () => {
  mock.result = authResult();
  await community.login({ account: 'A001', password: '12345678' });
  const logoutResponse = deferred();
  mock.cloud.callFunction = async (options) => {
    if (options.data.action === 'logout') return logoutResponse.promise;
    return { result: authResult('u_bob') };
  };
  const logout = community.logout();
  const loggedIn = await community.login({ account: 'B001', password: '12345678' });
  assert.equal(loggedIn.user.id, 'u_bob');
  logoutResponse.resolve({ result: { ok: true } });
  assert.equal((await logout).code, 'ACCOUNT_CHANGED');
  assert.equal(community.getUser().id, 'u_bob');
  const pending = deferred();
  mock.cloud.callFunction = (options) => options.data.action === 'listNotes' ? pending.promise : Promise.resolve({ result: { ok: true } });
  const notes = community.listNotes({ scope: 'my' });
  await community.logout();
  pending.resolve({ result: { ok: true, notes: [{ id: 'private-old-account' }], total: 1 } });
  assert.equal((await notes).code, 'ACCOUNT_CHANGED');
  assert.equal(community.getUser(), null);
});

test('logout clears local credentials even when server revocation is temporarily unavailable', async () => {
  mock.result = authResult();
  await community.login({ account: 'A001', password: '12345678' });
  mock.cloud.callFunction = async () => { throw new Error('network unavailable'); };
  assert.equal((await community.logout()).ok, true);
  assert.equal(mock.data.has(SESSION_KEY), false);
  assert.equal(community.getUser(), null);
});

test('formal accounts use text avatars without uploading unchecked images, and profile saves update the cache', async () => {
  mock.result = authResult();
  await community.login({ account: 'A001', password: '12345678' });
  const calls = [];
  mock.cloud.callFunction = async (options) => {
    calls.push(options.data.action);
    if (options.data.action === 'prepareAvatar') return { result: { ok: true, ticket: 'ticket-01', cloudPath: 'avatars/openid/valid.png' } };
    if (options.data.action === 'finishAvatar') return { result: { ok: true, avatarUrl: 'cloud://env.bucket/avatars/openid/valid.png' } };
    return { result: { ok: true, user: Object.assign({}, authResult().user, options.data) } };
  };
  const uploaded = await community.uploadAvatar('wxfile://photo.png');
  assert.equal(uploaded.code, 'AVATAR_UNAVAILABLE');
  assert.deepEqual(calls, []);
  const profile = await community.updateProfile({ username: '小草', tags: ['本草'], bio: '个人简介', avatarUrl: '' });
  assert.equal(profile.user.username, '小草');
  assert.equal(community.getUser().bio, '个人简介');
});
