const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const SESSION_KEY = 'herb-origin:community:session:v1';
const DEMO_KEY = 'herb-origin:official-demo:v1';
const paths = ['store', 'community', 'demo'].map(name => require.resolve('../miniprogram/services/' + name));
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
let community, store, mock;

function reload() {
  paths.forEach(file => { delete require.cache[file]; });
  community = require('../miniprogram/services/community');
  store = require('../miniprogram/services/store');
}
function realSession() {
  return { user: { id: 'real-user', username: '林同学', tags: [] }, sessionToken: 'a'.repeat(64), expiresAt: Date.now() + 100000 };
}
test.beforeEach(() => {
  const values = new Map();
  mock = { values, failWrite: false, blockedKey: '', cloudCalls: 0, fileCalls: [], size: 1024, failFile: false,
    getStorageSync(key) { return copy(values.get(key)); },
    setStorageSync(key, value) {
      if (this.failWrite || key === this.blockedKey) throw new Error('storage full');
      values.set(key, copy(value));
    },
    removeStorageSync(key) { values.delete(key); },
    getFileSystemManager() {
      return {
        stat(options) { mock.fileCalls.push(['stat', options.path]); options.success({ stats: { size: mock.size } }); },
        saveFile(options) {
          mock.fileCalls.push(['save', options.tempFilePath]);
          if (mock.failFile) options.fail(new Error('storage full'));
          else options.success({ savedFilePath: 'wxfile://saved/avatar.jpg' });
        }
      };
    }
  };
  global.wx = mock;
  reload();
});
test.afterEach(() => { delete global.wx; delete global.getApp; paths.forEach(file => { delete require.cache[file]; }); });

test('official demo starts without cloud or credentials and survives a restart', async () => {
  mock.cloud = { init() { mock.cloudCalls += 1; throw new Error('not deployed'); }, callFunction() { mock.cloudCalls += 1; throw new Error('offline'); } };
  assert.equal(community.getUser(), null);
  const result = await community.enterDemo();
  assert.equal(result.ok, true);
  assert.equal(result.user.isDemo, true);
  assert.equal(result.user.avatarText, '百');
  assert.deepEqual(mock.values.get(SESSION_KEY), { mode: 'demo' });
  assert.equal(Object.hasOwn(result.user, 'password'), false);
  const mine = await community.listNotes({ scope: 'my' });
  const publicNotes = await community.listNotes({ scope: 'public' });
  assert.equal(mine.notes.length, 2);
  assert.ok(mine.notes.every(note => note.mine && note.isDemo));
  assert.equal(publicNotes.notes.length, 2);
  assert.ok(publicNotes.notes.every(note => note.visibility === 'public'));
  assert.ok(publicNotes.notes.some(note => !note.mine));
  assert.deepEqual((await community.getStats()).stats, { notes: 2, publicNotes: 1, privateNotes: 1, views: 0, todayViews: 0, likes: 0, favorites: 0, likedNotes: 0, savedNotes: 0 });
  reload();
  assert.equal(community.getUser().id, result.user.id);
  assert.equal((await community.listNotes({ scope: 'my' })).total, 2);
  assert.equal(mock.cloudCalls, 0);
});

test('demo notes can be created, edited, filtered and deleted with consistent statistics', async () => {
  await community.enterDemo();
  const input = { title: '  新的观察  ', body: '  叶片与叶缘  ', visibility: 'private', relatedKey: 'herb:h1', creationKey: 'create-observation-001' };
  const saved = await community.saveNote(input);
  assert.equal(saved.ok, true);
  assert.equal(saved.note.title, '新的观察');
  assert.equal((await community.listNotes({ scope: 'public', query: '新的观察' })).total, 0);
  const retry = await community.saveNote(input);
  assert.equal(retry.note.id, saved.note.id);
  assert.equal((await community.getStats()).stats.notes, 3);
  const edited = await community.saveNote({ ...input, id: saved.note.id, visibility: 'public', body: '观察叶片的颜色' });
  assert.equal(edited.note.createdAt, saved.note.createdAt);
  const found = await community.listNotes({ scope: 'public', query: '观察叶片的颜色', relatedKey: 'herb:h1', limit: 1 });
  assert.equal(found.total, 1);
  assert.equal(found.notes[0].id, saved.note.id);
  assert.equal((await community.getStats()).stats.publicNotes, 2);
  await community.saveNote({ ...input, id: saved.note.id });
  assert.equal((await community.listNotes({ scope: 'public', query: '新的观察' })).total, 0);
  assert.equal((await community.getStats()).stats.privateNotes, 2);
  assert.equal((await community.deleteNote(saved.note.id)).ok, true);
  assert.equal((await community.getNote(saved.note.id)).ok, false);
  assert.equal((await community.getStats()).stats.notes, 2);
});

