const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../miniprogram/data/catalog');

function page(name, dependencies = {}) {
  let definition;
  const calls = { navigation: [], toasts: [], modals: [], clipboard: [] };
  const app = { globalData: { notesRelatedKey: 'course:old' } };
  const wx = {
    navigateTo(options) { calls.navigation.push(['navigateTo', options.url]); },
    navigateBack(options) { calls.navigation.push(['navigateBack', options.delta]); },
    switchTab(options) { calls.navigation.push(['switchTab', options.url]); },
    showToast(options) { calls.toasts.push(options.title); },
    showModal(options) { calls.modals.push(options); },
    setClipboardData(options) { calls.clipboard.push(options.data); if (options.success) options.success(); },
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, stopPullDownRefresh() {},
  };
  const community = { getUser: () => null, ...dependencies.community };
  const state = { schemaVersion: 1, favorites: [], learning: {}, notes: [] };
  const store = {
    getState: () => state, getStats: () => ({ favorites: 0, notes: 0, learning: 0, completed: 0 }),
    getProgress: () => ({ started: false, finished: false, count: 0, total: 4, percent: 0 }),
    ...dependencies.store,
  };
  const navigation = {
    push(url) { wx.navigateTo({ url }); },
    openAuth(mode) { wx.navigateTo({ url: '/pages/auth/index' + (mode === 'register' ? '?mode=register' : '') }); },
    openNotes(scope = 'public', relatedKey = '') {
      app.globalData.notesScope = scope; app.globalData.notesRelatedKey = relatedKey;
      wx.switchTab({ url: '/pages/notes/index' });
    },
    openLibrary(kind = 'all') {
      app.globalData.libraryFilter = kind; app.globalData.libraryResetFilters = true;
      wx.switchTab({ url: '/pages/library/index' });
    },
    openDetail(kind, id, options) {
      calls.navigation.push(['openDetail', kind, id, options]);
    },
  };
  const play = dependencies.play || { getSummary: () => ({ quizBest: 0, matchBest: 0, observationCount: 0, badgeCount: 0, error: '' }),
    getBackup: () => ({ schemaVersion: 1, quiz: { runs: 0, best: 0, last: null }, match: { runs: 0, bestMoves: 0, lastRunId: '' }, observations: [], openedDays: [] }) };
  const backups = dependencies.backups || {
    createBackup() {
      const game = play.getBackup();
      if (!game) return { ok: false, error: '游学记录读取失败，请重试' };
      const saved = store.getState();
      const own = (community.getUser() || {}).isDemo && community.getDemoNotes ? community.getDemoNotes() : [];
      const notes = saved.notes.concat(own).map(note => Object.fromEntries(['id', 'title', 'body', 'relatedKey', 'createdAt', 'updatedAt', 'visibility'].filter(key => note[key] !== undefined).map(key => [key, note[key]])));
      return { ok: true, backup: { app: '百草源', version: 1, state: { schemaVersion: 1, favorites: saved.favorites, learning: saved.learning, notes, play: game } } };
    },
    importBackup: () => ({ ok: true, message: '备份已恢复' })
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages', name, 'index.js'), 'utf8'), {
    Page(value) { definition = value; }, wx, getApp: () => app,
    getCurrentPages: () => dependencies.pageStack || [{}, {}],
    require(target) {
      if (target.endsWith('/services/community')) return community;
      if (target.endsWith('/services/navigation')) return navigation;
      if (target.endsWith('/services/store')) return store;
      if (target.endsWith('/services/play')) return play;
      if (target.endsWith('/services/backup')) return backups;
      if (target === '../../config') return { serviceMode: 'community', ...dependencies.config };
      if (target.endsWith('/data/catalog')) return catalog;
      throw new Error('Unexpected dependency: ' + target);
    },
  });
  const instance = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(changes) { Object.assign(this.data, changes); } };
  return { instance, calls, app, community, store, wx, backups };
}

function event(field, value) {
  return { currentTarget: { dataset: { field } }, detail: { value } };
}

