const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../miniprogram/data/catalog');
const navigation = require('../miniprogram/services/navigation');
let app;
let actions;

test.beforeEach(() => {
  app = { globalData: {} };
  actions = [];
  global.getApp = () => app;
  global.wx = {
    navigateTo: options => actions.push({ kind: 'navigateTo', ...options }),
    redirectTo: options => actions.push({ kind: 'redirectTo', ...options }),
    switchTab: options => actions.push({ kind: 'switchTab', ...options }),
    showToast: options => actions.push({ kind: 'toast', ...options })
  };
});
test.after(() => { delete global.getApp; delete global.wx; });

test('library navigation clears previous search and archive filters on explicit entry', () => {
  app.globalData.libraryQuery = '旧搜索';
  navigation.openLibrary('course');
  assert.equal(app.globalData.libraryFilter, 'course');
  assert.equal(app.globalData.libraryQuery, '');
  assert.equal(app.globalData.libraryResetFilters, true);
  assert.equal(actions[0].url, '/pages/library/index');
  assert.equal(actions[0].kind, 'switchTab');
  navigation.openLibrary('unsupported', '字'.repeat(150));
  assert.equal(app.globalData.libraryFilter, 'all');
  assert.equal(app.globalData.libraryQuery.length, 100);
});

test('note navigation clears the old related item and supports every personal scope', () => {
  navigation.openNotes('public', 'herb:h1');
  assert.equal(app.globalData.notesRelatedKey, 'herb:h1');
  for (const scope of ['my', 'public', 'favorites', 'liked', 'local', 'featured']) {
    navigation.openNotes(scope);
    assert.equal(app.globalData.notesScope, scope);
    assert.equal(app.globalData.notesRelatedKey, '');
  }
  assert.ok(actions.every(action => action.kind === 'switchTab' && action.url === '/pages/notes/index'));
});

test('detail and edit navigation validate content and encode note parameters', () => {
  assert.equal(navigation.openDetail('herb', 'missing'), false);
  assert.equal(actions[0].kind, 'toast');
  assert.equal(navigation.openDetail('course', 'c1'), true);
  assert.equal(actions[1].url, '/pages/detail/index?kind=course&id=c1');
  navigation.editNote('note&1', 'herb:h1');
  assert.equal(actions[2].url, '/pages/note-edit/index?id=note%261&relatedKey=herb%3Ah1');
  navigation.openAuth();
  assert.equal(actions[3].url, '/pages/auth/index');
  navigation.openAuth('register');
  assert.equal(actions[4].url, '/pages/auth/index?mode=register');
});

test('a full page stack falls back to redirecting to the requested destination', () => {
  navigation.editNote();
  actions[0].fail();
  assert.equal(actions[1].kind, 'redirectTo');
  assert.equal(actions[1].url, '/pages/note-edit/index');
  actions[1].fail();
  assert.equal(actions[2].kind, 'toast');
});

function pendingNavigationFixture() {
  const calls = [];
  const clock = { now: 1000 };
  const state = { globalData: {} };
  const makeApi = () => ({
    navigateTo: options => calls.push({ method: 'navigateTo', options }),
    redirectTo: options => calls.push({ method: 'redirectTo', options }),
    switchTab: options => calls.push({ method: 'switchTab', options }),
    showToast: options => calls.push({ method: 'showToast', options })
  });
  const context = { module: { exports: {} }, wx: makeApi(), getApp: () => state,
    Date: { now: () => clock.now }, require: () => catalog };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/services/navigation.js'), 'utf8'), context);
  return { navigation: context.module.exports, calls, clock, state, context, makeApi };
}

test('rapid repeated taps dispatch immediately once while the same destination is pending', () => {
  const { navigation: nav, calls, clock } = pendingNavigationFixture();
  nav.push('/pages/play/index?mode=quiz');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.url, '/pages/play/index?mode=quiz');
  nav.push('/pages/play/index?mode=quiz');
  clock.now += 799;
  nav.push('/pages/play/index?mode=quiz');
  assert.equal(calls.length, 1);
  clock.now += 1;
  nav.push('/pages/play/index?mode=quiz');
  assert.equal(calls.length, 2);
});

test('native completion releases a destination immediately for another deliberate visit', () => {
  const { navigation: nav, calls } = pendingNavigationFixture();
  nav.openNotes('my');
  nav.openNotes('my');
  assert.equal(calls.length, 1);
  calls[0].options.complete();
  nav.openNotes('my');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'switchTab');
});

test('failed tab navigation shows feedback and releases the destination for retry', () => {
  const { navigation: nav, calls } = pendingNavigationFixture();
  nav.openLibrary('herb');
  calls[0].options.fail({ errMsg: 'switchTab:fail' });
  assert.equal(calls[1].method, 'showToast');
  nav.openLibrary('herb');
  assert.equal(calls[2].method, 'switchTab');
  assert.equal(calls[2].options.url, '/pages/library/index');
});

test('late completion cannot release a newer pending destination', () => {
  const { navigation: nav, calls } = pendingNavigationFixture();
  nav.push('/pages/auth/index');
  nav.push('/pages/play/index');
  calls[0].options.complete();
  nav.push('/pages/play/index');
  assert.equal(calls.length, 2);
  calls[1].options.complete();
  nav.push('/pages/play/index');
  assert.equal(calls.length, 3);
});