test('demo protects official sample ownership and rejects invalid note fields', async () => {
  await community.enterDemo();
  const input = { title: '观察', body: '叶片', visibility: 'private', relatedKey: '' };
  assert.equal((await community.saveNote({ ...input, id: 'demo-editor-observation' })).code, 'FORBIDDEN');
  assert.equal((await community.deleteNote('demo-editor-observation')).code, 'FORBIDDEN');
  for (const invalid of [{ title: '' }, { body: '' }, { visibility: 'friends' }, { relatedKey: 'herb:missing' }, { creationKey: 'short' }]) {
    assert.equal((await community.saveNote({ ...input, ...invalid })).ok, false);
  }
  assert.equal((await community.getStats()).stats.notes, 2);
});

test('demo interactions update lists and totals, and failed writes preserve previous counts', async () => {
  await community.enterDemo();
  const id = 'demo-my-public';
  assert.equal((await community.toggleLike(id)).note.likeCount, 1);
  assert.equal((await community.toggleNoteFavorite(id)).note.favoriteCount, 1);
  assert.equal((await community.listNotes({ scope: 'liked' })).notes[0].id, id);
  assert.equal((await community.listNotes({ scope: 'favorites' })).notes[0].id, id);
  const stats = (await community.getStats()).stats;
  assert.equal(stats.likes, 1); assert.equal(stats.favorites, 1); assert.equal(stats.likedNotes, 1); assert.equal(stats.savedNotes, 1);
  const persisted = copy(mock.values.get(DEMO_KEY));
  mock.failWrite = true;
  assert.equal((await community.toggleLike(id)).ok, false);
  assert.equal((await community.deleteNote(id)).ok, false);
  assert.equal((await community.getNote(id)).note.likeCount, 1);
  assert.deepEqual(mock.values.get(DEMO_KEY), persisted);
  mock.failWrite = false;
  assert.equal((await community.toggleLike(id)).note.likeCount, 0);
  assert.equal((await community.toggleNoteFavorite(id)).note.favoriteCount, 0);
  assert.equal((await community.listNotes({ scope: 'liked' })).total, 0);
  assert.equal((await community.listNotes({ scope: 'favorites' })).total, 0);
  await community.toggleLike(id);
  await community.deleteNote(id);
  assert.equal((await community.getStats()).stats.likes, 0);
  assert.equal((await community.getStats()).stats.likedNotes, 0);
});

test('demo explicit reaction states survive repeated requests, restarts and storage failures', async () => {
  await community.enterDemo();
  const id = 'demo-my-private';
  for (const [method, field, counter] of [
    ['toggleLike', 'liked', 'likeCount'], ['toggleNoteFavorite', 'favorite', 'favoriteCount']
  ]) {
    const repeated = await Promise.all(Array.from({ length: 4 }, () => community[method](id, { active: true })));
    assert.ok(repeated.every(result => result.ok && result.note[field] && result.note[counter] === 1));
    mock.failWrite = true;
    assert.equal((await community[method](id, { active: true })).ok, true);
    assert.equal((await community[method](id, { active: false })).ok, false);
    assert.equal((await community.getNote(id)).note[counter], 1);
    mock.failWrite = false;
    for (const active of [null, 'true', 1]) assert.equal((await community[method](id, { active })).code, 'INVALID_INPUT');
  }
  const stats = (await community.getStats()).stats;
  assert.equal(stats.likes, 1); assert.equal(stats.favorites, 1);
  assert.equal(stats.likedNotes, 1); assert.equal(stats.savedNotes, 1);
  reload();
  assert.equal((await community.toggleLike(id, { active: true })).note.likeCount, 1);
  assert.equal((await community.toggleNoteFavorite(id, { active: true })).note.favoriteCount, 1);
  for (const method of ['toggleLike', 'toggleNoteFavorite']) {
    await community[method](id, { active: false });
    await community[method](id, { active: false });
  }
  assert.equal((await community.getStats()).stats.likes, 0);
  assert.equal((await community.getStats()).stats.favorites, 0);
});