test('registration validates confirmation and sends all account fields without confirmation password', async () => {
  const requests = [];
  const { instance: p, calls } = page('auth', { community: {
    register: async input => { requests.push(input); return { ok: true, user: { id: 'u1' } }; },
  } });
  p.onLoad({ mode: 'register' });
  Object.entries({ studentId: ' 20260001 ', phone: ' 13812345678 ', username: ' 林同学 ', password: 'abc12345', confirmPassword: 'abc12346' }).forEach(([field, value]) => p.onInput(event(field, value)));
  await p.submit();
  assert.match(p.data.error, /不一致/);
  assert.equal(requests.length, 0);
  p.onInput(event('confirmPassword', 'abc12345'));
  await p.submit();
  assert.equal(requests.length, 0);
  assert.match(p.data.error, /勾选同意/);
  p.changeAgreement({ detail: { value: ['agree'] } });
  await p.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ studentId: '20260001', phone: '13812345678', username: '林同学', password: 'abc12345' }]);
  assert.equal(p.data.password, '');
  assert.equal(p.data.confirmPassword, '');
  assert.deepEqual(calls.navigation, [['navigateBack', 1]]);
});

test('login accepts a student number or phone, prevents duplicate requests and reports server errors', async () => {
  let finish;
  const requests = [];
  const { instance: p, calls } = page('auth', { community: {
    login: input => { requests.push(input); return new Promise(resolve => { finish = resolve; }); },
  } });
  p.onInput(event('account', ' 20260001 '));
  p.onInput(event('password', ' abc12345 '));
  const pending = p.submit();
  await p.submit();
  assert.equal(requests.length, 1);
  assert.equal(p.data.submitting, true);
  assert.equal(requests[0].account, '20260001');
  assert.equal(requests[0].password, ' abc12345 ');
  finish({ ok: false, error: '学号、手机号或密码错误' });
  await pending;
  assert.match(p.data.error, /密码错误/);
  assert.equal(p.data.submitting, false);
  assert.equal(calls.navigation.length, 0);
  p.onInput(event('account', '13812345678'));
  assert.equal(p.data.error, '');
  const retry = p.submit();
  finish({ ok: true });
  await retry;
  assert.deepEqual(calls.navigation, [['navigateBack', 1]]);
});

test('login entered without a previous page returns to profile and ignores an unloaded page response', async () => {
  const { instance: p, calls } = page('auth', { pageStack: [{}], community: { login: async () => ({ ok: true }) } });
  p.setData({ account: '20260001', password: 'abc12345' });
  await p.submit();
  assert.deepEqual(calls.navigation, [['switchTab', '/pages/profile/index']]);
  let finish;
  const late = page('auth', { community: { login: () => new Promise(resolve => { finish = resolve; }) } });
  late.instance.setData({ account: '20260001', password: 'abc12345' });
  const pending = late.instance.submit();
  late.instance.onUnload();
  finish({ ok: true });
  await pending;
  assert.equal(late.calls.navigation.length, 0);
  assert.equal(late.instance.data.password, '');
});

test('demo profile editing masks account data and persists the chosen image before saving its file ID', async () => {
  const requests = [];
  const user = { id: 'u1', isDemo: true, username: '123林同学', studentId: '20260001', phone: '13812345678', tags: ['草木'], bio: '', avatarUrl: '' };
  const { instance: p, calls } = page('profile-edit', { community: {
    getUser: () => user,
    uploadAvatar: async filePath => { requests.push(['upload', filePath]); return { ok: true, avatarUrl: 'cloud://env/avatar/u1.jpg' }; },
    updateProfile: async input => { requests.push(['save', input]); return { ok: true, user }; },
  } });
  p.onLoad();
  assert.equal(p.data.avatarText, '林');
  assert.equal(p.data.maskedStudentId, '20****01');
  assert.equal(p.data.maskedPhone, '138****5678');
  p.onInput(event('username', '99alice'));
  assert.equal(p.data.avatarText, 'A');
  p.onInput(event('tagsText', '本草，观察员,本草'));
  p.onInput(event('bio', ' 认识草木。 '));
  p.chooseAvatar({ detail: { avatarUrl: 'wxfile://tmp-avatar' } });
  await p.save();
  assert.equal(requests[0][0], 'upload');
  assert.equal(requests[1][0], 'save');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1][1])), { username: '99alice', tags: ['本草', '观察员'], bio: '认识草木。', avatarUrl: 'cloud://env/avatar/u1.jpg' });
  assert.equal(p.data.dirty, false);
  assert.deepEqual(calls.navigation, [['navigateBack', 1]]);
});