test('coalescing respects the native method and wx instance and retains the latest tab filter', () => {
  const { navigation: nav, calls, state, context, makeApi } = pendingNavigationFixture();
  nav.push('/pages/library/index');
  nav.openLibrary('course');
  assert.deepEqual(calls.map(call => call.method), ['navigateTo', 'switchTab']);
  nav.openLibrary('herb', '菊花');
  assert.equal(calls.length, 2);
  assert.equal(state.globalData.libraryFilter, 'herb');
  assert.equal(state.globalData.libraryQuery, '菊花');
  context.wx = makeApi();
  nav.openLibrary('herb');
  assert.equal(calls.length, 3);
});

test('redirect fallback preserves the destination, releases failures and permits a retry', () => {
  const { navigation: nav, calls } = pendingNavigationFixture();
  const url = '/pages/note-edit/index?relatedKey=course%3Ac1';
  nav.push(url);
  nav.push(url);
  assert.equal(calls.length, 1);
  calls[0].options.fail({ errMsg: 'navigateTo:fail page limit exceeded' });
  assert.equal(calls[1].method, 'redirectTo');
  assert.equal(calls[1].options.url, url);
  calls[0].options.complete();
  calls[1].options.fail({ errMsg: 'redirectTo:fail' });
  assert.equal(calls[2].method, 'showToast');
  nav.push(url);
  assert.equal(calls[3].method, 'navigateTo');
});

test('navigation failures still release retries when redirectTo is unavailable', () => {
  const { navigation: nav, calls, context } = pendingNavigationFixture();
  delete context.wx.redirectTo;
  nav.openAuth();
  calls[0].options.fail();
  assert.equal(calls[1].method, 'showToast');
  nav.openAuth();
  assert.equal(calls[2].method, 'navigateTo');
});

test('templates pass only an expiring account-bound nonce in the editor URL', () => {
  navigation.editNote('', 'course:c7', { ownerId: 'student-甲', title: '观察草稿', body: '个人的实际观察正文，不应进入 URL' });
  assert.match(actions[0].url, /relatedKey=course%3Ac7&seed=seed-/);
  assert.ok(!actions[0].url.includes('实际观察'));
  assert.equal(app.globalData.noteSeed.ownerId, 'student-甲');
  assert.equal(app.globalData.noteSeed.body, '个人的实际观察正文，不应进入 URL');
  assert.ok(app.globalData.noteSeed.expiresAt > Date.now());
  assert.ok(app.globalData.noteSeed.expiresAt <= Date.now() + 5 * 60000);
});

test('related note counts follow the current account and ignore late responses from another account', async () => {
  let definition;
  let user = { id: 'student-a' };
  const requests = [];
  const community = {
    getUser: () => user,
    listNotes(options) {
      return new Promise(resolve => requests.push({ options, resolve }));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/detail/index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx: global.wx,
    require(target) {
      if (target === '../../config') return { serviceMode: 'community' };
      if (target.endsWith('/data/catalog')) return catalog;
      if (target.endsWith('/services/navigation')) return navigation;
      if (target.endsWith('/services/community')) return community;
      if (target.endsWith('/services/reading')) return { remember: () => ({ ok: true }) };
      if (target.endsWith('/services/store')) return {
        isFavorite: () => false,
        getProgress: () => ({ completed: [], count: 0, total: 3, percent: 0, started: false, finished: false }),
        getState: () => ({ notes: [{ relatedKey: 'course:c1' }, { relatedKey: 'herb:h1' }] })
      };
      throw new Error('Unexpected dependency ' + target);
    }
  });
  const p = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(delta) { Object.assign(this.data, delta); } };
  p.onLoad({ kind: 'course', id: 'c1' });
  assert.equal(requests[0].options.relatedKey, 'course:c1');
  assert.equal(requests[0].options.scope, 'public');
  assert.equal(requests[1].options.scope, 'my');
  user = { id: 'student-b' };
  p.onShow();
  requests[2].resolve({ ok: true, total: 8 });
  requests[3].resolve({ ok: true, total: 2 });
  await new Promise(done => setImmediate(done));
  assert.equal(p.data.publicRelatedCount, 8);
  assert.equal(p.data.myRelatedCount, 2);
  requests[0].resolve({ ok: true, total: 100 });
  requests[1].resolve({ ok: true, total: 50 });
  await new Promise(done => setImmediate(done));
  assert.equal(p.data.publicRelatedCount, 8);
  assert.equal(p.data.myRelatedCount, 2);
  p.openMyNotes();
  assert.equal(app.globalData.notesScope, 'my');
  assert.equal(app.globalData.notesRelatedKey, 'course:c1');
  p.onShow();
  user = null;
  requests[4].resolve({ ok: false, code: 'AUTH_REQUIRED' });
  requests[5].resolve({ ok: false, code: 'AUTH_REQUIRED' });
  await new Promise(done => setImmediate(done));
  assert.equal(requests[6].options.scope, 'public');
  requests[6].resolve({ ok: true, total: 7 });
  await new Promise(done => setImmediate(done));
  assert.equal(p.data.myRelatedCount, 1);
  assert.equal(p.data.publicRelatedCount, 7);
  assert.equal(p.data.notesCountLoading, false);
  p.onUnload();
});