test('demo views deduplicate retries across days and never count the author', async t => {
  const originalNow = Date.now;
  t.after(() => { Date.now = originalNow; });
  let timestamp = Date.parse('2026-10-09T12:00:00.000Z');
  Date.now = () => timestamp;
  await community.enterDemo();
  const read = viewKey => community.getNote('demo-editor-observation', { view: true, viewKey });
  const first = await read('read-first-001');
  assert.equal(first.note.viewCount, 1); assert.equal(first.note.todayViewCount, 1);
  assert.equal(first.view.reason, 'COUNTED');
  assert.equal((await read('read-second-002')).note.viewCount, 1);
  assert.equal((await read('read-first-001')).note.viewCount, 1);
  timestamp += 86400000;
  assert.equal((await community.getNote('demo-editor-observation')).note.todayViewCount, 0);
  assert.equal((await read('read-first-001')).note.viewCount, 1);
  assert.equal((await read('read-third-003')).note.viewCount, 2);
  assert.equal((await community.getNote('demo-my-public', { view: true, viewKey: 'read-own-note-001' })).note.viewCount, 0);
  assert.equal((await community.getStats()).stats.views, 0);
  assert.equal((await community.getNote('demo-editor-observation')).note.viewCount, 2);
});

test('demo view write failures leave totals unchanged and can retry without a duplicate receipt', async () => {
  await community.enterDemo();
  const persisted = copy(mock.values.get(DEMO_KEY));
  mock.failWrite = true;
  const failed = await community.recordNoteView('demo-editor-observation', { viewKey: 'failed-view-001' });
  assert.equal(failed.ok, false);
  const unchanged = await community.getNote('demo-editor-observation');
  assert.equal(unchanged.note.viewCount, 0); assert.equal(unchanged.note.todayViewCount, 0);
  assert.deepEqual(mock.values.get(DEMO_KEY), persisted);
  mock.failWrite = false;
  const retry = await community.recordNoteView('demo-editor-observation', { viewKey: 'failed-view-001' });
  assert.equal(retry.view.viewCount, 1); assert.equal(retry.view.todayViewCount, 1);
  assert.equal(retry.view.reason, 'COUNTED');
  const replay = await community.recordNoteView('demo-editor-observation', { viewKey: 'failed-view-001' });
  assert.equal(replay.view.viewCount, 1); assert.equal(replay.view.reason, 'REQUEST_REPLAY');
  reload();
  assert.equal((await community.getNote('demo-editor-observation')).note.viewCount, 1);
});

test('demo profile edits update note authors and default avatars without cloud', async () => {
  await community.enterDemo();
  const profile = { username: '99alice', tags: ['草木', '草木', ' 观察 '], bio: ' 认识一草一木 ', avatarUrl: '' };
  const result = await community.updateProfile(profile);
  assert.equal(result.ok, true);
  assert.equal(result.user.avatarText, 'A');
  assert.deepEqual(result.user.tags, ['草木', '观察']);
  assert.equal(result.user.bio, '认识一草一木');
  assert.equal((await community.getNote('demo-my-public')).note.author.username, '99alice');
  assert.equal((await community.updateProfile({ ...profile, username: '123林同学' })).user.avatarText, '林');
  assert.equal((await community.updateProfile({ ...profile, tags: ['1', '2', '3', '4', '5', '6', '7'] })).ok, false);
  assert.equal((await community.updateProfile({ ...profile, avatarUrl: 'https://other-user/avatar.jpg' })).ok, false);
  mock.failWrite = true;
  assert.equal((await community.updateProfile({ ...profile, username: '未保存' })).ok, false);
  assert.equal(community.getUser().username, '123林同学');
  mock.failWrite = false;
  reload();
  assert.equal(community.getUser().username, '123林同学');
});