test('failed avatar uploads do not save profile or navigate away, and keep a retryable selection', async () => {
  let saves = 0;
  const { instance: p, calls } = page('profile-edit', { community: {
    getUser: () => ({ id: 'u1', isDemo: true, username: '林', tags: [] }),
    uploadAvatar: async () => ({ ok: false, error: '上传失败，请重试' }),
    updateProfile: async () => { saves += 1; return { ok: true }; },
  } });
  p.onLoad();
  p.chooseAvatar({ detail: { avatarUrl: 'wxfile://pending' } });
  await p.save();
  assert.equal(saves, 0);
  assert.match(p.data.error, /上传失败/);
  assert.equal(p.data.pendingAvatar, 'wxfile://pending');
  assert.equal(p.data.saving, false);
  assert.equal(calls.navigation.length, 0);
});

test('profile editing validates tags and prevents changing a different account after a session switch', async () => {
  let user = { id: 'u1', username: '林', tags: [] };
  let saves = 0;
  const { instance: p } = page('profile-edit', { community: { getUser: () => user, updateProfile: async () => { saves += 1; return { ok: true }; } } });
  p.onLoad();
  p.onInput(event('tagsText', '一,二,三,四,五,六,七'));
  await p.save();
  assert.match(p.data.error, /最多填写 6/);
  p.onInput(event('tagsText', '草木'));
  user = { id: 'u2', username: '李', tags: [] };
  await p.save();
  assert.match(p.data.error, /登录状态已变化/);
  assert.equal(saves, 0);
});

test('switching accounts during demo avatar persistence cannot write the old form to the new account', async () => {
  let user = { id: 'u1', isDemo: true, username: '林', tags: [] };
  let finish;
  let saves = 0;
  const { instance: p } = page('profile-edit', { community: {
    getUser: () => user,
    uploadAvatar: () => new Promise(resolve => { finish = resolve; }),
    updateProfile: async () => { saves += 1; return { ok: true }; },
  } });
  p.onLoad();
  p.chooseAvatar({ detail: { avatarUrl: 'wxfile://pending' } });
  const pending = p.save();
  user = { id: 'u2', username: '李', tags: [] };
  finish({ ok: true, avatarUrl: 'cloud://env/avatar/u1.jpg' });
  await pending;
  assert.equal(saves, 0);
  assert.match(p.data.error, /登录状态已变化/);
});

test('an expired profile save preserves edits and offers a login path before retrying', async () => {
  let user = { id: 'u1', username: '林', tags: [] };
  const { instance: p, calls } = page('profile-edit', { community: {
    getUser: () => user,
    updateProfile: async () => { user = null; return { ok: false, code: 'AUTH_REQUIRED', error: '登录已过期' }; },
  } });
  p.onLoad();
  p.onInput(event('bio', '本次还未保存的介绍'));
  await p.save();
  assert.equal(p.data.sessionExpired, true);
  assert.equal(p.data.bio, '本次还未保存的介绍');
  p.openAuth();
  assert.deepEqual(calls.navigation, [['navigateTo', '/pages/auth/index']]);
  user = { id: 'u1', username: '林', tags: [] };
  p.onShow();
  assert.equal(p.data.sessionExpired, false);
  assert.equal(p.data.bio, '本次还未保存的介绍');
});

test('profile reports the account cloud note count while keeping local content collections separate', async () => {
  const { instance: p, app, calls } = page('profile', {
    community: { getUser: () => ({ id: 'u1', username: '9alice', tags: [] }), getStats: async () => ({ ok: true, stats: { notes: 3, publicNotes: 2, privateNotes: 1, views: 23, likes: 5, favorites: 4, likedNotes: 2, savedNotes: 1 } }) },
    store: { getStats: () => ({ favorites: 7, notes: 2, learning: 0, completed: 0 }) },
  });
  await p.onShow();
  assert.equal(p.data.stats.notes, 3);
  assert.equal(p.data.stats.favorites, 7);
  assert.equal(p.data.cloudStats.views, 23);
  assert.equal(p.data.cloudStats.savedNotes, 1);
  assert.equal(p.data.user.avatarText, 'A');
  for (const scope of ['my', 'favorites', 'liked', 'public']) {
    p.openNotes({ currentTarget: { dataset: { scope } } });
    assert.equal(app.globalData.notesScope, scope);
    assert.equal(app.globalData.notesRelatedKey, '');
  }
  assert.equal(calls.navigation.filter(call => call[1] === '/pages/notes/index').length, 4);
});