test('demo avatar uses persistent local files, enforces size and retries save failures', async () => {
  await community.enterDemo();
  const input = { username: '林', tags: [], bio: '' };
  mock.size = 2 * 1024 * 1024 + 1;
  assert.equal((await community.uploadAvatar('wxfile://tmp/avatar.jpg')).ok, false);
  assert.equal(mock.fileCalls.filter(call => call[0] === 'save').length, 0);
  mock.size = 1024;
  mock.failFile = true;
  assert.equal((await community.uploadAvatar('wxfile://tmp/avatar.jpg')).ok, false);
  assert.equal(community.getUser().avatarUrl, '');
  mock.failFile = false;
  const uploaded = await community.uploadAvatar('wxfile://tmp/avatar.jpg');
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.avatarUrl, 'wxfile://saved/avatar.jpg');
  assert.equal((await community.updateProfile({ ...input, avatarUrl: uploaded.avatarUrl })).ok, true);
  reload();
  assert.equal(community.getUser().avatarUrl, uploaded.avatarUrl);
  assert.equal(mock.cloudCalls, 0);
});

test('guest, demo and real account learning records stay isolated and demo survives logout', async () => {
  store.toggleFavorite('herb:h1');
  store.completeChapter('c1', 'c1-1');
  store.saveNote({ title: '游客手记', body: '原记录', relatedKey: '' });
  const guest = store.getState();
  await community.enterDemo();
  assert.equal(store.getState().favorites.length, 0);
  assert.equal(store.getStats().learning, 0);
  assert.equal(store.getState().notes.length, 0);
  assert.deepEqual(store.getGuestState(), guest);
  store.toggleFavorite('herb:h2');
  store.completeChapter('c1', 'c1-2');
  const saved = await community.saveNote({ title: '演示观察', body: '演示内容', visibility: 'private' });
  await community.logout();
  assert.deepEqual(store.getState(), guest);
  await community.enterDemo();
  assert.deepEqual(store.getState().favorites, ['herb:h2']);
  assert.deepEqual(store.getProgress('c1').completed, ['c1-2']);
  assert.equal((await community.getNote(saved.note.id)).note.title, '演示观察');
  mock.cloud = { init() {}, callFunction: async () => ({ result: { ok: true, ...realSession() } }) };
  assert.equal((await community.login({ account: '20260001', password: 'abc12345' })).ok, true);
  assert.equal(community.isDemoMode(), false);
  assert.equal(store.getState().favorites.length, 0);
  assert.deepEqual(store.getGuestState(), guest);
  assert.deepEqual(community.getDemoNotes(), []);
});

test('entering demo fails honestly on storage errors and preserves an existing real session', async () => {
  mock.failWrite = true;
  assert.equal((await community.enterDemo()).ok, false);
  assert.equal(community.getUser(), null);
  assert.equal(mock.values.size, 0);
  mock.failWrite = false;
  mock.values.set(SESSION_KEY, realSession());
  reload();
  mock.blockedKey = SESSION_KEY;
  assert.equal((await community.enterDemo()).ok, false);
  assert.equal(community.getUser().id, 'real-user');
  assert.equal(mock.values.get(SESSION_KEY).sessionToken, 'a'.repeat(64));
});

test('failed real login keeps demo available and never sends a demo credential to cloud', async () => {
  await community.enterDemo();
  const requests = [];
  mock.cloud = { init() {}, callFunction: async options => { requests.push(options.data); return { result: { ok: false, error: '密码错误' } }; } };
  assert.equal((await community.login({ account: '20260001', password: 'wrong' })).ok, false);
  assert.equal(community.isDemoMode(), true);
  assert.equal((await community.getStats()).ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'login');
  assert.equal(requests[0].sessionToken, '');
});

test('a late real login cannot replace a demo entered while the request was pending', async () => {
  let finish;
  mock.cloud = { init() {}, callFunction: () => new Promise(resolve => { finish = resolve; }) };
  const pending = community.login({ account: '20260001', password: 'abc12345' });
  await community.enterDemo();
  finish({ result: { ok: true, ...realSession() } });
  assert.equal((await pending).code, 'ACCOUNT_CHANGED');
  assert.equal(community.getUser().isDemo, true);
});

test('failed demo logout preserves the active session and corrupt stored data is not overwritten', async () => {
  await community.enterDemo();
  mock.failWrite = true;
  assert.equal((await community.logout()).ok, false);
  assert.equal(community.isDemoMode(), true);
  mock.failWrite = false;
  const invalid = copy(mock.values.get(DEMO_KEY));
  invalid.notes[0].viewKeys = null;
  mock.values.set(DEMO_KEY, invalid);
  reload();
  assert.equal((await community.enterDemo()).ok, false);
  assert.equal((await community.listNotes()).ok, false);
  assert.deepEqual(mock.values.get(DEMO_KEY), invalid);
});