test('a session expired by the statistics response immediately restores the guest profile', async () => {
  let user = { id: 'u1', username: '林', tags: [] };
  const { instance: p } = page('profile', { community: {
    getUser: () => user,
    getStats: async () => { user = null; return { ok: false, code: 'AUTH_REQUIRED', error: '请重新登录' }; },
  }, store: { getStats: () => ({ favorites: 0, notes: 2, learning: 0, completed: 0 }) } });
  await p.onShow();
  assert.equal(p.data.user, null);
  assert.equal(p.data.stats.notes, 2);
  assert.equal(p.data.cloudStats.notes, 0);
  assert.equal(p.data.statsLoading, false);
});

test('a stale account statistics response cannot overwrite the current account or guest profile', async () => {
  let user = { id: 'u1', username: '林', tags: [] };
  let finish;
  const { instance: p } = page('profile', { community: {
    getUser: () => user,
    getStats: () => new Promise(resolve => { finish = resolve; }),
  } });
  const pending = p.onShow();
  assert.equal(p.data.statsLoading, true);
  user = null;
  await p.onShow();
  finish({ ok: true, stats: { notes: 8, views: 99 } });
  await pending;
  assert.equal(p.data.user, null);
  assert.equal(p.data.cloudStats.views, 0);
  assert.equal(p.data.stats.notes, 0);
  assert.equal(p.data.statsLoading, false);
});

test('guests can open their local notes and public notes, with account prompts for private interactions', async () => {
  const { instance: p, calls, app } = page('profile');
  await p.onShow();
  p.openNotes({ currentTarget: { dataset: { scope: 'favorites' } } });
  assert.deepEqual(calls.navigation[0], ['navigateTo', '/pages/auth/index']);
  p.openNotes();
  assert.equal(app.globalData.notesScope, 'my');
  p.openNotes({ currentTarget: { dataset: { scope: 'public' } } });
  assert.equal(app.globalData.notesScope, 'public');
});

test('backup exports only local learning records and note fields, without account credentials or sessions', () => {
  const { instance: p, calls } = page('profile', { store: {
    getState: () => ({ schemaVersion: 1, favorites: [], learning: {}, session: { token: 'secret-token' }, password: 'secret-password', notes: [{ id: 'n1', title: '草木', body: '记录', relatedKey: '', createdAt: '', updatedAt: '', session: 'note-secret' }] }),
  } });
  p.exportBackup();
  calls.modals[0].success({ confirm: true });
  const backup = JSON.parse(calls.clipboard[0]);
  assert.equal(backup.state.notes.length, 1);
  assert.ok(!calls.clipboard[0].includes('secret'));
  assert.ok(!Object.hasOwn(backup.state, 'session'));
  assert.ok(!Object.hasOwn(backup.state, 'password'));
});

test('demo entry bypasses empty registration fields, blocks repeated taps and returns to the caller', async () => {
  let finish, attempts = 0;
  const { instance: p, calls } = page('auth', { community: {
    enterDemo: () => { attempts += 1; return new Promise(resolve => { finish = resolve; }); },
    login: () => { throw new Error('Demo must not log in to cloud'); },
    register: () => { throw new Error('Demo must not register'); },
  } });
  p.onLoad({ mode: 'register' });
  p.setData({ password: 'unsent-password' });
  const pending = p.enterDemo();
  await p.enterDemo();
  assert.equal(attempts, 1);
  assert.equal(p.data.demoEntering, true);
  finish({ ok: true, user: { id: 'demo-official', isDemo: true } });
  await pending;
  assert.equal(p.data.password, '');
  assert.equal(p.data.submitting, false);
  assert.equal(p.data.demoEntering, false);
  assert.deepEqual(calls.navigation, [['navigateBack', 1]]);
});

test('failed demo entry displays the storage error without leaving the login page', async () => {
  const { instance: p, calls } = page('auth', { community: { enterDemo: async () => ({ ok: false, error: '演示数据保存失败' }) } });
  await p.enterDemo();
  assert.equal(p.data.error, '演示数据保存失败');
  assert.equal(p.data.demoEntering, false);
  assert.equal(calls.navigation.length, 0);
});