test('unregistered users complete the demo flow across actual page and service implementations offline', async () => {
  const calls = [], app = { globalData: {} };
  global.getApp = () => app;
  Object.assign(mock, {
    showToast(options) { calls.push(['toast', options.title]); },
    showModal(options) { calls.push(['modal', options]); },
    navigateBack() { calls.push(['back']); },
    navigateTo(options) { calls.push(['navigate', options.url]); },
    switchTab(options) { calls.push(['tab', options.url]); },
    showShareMenu() { calls.push(['share']); }, hideShareMenu() {},
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
    cloud: { init() { throw new Error('cloud unavailable'); }, callFunction() { throw new Error('cloud unavailable'); } }
  });
  function page(name) {
    const file = path.join(__dirname, '../miniprogram/pages', name, 'index.js');
    let definition;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      Page(value) { definition = value; }, wx: mock, getApp: () => app, getCurrentPages: () => [{}, {}],
      require: createRequire(file), setTimeout, clearTimeout,
    });
    return { ...definition, data: copy(definition.data), setData(changes) { Object.assign(this.data, changes); } };
  }
  const auth = page('auth');
  auth.onLoad(); await auth.enterDemo();
  assert.equal(auth.data.error, '');
  assert.equal(community.getUser().isDemo, true);
  const profile = page('profile');
  await profile.onShow();
  assert.equal(profile.data.user.isDemo, true);
  assert.equal(profile.data.stats.notes, 2);
  const notes = page('notes');
  await notes.onShow();
  assert.equal(notes.data.notes.length, 2);
  const editor = page('note-edit');
  await editor.onLoad({ relatedKey: 'course:c1' }); editor.onShow();
  editor.onTitleInput({ detail: { value: '未注册用户的观察' } });
  editor.onBodyInput({ detail: { value: '叶片的轮廓与颜色。' } });
  editor.chooseVisibility({ currentTarget: { dataset: { visibility: 'public' } } });
  await editor.save();
  assert.equal(editor.data.dirty, false);
  await notes.onShow();
  const saved = notes.data.notes.find(note => note.title === '未注册用户的观察');
  assert.equal(saved.visibility, 'public');
  const reader = page('note-view');
  reader.onLoad({ id: saved.id }); await reader.onShow();
  await reader.react({ currentTarget: { dataset: { action: 'like' } } });
  await reader.react({ currentTarget: { dataset: { action: 'favorite' } } });
  assert.equal(reader.data.note.likeCount, 1);
  assert.equal(reader.data.note.favoriteCount, 1);
  assert.equal(reader.onShareAppMessage().path, '/pages/auth/index');
  assert.equal(calls.filter(call => call[0] === 'share').length, 0);
  const sample = page('note-view');
  sample.onLoad({ id: 'demo-editor-observation' }); await sample.onShow();
  assert.equal(sample.data.note.viewCount, 1);
  assert.equal(sample.data.note.mine, false);
  store.toggleFavorite('herb:h1'); store.completeChapter('c1', 'c1-1');
  const editProfile = page('profile-edit');
  editProfile.onLoad();
  assert.equal(editProfile.data.demoMode, true);
  editProfile.onInput({ currentTarget: { dataset: { field: 'username' } }, detail: { value: '演示学习者' } });
  editProfile.chooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/avatar.jpg' } });
  await editProfile.save();
  assert.equal(editProfile.data.error, '');
  await profile.onShow();
  assert.equal(profile.data.user.username, '演示学习者');
  assert.equal(profile.data.user.avatarUrl, 'wxfile://saved/avatar.jpg');
  assert.equal(profile.data.stats.notes, 3);
  assert.equal(profile.data.stats.favorites, 1);
  assert.equal(profile.data.learningItems.length, 1);
  assert.equal(profile.data.cloudStats.likes, 1);
  assert.equal(profile.data.cloudStats.savedNotes, 1);
  profile.logout();
  await calls.find(call => call[0] === 'modal')[1].success({ confirm: true });
  assert.equal(profile.data.user, null);
  assert.equal(profile.data.stats.notes, 0);
  await profile.enterDemo();
  assert.equal(profile.data.stats.notes, 3);
  assert.equal(profile.data.user.username, '演示学习者');
  reload();
  assert.equal((await community.getNote(saved.id)).note.author.username, '演示学习者');
});