test('profile demo entry refreshes profile and statistics, and exports only the users demo notes', async () => {
  let user = null;
  const { instance: p, calls } = page('profile', { community: {
    getUser: () => user,
    enterDemo: async () => { user = { id: 'demo-official', isDemo: true, username: '百草源官方演示', tags: [] }; return { ok: true, user }; },
    getStats: async () => ({ ok: true, stats: { notes: 2, publicNotes: 1, privateNotes: 1 } }),
    getDemoNotes: () => [{ id: 'demo-1', title: '演示观察', body: '叶片', visibility: 'public', relatedKey: 'herb:h1', password: 'excluded-secret' }],
  } });
  await p.enterDemo();
  assert.equal(p.data.user.isDemo, true);
  assert.equal(p.data.stats.notes, 2);
  assert.equal(p.data.demoEntering, false);
  p.exportBackup();
  calls.modals[0].success({ confirm: true });
  const backup = JSON.parse(calls.clipboard[0]);
  assert.equal(backup.state.notes[0].visibility, 'public');
  assert.equal(backup.state.notes[0].title, '演示观察');
  assert.ok(!calls.clipboard[0].includes('secret'));
});

test('profile displays local game progress and includes observation text in a backup without silently losing unreadable data', async () => {
  const saved = { schemaVersion: 1, observations: [{ text: '自己的实际观察', missionId: 'm1', day: 20000 }] };
  const play = { getSummary: () => ({ quizBest: 4, matchBest: 6, observationCount: 1, badgeCount: 3, error: '' }), getBackup: () => saved };
  const { instance: p, calls } = page('profile', { play });
  await p.onShow(); assert.equal(p.data.playSummary.badgeCount, 3);
  p.openPlay(); assert.equal(calls.navigation.at(-1)[1], '/pages/play/index');
  p.exportBackup(); calls.modals[0].success({ confirm: true });
  assert.deepEqual(JSON.parse(calls.clipboard[0]).state.play, saved);
  play.getBackup = () => null; p.exportBackup();
  assert.equal(p.data.exporting, false); assert.equal(calls.modals.length, 2);
  assert.match(calls.modals.at(-1).content, /游学记录读取失败/);
  assert.equal(calls.clipboard.length, 1);
});

test('a cloud account keeps its text avatar and cannot select or upload an image', async () => {
  const saves = [], uploads = [];
  const user = { id: 'real-student', username: '林草', tags: [], avatarUrl: '' };
  const { instance: p } = page('profile-edit', { community: {
    getUser: () => user,
    uploadAvatar: async input => { uploads.push(input); return { ok: true, avatarUrl: 'cloud://unexpected' }; },
    updateProfile: async input => { saves.push(input); return { ok: true }; },
  } });
  p.onLoad();
  assert.equal(p.data.cloudAvatarEnabled, false);
  p.chooseAvatar({ detail: { avatarUrl: 'wxfile://must-not-upload' } });
  assert.equal(p.data.pendingAvatar, '');
  assert.equal(p.data.dirty, false);
  p.onInput(event('username', '竹同学'));
  await p.save();
  assert.equal(p.data.avatarText, '竹');
  assert.equal(uploads.length, 0);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].avatarUrl, '');
});

test('the local edition blocks cloud login and registration but lets a user enter demo without agreeing', async () => {
  const attempts = [];
  const { instance: p, calls } = page('auth', { config: { serviceMode: 'local' }, community: {
    login: async () => { attempts.push('login'); return { ok: true }; },
    register: async () => { attempts.push('register'); return { ok: true }; },
    enterDemo: async () => { attempts.push('demo'); return { ok: true }; },
  } });
  p.setData({ account: '20260001', studentId: '20260001', phone: '13812345678', username: '草木', password: 'abc12345', confirmPassword: 'abc12345', agreed: true });
  await p.submit();
  assert.match(p.data.error, /本机学习版/);
  p.changeMode({ currentTarget: { dataset: { mode: 'register' } } });
  p.setData({ password: 'abc12345', confirmPassword: 'abc12345', agreed: false });
  await p.submit();
  assert.deepEqual(attempts, []);
  assert.match(p.data.error, /注册和登录未开放/);
  await p.enterDemo();
  assert.deepEqual(attempts, ['demo']);
  assert.equal(p.data.submitting, false);
  assert.equal(p.data.agreed, false);
  assert.deepEqual(calls.navigation, [['navigateBack', 1]]);
});

test('local edition profile reads account-owned local statistics without a cloud request', async () => {
  let requests = 0;
  const { instance: p } = page('profile', { config: { serviceMode: 'local' }, community: {
    getUser: () => ({ id: 'real-student', username: '草木' }),
    getStats: async () => { requests += 1; return { ok: true, stats: { notes: 99 } }; },
  }, store: { getStats: () => ({ notes: 2, favorites: 3, learning: 0, completed: 0 }) } });
  await p.onShow();
  assert.equal(requests, 0);
  assert.equal(p.data.stats.notes, 2);
  assert.equal(p.data.statsLoading, false);
  assert.equal(p.data.statsError, '');
});

test('account changes during file restore confirmation never reach the importer', () => {
  let user = { id: 'u_A', username: '甲同学' }, picker, read, imports = 0;
  const { instance: p, wx, calls } = page('profile', { community: { getUser: () => user }, backups: {
    importBackup: () => { imports += 1; return { ok: true, message: '不应恢复' }; },
  } });
  wx.chooseMessageFile = options => { picker = options; };
  wx.getFileSystemManager = () => ({ readFile: options => { read = options; } });
  p.chooseBackupFile();
  assert.equal(p.data.restoring, true);
  picker.success({ tempFiles: [{ path: 'wxfile://backup.json', size: 512 }] });
  read.success({ data: '{"backup":"for-account-a"}' });
  const confirm = calls.modals.at(-1);
  assert.match(confirm.content, /甲同学/);
  user = { id: 'u_B', username: '乙同学' };
  confirm.success({ confirm: true });
  assert.equal(imports, 0);
  assert.equal(p.data.restoring, false);
  assert.match(calls.modals.at(-1).content, /账号已变化/);
});

test('a late clipboard reply after switching account does not offer to import the previous account backup', () => {
  let user = { id: 'u_A', username: '甲同学' }, clipboard, imports = 0;
  const { instance: p, wx, calls } = page('profile', { community: { getUser: () => user }, backups: {
    importBackup: () => { imports += 1; return { ok: true, message: '不应恢复' }; },
  } });
  wx.getClipboardData = options => { clipboard = options; };
  p.restoreFromClipboard();
  user = null;
  clipboard.success({ data: '{"backup":"for-account-a"}' });
  assert.equal(imports, 0);
  assert.equal(p.data.restoring, false);
  assert.equal(calls.modals.length, 1);
  assert.match(calls.modals[0].content, /账号已变化/);
});

test('opening a course from profile resumes unfinished content and starts a completed course review without resuming', () => {
  const { instance: p, calls, store } = page('profile', { store: {
    getProgress: () => ({ started: true, finished: false, count: 1, total: 4, percent: 25 }),
  } });
  p.openCourse({ currentTarget: { dataset: { id: 'c1' } } });
  const unfinished = calls.navigation.at(-1);
  assert.equal(unfinished[0], 'openDetail');
  assert.equal(unfinished[1], 'course');
  assert.equal(unfinished[2], 'c1');
  assert.equal(unfinished[3].resume, true);
  store.getProgress = () => ({ started: true, finished: true, count: 4, total: 4, percent: 100 });
  p.openCourse({ currentTarget: { dataset: { id: 'c1' } } });
  assert.equal(calls.navigation.at(-1)[3].resume, false);
});

test('protocol pages cannot open during a pending account submission', async () => {
  let finish;
  const { instance: p, calls } = page('auth', { community: { login: () => new Promise(resolve => { finish = resolve; }) } });
  p.setData({ account: '20260001', password: 'abc12345' });
  const pending = p.submit();
  p.openLegal({ currentTarget: { dataset: { type: 'privacy' } } });
  assert.equal(calls.navigation.length, 0);
  finish({ ok: false, error: '重试' }); await pending;
  p.openLegal({ currentTarget: { dataset: { type: 'privacy' } } });
  assert.deepEqual(calls.navigation, [['navigateTo', '/pages/legal/index?type=privacy']]);
});
