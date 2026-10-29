const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../miniprogram/data/catalog');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
const localNote = { id: 'note-local', title: '菊花观察', body: '花瓣与花心。\n叶片细节。', relatedKey: 'herb:h1',
  createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' };
const cloudNote = { ...localNote, id: 'n_cloud', visibility: 'public', mine: true, liked: false, favorite: false,
  author: { id: 'u_A', username: '林草', avatarText: '林', tags: [], bio: '' }, viewCount: 3, likeCount: 2, favoriteCount: 1 };
function page(name, signedIn = false, dependencies = {}) {
  let definition, currentUser = signedIn ? { id: 'u_A', username: '林草' } : null;
  const app = dependencies.app || { globalData: {} }, values = new Map(), calls = dependencies.calls || [], toasts = dependencies.toasts || [];
  const wx = { getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, clone(value)),
    removeStorageSync: key => values.delete(key), showModal: options => { calls.push(['modal', options]); },
    showToast: options => toasts.push(options.title), navigateTo: options => calls.push(['navigate', options.url]),
    navigateBack: () => calls.push(['back']), switchTab: options => calls.push(['tab', options.url]),
    redirectTo: options => calls.push(['redirect', options.url]),
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, showShareMenu() {}, hideShareMenu() {}, ...dependencies.wx };
  const guestState = { schemaVersion: 1, favorites: [], learning: {}, notes: [clone(localNote)] };
  const accountState = { schemaVersion: 1, favorites: [], learning: {}, notes: [] };
  const store = { getState: () => clone(currentUser ? accountState : guestState), getGuestState: () => clone(guestState),
    getGuestNote: id => clone(guestState.notes.find(note => note.id === id) || null),
    saveNote: input => { calls.push(['localSave', clone(input)]); return { ok: true, note: { ...input, id: input.id || 'new-local' } }; },
    deleteNote: id => { calls.push(['localDelete', id]); return { ok: true }; },
    isFavorite: () => false, toggleFavorite: () => ({ ok: true, favorite: true }), ...dependencies.store };
  const community = { getUser: () => currentUser,
    listNotes: async options => { calls.push(['list', clone(options)]); return { ok: true, notes: [clone(cloudNote)], total: 1, hasMore: false }; },
    getNote: async (id, options) => { calls.push(['get', id, clone(options)]); return { ok: true, note: clone(cloudNote) }; },
    recordNoteView: async (id, options) => { calls.push(['view', id, clone(options)]); return { ok: true, view: { reason: 'COUNTED', viewCount: 4, todayViewCount: 1, day: Math.floor((Date.now() + 8 * 3600000) / 86400000) } }; },
    saveNote: async input => { calls.push(['cloudSave', clone(input)]); return { ok: true, note: { ...cloudNote, ...input } }; },
    deleteNote: async id => { calls.push(['cloudDelete', id]); return { ok: true }; },
    toggleLike: async id => { calls.push(['like', id]); return { ok: true, note: { ...clone(cloudNote), liked: true, likeCount: 3 } }; },
    toggleNoteFavorite: async id => { calls.push(['favorite', id]); return { ok: true, note: { ...clone(cloudNote), favorite: true, favoriteCount: 2 } }; },
    reportNote: async (id, reason) => { calls.push(['report', id, reason]); return { ok: true }; }, ...dependencies.community };
  const navigation = { push: url => wx.navigateTo({ url }), openAuth: () => wx.navigateTo({ url: '/pages/auth/index' }),
    openDetail: (kind, id) => wx.navigateTo({ url: catalog.itemPath(catalog.findItem(kind, id)) }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages', name, 'index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => app, setTimeout, clearTimeout, Date,
    require(target) {
      if (target.endsWith('/data/catalog')) return catalog;
      if (target.endsWith('/services/store')) return store;
      if (target.endsWith('/services/community')) return community;
      if (target.endsWith('/services/navigation')) return navigation;
      if (target === '../../config') return { serviceMode: 'community', ...dependencies.config };
      throw new Error('Unexpected dependency ' + target);
    }
  });
  const p = { ...definition, data: clone(definition.data), setData(delta) {
    for (const [key, value] of Object.entries(delta)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = this.data;
      for (const part of parts.slice(0, -1)) target = target[part];
      target[parts.at(-1)] = value;
    }
  } };
  return { p, community, store, guestState, accountState, app, wx, values, calls, toasts, setUser: user => { currentUser = user; } };
}
const event = data => ({ currentTarget: { dataset: data } });

test('guest personal notes remain local and public notes use the shared service with related filters', async () => {
  const { p, app, calls } = page('notes');
  await p.onShow();
  assert.equal(p.data.notes[0].source, 'local');
  assert.equal(calls.length, 0);
  app.globalData.notesScope = 'public'; app.globalData.notesRelatedKey = 'herb:h1';
  await p.onShow();
  assert.equal(p.data.relatedTitle, catalog.findItem('herb', 'h1').title);
  assert.deepEqual(calls.find(call => call[0] === 'list')[1], { scope: 'public', offset: 0, limit: 20, relatedKey: 'herb:h1', query: '' });
  assert.equal(p.data.notes[0].source, 'cloud');
  assert.equal(p.data.notes[0].body, undefined);
});
test('a shared community list opens public notes instead of inheriting the default personal scope', async () => {
  const { p, app } = page('notes');
  app.globalData.notesScope = 'my';
  p.onLoad({ scope: 'public' }); await p.onShow();
  assert.equal(p.data.scope, 'public'); assert.equal(p.data.notes[0].source, 'cloud');
  assert.equal(p.onShareAppMessage().path, '/pages/notes/index?scope=public');
});
test('cloud personal notes and old device notes stay separate, and unauthenticated collections prompt login', async () => {
  const { p, app, calls, setUser } = page('notes', true);
  await p.onShow(); assert.equal(p.data.notes[0].id, 'n_cloud');
  app.globalData.notesScope = 'local'; await p.onShow(); assert.equal(p.data.notes[0].id, localNote.id);
  setUser(null); app.globalData.notesScope = 'favorites'; await p.onShow();
  assert.equal(p.data.needsLogin, true); assert.equal(p.data.notes.length, 0);
  assert.equal(calls.filter(call => call[0] === 'list').length, 1);
});
test('a late feed cannot replace a newly selected local tab', async () => {
  const { p, community } = page('notes', true);
  let done; community.listNotes = () => new Promise(resolve => { done = resolve; });
  p.setData({ scope: 'public' }); const pending = p.refresh();
  p.setData({ scope: 'local' }); await p.refresh();
  done({ ok: true, notes: [cloudNote], total: 1 }); await pending;
  assert.equal(p.data.notes[0].id, localNote.id); assert.equal(p.data.loading, false);
});
test('session expiration clears the feed and ends its pending loader', async () => {
  const { p, community, setUser } = page('notes', true);
  community.listNotes = async () => { setUser(null); return { ok: false, code: 'AUTH_REQUIRED', error: '请重新登录' }; };
  await p.onShow();
  assert.equal(p.data.loading, false); assert.equal(p.data.user, null); assert.equal(p.data.needsLogin, true);
});
test('detail records a reading once per page and does not recount after returning from editing', async () => {
  const { p, calls, community } = page('note-view', true);
  community.getNote = async (id, options) => { calls.push(['get', id, clone(options)]); return { ok: true, note: { ...clone(cloudNote), mine: false } }; };
  p.onLoad({ id: 'n_cloud' }); await p.onShow(); await p.onShow();
  const reads = calls.filter(call => call[0] === 'get');
  assert.ok(reads.every(call => call[2].view === false));
  assert.equal(calls.filter(call => call[0] === 'view').length, 1);
  assert.equal(calls.find(call => call[0] === 'view')[2].viewKey, p.viewKey);
  assert.equal(p.onShareAppMessage().path, '/pages/note-view/index?id=n_cloud');
  p.renderNote({ ...cloudNote, visibility: 'private' });
  assert.equal(p.onShareAppMessage().path, '/pages/notes/index');
});
test('a failed view write leaves the content readable and retries with the same receipt key', async () => {
  const { p, community, calls } = page('note-view');
  community.getNote = async () => ({ ok: true, note: { ...clone(cloudNote), mine: false } });
  const keys = [];
  community.recordNoteView = async (id, options) => {
    assert.equal(p.data.loading, false);
    assert.equal(p.data.note.body, cloudNote.body);
    keys.push(options.viewKey);
    return keys.length === 1 ? { ok: false, error: '浏览保存失败' } : { ok: true, view: { reason: 'COUNTED', viewCount: 4, todayViewCount: 1, day: 20000 } };
  };
  p.onLoad({ id: 'n_cloud' }); await p.onShow();
  assert.equal(p.data.note.viewCount, 3);
  assert.equal(p.data.error, '');
  assert.equal(p.data.viewError, '浏览保存失败');
  assert.equal(p.data.viewRecording, false);
  await p.retryView();
  assert.equal(keys[0], keys[1]);
  assert.equal(p.data.note.viewCount, 4);
  assert.equal(p.data.note.todayViewCount, 1);
  assert.equal(p.data.viewError, '');
  assert.equal(p.data.viewFeedback, '本次浏览已记录');
  assert.equal(calls.length, 0);
});
test('author and hidden pages submit no view, while a failed initial load never triggers statistics', async () => {
  const own = page('note-view', true);
  own.p.onLoad({ id: 'n_cloud' }); await own.p.onShow();
  assert.equal(own.calls.filter(call => call[0] === 'view').length, 0);
  assert.match(own.p.data.viewFeedback, /作者本人/);
  const hidden = page('note-view');
  hidden.community.getNote = async () => ({ ok: true, note: { ...clone(cloudNote), mine: false } });
  let rendered, renderReady;
  const rendering = new Promise(resolve => { renderReady = resolve; });
  hidden.wx.nextTick = callback => { rendered = callback; renderReady(); };
  hidden.p.onLoad({ id: 'n_cloud' });
  const pending = hidden.p.onShow();
  await rendering;
  hidden.p.onHide(); rendered(); await pending;
  assert.equal(hidden.calls.filter(call => call[0] === 'view').length, 0);
  const failed = page('note-view');
  failed.community.getNote = async () => ({ ok: false, error: '读取失败' });
  failed.p.onLoad({ id: 'n_cloud' }); await failed.p.onShow();
  assert.equal(failed.p.data.note, null);
  assert.equal(failed.calls.filter(call => call[0] === 'view').length, 0);
});
test('the same detail page gets a fresh view key after Beijing midnight', async t => {
  const originalNow = Date.now;
  t.after(() => { Date.now = originalNow; });
  let timestamp = Date.parse('2026-10-09T15:59:59.999Z');
  Date.now = () => timestamp;
  const { p, calls, community, wx } = page('note-view');
  community.getNote = async () => ({ ok: true, note: { ...clone(cloudNote), mine: false } });
  let refreshes = 0;
  wx.stopPullDownRefresh = () => { refreshes += 1; };
  p.onLoad({ id: 'n_cloud' }); await p.onShow();
  await p.onPullDownRefresh();
  assert.equal(calls.filter(call => call[0] === 'view').length, 1);
  timestamp += 1;
  await p.onPullDownRefresh();
  const views = calls.filter(call => call[0] === 'view');
  assert.equal(views.length, 2);
  assert.notEqual(views[0][2].viewKey, views[1][2].viewKey);
  assert.equal(refreshes, 2);
});
test('late view replies preserve reactions and stale reaction replies cannot lower view totals', async () => {
  const { p, community } = page('note-view', true);
  const day = Math.floor((Date.now() + 8 * 3600000) / 86400000);
  community.getNote = async () => ({ ok: true, note: { ...clone(cloudNote), mine: false, viewDay: day, todayViewCount: 0 } });
  let finishView, finishLike, viewReady;
  const recording = new Promise(resolve => { viewReady = resolve; });
  community.recordNoteView = () => new Promise(resolve => { finishView = resolve; viewReady(); });
  community.toggleLike = () => new Promise(resolve => { finishLike = resolve; });
  p.onLoad({ id: 'n_cloud' }); const loaded = p.onShow();
  await recording;
  const liked = p.react(event({ action: 'like' }));
  finishView({ ok: true, view: { reason: 'COUNTED', viewCount: 4, todayViewCount: 1, day } });
  await loaded;
  finishLike({ ok: true, note: { ...clone(cloudNote), mine: false, liked: true, likeCount: 3, viewDay: day, todayViewCount: 0 } });
  await liked;
  assert.equal(p.data.note.liked, true);
  assert.equal(p.data.note.likeCount, 3);
  assert.equal(p.data.note.viewCount, 4);
  assert.equal(p.data.note.todayViewCount, 1);
  community.recordNoteView = async () => ({ ok: true, view: { reason: 'ALREADY_VIEWED_TODAY', viewCount: 4, todayViewCount: 1, day } });
  p.viewed = false;
  await p.retryView();
  assert.equal(p.data.note.liked, true);
});
test('a view permission rejection clears the reader and account switches discard a late count', async () => {
  const denied = page('note-view');
  denied.community.getNote = async () => ({ ok: true, note: { ...clone(cloudNote), mine: false } });
  denied.community.recordNoteView = async () => ({ ok: false, code: 'NOTE_UNAVAILABLE', error: '笔记已设为私密' });
  denied.p.onLoad({ id: 'n_cloud' }); await denied.p.onShow();
  assert.equal(denied.p.data.note, null);
  assert.equal(denied.p.data.error, '笔记已设为私密');
  const switched = page('note-view', true);
  switched.community.getNote = async () => ({ ok: true, note: { ...clone(cloudNote), mine: false } });
  let finish, viewReady;
  const recording = new Promise(resolve => { viewReady = resolve; });
  switched.community.recordNoteView = () => new Promise(resolve => { finish = resolve; viewReady(); });
  switched.p.onLoad({ id: 'n_cloud' }); const pending = switched.p.onShow();
  await recording;
  switched.setUser({ id: 'u_B', username: '张' });
  finish({ ok: true, view: { viewCount: 999 } }); await pending;
  assert.equal(switched.p.data.note, null);
  assert.equal(switched.p.data.viewRecording, false);
});
test('demo reader hides public sharing and never shares a device-only note link', async () => {
  const { p, setUser, wx } = page('note-view');
  let shown = 0, hidden = 0;
  wx.showShareMenu = () => { shown += 1; };
  wx.hideShareMenu = () => { hidden += 1; };
  setUser({ id: 'demo-official', username: '百草源官方演示', isDemo: true });
  p.onLoad({ id: 'demo-my-public' }); await p.onShow();
  assert.equal(p.data.demoMode, true);
  assert.equal(shown, 0);
  assert.equal(hidden, 1);
  assert.equal(p.onShareAppMessage().path, '/pages/auth/index');
  setUser({ id: 'real-user', username: '林' });
  assert.equal(p.onShareAppMessage().path, '/pages/auth/index');
});
test('device detail never uploads a note or increments public counts on reading', async () => {
  const { p, calls } = page('note-view', true);
  p.onLoad({ id: localNote.id, source: 'local' }); await p.onShow();
  assert.equal(p.data.note.visibility, 'private'); assert.equal(calls.length, 0);
  p.edit(); assert.match(calls[0][1], /source=local/);
});
test('failed reactions keep counts unchanged, and expired sessions clear the private reader', async () => {
  const { p, community, setUser, toasts } = page('note-view', true);
  p.onLoad({ id: 'n_cloud' }); await p.onShow();
  community.toggleLike = async () => ({ ok: false, error: '网络失败' });
  await p.react(event({ action: 'like' }));
  assert.equal(p.data.note.likeCount, 2); assert.equal(p.data.busy, false); assert.equal(toasts[0], '网络失败');
  community.toggleLike = async () => { setUser(null); return { ok: false, error: '请重新登录' }; };
  await p.react(event({ action: 'like' }));
  assert.equal(p.data.note, null); assert.equal(p.data.busy, false);
});

test('reader reactions submit a stable target on retry and block duplicate taps while saving', async () => {
  const { p, community, toasts } = page('note-view', true);
  p.onLoad({ id: cloudNote.id }); await p.onShow();
  const inputs = [];
  let finish;
  community.toggleLike = (id, options) => { inputs.push({ id, ...options }); return new Promise(resolve => { finish = resolve; }); };
  const first = p.react(event({ action: 'like' }));
  assert.equal(p.data.reactionAction, 'like'); assert.equal(p.data.busy, true);
  await p.react(event({ action: 'like' })); await p.react(event({ action: 'favorite' }));
  assert.equal(inputs.length, 1);
  finish({ ok: false, error: '网络超时' }); await first;
  assert.equal(p.data.reactionError, '网络超时'); assert.equal(p.data.note.liked, false);
  const retry = p.react(event({ action: 'like' }));
  finish({ ok: true, note: { ...clone(cloudNote), liked: true, likeCount: 3 } }); await retry;
  assert.deepEqual(inputs, [{ id: cloudNote.id, active: true }, { id: cloudNote.id, active: true }]);
  assert.equal(p.data.reactionError, ''); assert.equal(p.data.reactionAction, '');
  assert.equal(p.data.note.likeCount, 3); assert.equal(toasts.at(-1), '已点赞');
  const cancel = p.react(event({ action: 'like' }));
  assert.equal(inputs.at(-1).active, false);
  finish({ ok: true, note: clone(cloudNote) }); await cancel;
  assert.equal(p.data.note.liked, false); assert.equal(toasts.at(-1), '已取消点赞');
});

test('an unavailable reaction clears the content and share menu, while malformed replies keep the reader usable', async () => {
  const { p, community, wx } = page('note-view', true);
  let hidden = 0; wx.hideShareMenu = () => { hidden += 1; };
  p.onLoad({ id: cloudNote.id }); await p.onShow();
  community.toggleNoteFavorite = async () => ({ ok: true, note: { ...clone(cloudNote), id: 'wrong-note' } });
  await p.react(event({ action: 'favorite' }));
  assert.equal(p.data.note.id, cloudNote.id); assert.equal(p.data.note.favorite, false);
  assert.match(p.data.reactionError, /重试/);
  community.toggleNoteFavorite = async () => ({ ok: false, code: 'NOTE_UNAVAILABLE', error: '笔记已设为私密' });
  await p.react(event({ action: 'favorite' }));
  assert.equal(p.data.note, null); assert.equal(p.data.paragraphs.length, 0);
  assert.equal(p.data.relatedTitle, ''); assert.equal(p.data.error, '笔记已设为私密');
  assert.equal(hidden, 1);
});

test('a superseded reaction cannot release a newer save or change its state after refresh', async () => {
  const { p, community } = page('note-view', true);
  p.onLoad({ id: cloudNote.id }); await p.onShow();
  let finishOld, finishNew;
  community.toggleLike = () => new Promise(resolve => { finishOld = resolve; });
  community.toggleNoteFavorite = () => new Promise(resolve => { finishNew = resolve; });
  const old = p.react(event({ action: 'like' }));
  await p.load();
  const fresh = p.react(event({ action: 'favorite' }));
  finishOld({ ok: true, note: { ...clone(cloudNote), liked: true, likeCount: 3 } }); await old;
  assert.equal(p.data.busy, true); assert.equal(p.data.reactionAction, 'favorite');
  assert.equal(p.data.note.liked, false);
  finishNew({ ok: true, note: { ...clone(cloudNote), favorite: true, favoriteCount: 2 } }); await fresh;
  assert.equal(p.data.busy, false); assert.equal(p.data.note.favorite, true);
});

test('switching accounts before a tap cannot submit a target derived from the previous account', async () => {
  const { p, setUser, calls } = page('note-view', true);
  p.onLoad({ id: cloudNote.id }); await p.onShow();
  setUser({ id: 'u_B', username: '乙' });
  await p.react(event({ action: 'like' }));
  assert.equal(calls.filter(call => call[0] === 'like').length, 0);
  assert.equal(p.data.note, null); assert.equal(p.data.paragraphs.length, 0);
  assert.match(p.data.error, /账号已改变/);
});

test('a late previous-day view cannot overwrite current-day statistics', async () => {
  const { p, community } = page('note-view');
  community.getNote = async () => ({ ok: true, note: { ...clone(cloudNote), mine: false, viewDay: 20001, todayViewCount: 2 } });
  community.recordNoteView = async () => ({ ok: true, view: { reason: 'COUNTED', day: 20000, viewCount: 4, todayViewCount: 9 } });
  p.onLoad({ id: cloudNote.id }); await p.onShow();
  assert.equal(p.data.note.viewCount, 4);
  assert.equal(p.data.note.viewDay, 20001); assert.equal(p.data.note.todayViewCount, 2);
});

test('a late reaction cannot restore content after a parallel view request revokes access', async () => {
  const { p, community, wx } = page('note-view', true);
  let finishView, finishLike, markRecording, shared = 0;
  const recording = new Promise(resolve => { markRecording = resolve; });
  wx.showShareMenu = () => { shared += 1; };
  community.getNote = async () => ({ ok: true, note: { ...clone(cloudNote), mine: false } });
  community.recordNoteView = () => new Promise(resolve => { finishView = resolve; markRecording(); });
  community.toggleLike = () => new Promise(resolve => { finishLike = resolve; });
  p.onLoad({ id: cloudNote.id });
  const loading = p.onShow(); await recording;
  const liking = p.react(event({ action: 'like' }));
  finishView({ ok: false, code: 'NOTE_UNAVAILABLE', error: '笔记已设为私密' }); await loading;
  assert.equal(p.data.note, null); assert.equal(p.data.busy, false);
  finishLike({ ok: true, note: { ...clone(cloudNote), liked: true, likeCount: 3 } }); await liking;
  assert.equal(p.data.note, null); assert.equal(p.data.paragraphs.length, 0);
  assert.equal(p.data.error, '笔记已设为私密'); assert.equal(shared, 1);
});
test('a guest can save a private note locally with its associated reading', async () => {
  const { p, calls } = page('note-edit');
  await p.onLoad({ relatedKey: 'herb:h1' }); p.onShow();
  assert.equal(p.data.visibility, 'private');
  p.onTitleInput({ detail: { value: '草木' } }); p.onBodyInput({ detail: { value: '叶片观察' } });
  await p.save();
  assert.equal(calls.filter(call => call[0] === 'cloudSave').length, 0);
  assert.equal(calls.find(call => call[0] === 'localSave')[1].relatedKey, 'herb:h1');
});
test('selecting public as a guest retains the form through login and uploads a new cloud note', async () => {
  const { p, calls, setUser, guestState } = page('note-edit');
  await p.onLoad({ id: localNote.id, source: 'local' });
  p.chooseVisibility(event({ visibility: 'public' })); await p.save();
  assert.ok(calls.some(call => call[0] === 'navigate' && call[1] === '/pages/auth/index'));
  assert.ok(!calls.some(call => call[0].endsWith('Save')));
  setUser({ id: 'u_A', username: '林草' }); p.onShow(); await p.save();
  const input = calls.find(call => call[0] === 'cloudSave')[1];
  assert.equal(input.id, undefined); assert.equal(input.title, localNote.title); assert.equal(input.visibility, 'public');
  assert.equal(guestState.notes[0].id, localNote.id);
  assert.ok(calls.some(call => call[0] === 'tab'));
});
test('a guest draft entering demo preserves its content and saves with an honest demo success message', async () => {
  const { p, setUser, calls, toasts } = page('note-edit');
  await p.onLoad({ id: localNote.id, source: 'local' });
  p.chooseVisibility(event({ visibility: 'public' })); await p.save();
  setUser({ id: 'demo-official', username: '百草源官方演示', isDemo: true });
  p.onShow();
  assert.equal(p.data.demoMode, true);
  assert.equal(p.data.title, localNote.title);
  await p.save();
  assert.equal(calls.find(call => call[0] === 'cloudSave')[1].visibility, 'public');
  assert.ok(toasts.includes('演示笔记已保存'));
  assert.ok(!toasts.includes('笔记已公开'));
});
test('a signed-in user explicitly uploading a device note creates a private cloud copy', async () => {
  const { p, calls } = page('note-edit', true);
  await p.onLoad({ id: localNote.id, source: 'local' }); p.onShow(); await p.save();
  const input = calls.find(call => call[0] === 'cloudSave')[1];
  assert.equal(input.id, undefined); assert.equal(input.visibility, 'private');
  assert.ok(!calls.some(call => call[0] === 'localSave' || call[0] === 'localDelete'));
});
test('editor drafts include visibility, remain account-scoped, and survive failed cloud saves', async () => {
  const { p, community, values } = page('note-edit', true);
  await p.onLoad({}); p.onShow();
  p.onTitleInput({ detail: { value: '新观察' } }); p.onBodyInput({ detail: { value: '叶片' } });
  p.chooseVisibility(event({ visibility: 'public' }));
  community.saveNote = async () => ({ ok: false, error: '保存失败' }); await p.save();
  assert.equal(p.data.saving, false); assert.equal(p.data.dirty, true);
  assert.equal(values.get('herb-origin:note-draft:u_A').visibility, 'public');
  assert.equal(values.has('herb-origin:note-draft'), false);
});
test('switching accounts while editing blocks saving and cannot write to the new account', async () => {
  const { p, calls, setUser } = page('note-edit', true);
  await p.onLoad({ id: cloudNote.id, source: 'cloud' });
  p.onTitleInput({ detail: { value: '未保存修改' } });
  setUser({ id: 'u_B', username: '张' }); p.onShow(); await p.save();
  assert.equal(p.data.accountChanged, true);
  assert.ok(!calls.some(call => call[0] === 'cloudSave'));
});

test('an expired session during editor loading ends the spinner and allows the same account to reopen', async () => {
  const { p, community, setUser } = page('note-edit', true);
  community.getNote = async () => { setUser(null); return { ok: false, error: '请重新登录' }; };
  await p.onLoad({ id: cloudNote.id, source: 'cloud' });
  assert.equal(p.data.loading, false); assert.equal(p.data.accountChanged, true);
  community.getNote = async () => ({ ok: true, note: clone(cloudNote) });
  setUser({ id: 'u_A', username: '林草' }); await p.onShow();
  assert.equal(p.data.accountChanged, false); assert.equal(p.data.title, cloudNote.title);
});
test('saving blocks header navigation and retains the creation key for retries and restored drafts', async () => {
  const { p, community, calls, values } = page('note-edit', true);
  await p.onLoad({});
  p.onTitleInput({ detail: { value: '新观察' } }); p.onBodyInput({ detail: { value: '草木' } });
  const key = p.creationKey;
  let done; community.saveNote = input => { calls.push(['attempt', clone(input)]); return new Promise(resolve => { done = resolve; }); };
  const pending = p.save(); p.onBack(); assert.ok(!calls.some(call => call[0] === 'back'));
  done({ ok: false, error: '网络失败' }); await pending;
  assert.equal(values.get('herb-origin:note-draft:u_A').creationKey, key);
  const second = p.save(); done({ ok: false, error: '网络失败' }); await second;
  assert.ok(calls.filter(call => call[0] === 'attempt').every(call => call[1].creationKey === key));
  await p.onLoad({});
  const modal = calls.filter(call => call[0] === 'modal').at(-1)[1];
  modal.success({ confirm: true });
  assert.equal(p.creationKey, key); assert.equal(p.data.title, '新观察');
});
test('switching to editorial featured notes removes a related-content filter that it does not apply', async () => {
  const { p, app } = page('notes');
  app.globalData.notesScope = 'my'; app.globalData.notesRelatedKey = 'herb:h1'; await p.onShow();
  p.switchTab(event({ scope: 'featured' }));
  assert.equal(p.data.relatedKey, ''); assert.equal(p.data.relatedTitle, ''); assert.ok(p.data.featured.length);
});

test('official public content remains visible when community is unavailable and can be searched without login', async () => {
  const { p, community } = page('notes');
  community.listNotes = async () => ({ ok: false, error: '社区服务暂时不可用' });
  p.setData({ scope: 'public' }); await p.refresh();
  assert.match(p.data.error, /不可用/); assert.equal(p.data.total, 0);
  assert.equal(p.data.officialTotal, 12); assert.equal(p.data.officialPreview.length, 3);
  assert.equal(p.data.officialPreview[0].body, undefined);
  p.openOfficialNotes(); assert.equal(p.data.featured.length, 12);
  p.setData({ query: '无香' }); await p.refresh();
  assert.ok(p.data.featured.length > 0 && p.data.featured.length < 12);
  assert.ok(p.data.featured.some(item => item.id === 'n7'));
  assert.equal(p.data.needsLogin, false); assert.equal(p.data.error, '');
});

function seed(app, ownerId, relatedKey = 'course:c7', expiresAt = Date.now() + 10000) {
  app.globalData.noteSeed = { key: 'seed-00001', ownerId, relatedKey, expiresAt, title: '我的观察', body: '日期与对象：\n实际发现：\n待确认问题：' };
  return { seed: 'seed-00001', relatedKey };
}
test('editor consumes a template once, keeps it private and saves the prefilled text as an owned draft', async () => {
  const { p, app, values } = page('note-edit');
  const options = seed(app, 'guest'); await p.onLoad(options);
  assert.equal(p.data.title, '我的观察'); assert.equal(p.data.visibility, 'private'); assert.equal(p.data.relatedKey, 'course:c7');
  assert.equal(p.data.dirty, true); assert.equal(p.data.draftSaved, true); assert.equal(app.globalData.noteSeed, undefined);
  assert.equal(values.get('herb-origin:note-draft').title, '我的观察');
  values.clear(); await p.onLoad(options); assert.equal(p.data.title, '');
});
test('a template cannot read another accounts seed or an expired pending seed', async () => {
  const { p, app, values } = page('note-edit', true);
  await p.onLoad(seed(app, 'guest')); assert.equal(p.data.title, ''); assert.equal(values.size, 0);
  await p.onLoad(seed(app, 'u_A', 'course:c7', Date.now() - 1)); assert.equal(p.data.title, '');
  assert.equal(app.globalData.noteSeed, undefined); assert.equal(p.data.dirty, false);
});
test('entering a template preserves an existing unrelated draft until the user chooses which to edit', async () => {
  const { p, app, values, calls } = page('note-edit');
  const existing = { noteId: '', title: '原有手记', body: '上次尚未保存的内容', relatedKey: 'herb:h1', visibility: 'private', creationKey: 'create-existing' };
  values.set('herb-origin:note-draft', clone(existing)); await p.onLoad(seed(app, 'guest'));
  assert.equal(p.data.title, '我的观察'); assert.equal(calls.filter(call => call[0] === 'modal').length, 1);
  assert.deepEqual(values.get('herb-origin:note-draft'), existing);
  p.onHide(); assert.deepEqual(values.get('herb-origin:note-draft'), existing);
  calls.find(call => call[0] === 'modal')[1].success({ confirm: true });
  assert.equal(p.data.title, '原有手记'); assert.equal(p.data.relatedKey, 'herb:h1'); assert.equal(p.creationKey, 'create-existing');
  p.onHide(); assert.equal(values.get('herb-origin:note-draft').title, '原有手记');
  const another = page('note-edit'); another.values.set('herb-origin:note-draft', clone(existing));
  await another.p.onLoad(seed(another.app, 'guest'));
  another.calls.find(call => call[0] === 'modal')[1].success({ cancel: true });
  assert.equal(another.values.get('herb-origin:note-draft').title, '我的观察');
});
test('a template can continue an edited existing note without discarding its draft or asking twice', async () => {
  const { p, app, values, calls } = page('note-edit', true);
  const draft = { noteId: cloudNote.id, source: 'cloud', title: '修改中的旧笔记', body: '尚未保存的修改', relatedKey: 'herb:h1', visibility: 'private' };
  values.set('herb-origin:note-draft:u_A', clone(draft)); await p.onLoad(seed(app, 'u_A'));
  p.onHide(); assert.deepEqual(values.get('herb-origin:note-draft:u_A'), draft);
  await calls.find(call => call[0] === 'modal')[1].success({ confirm: true });
  assert.equal(p.data.id, cloudNote.id); assert.equal(p.data.title, '修改中的旧笔记'); assert.equal(p.data.visibility, 'private');
  assert.equal(p.data.dirty, true); assert.equal(calls.filter(call => call[0] === 'modal').length, 1);
});

test('a restored account notebook can be listed, read, edited and deleted without uploading or touching the guest copy', async t => {
  const session = page('notes', true);
  const realCommunity = require('../miniprogram/services/community');
  const previousUser = realCommunity.getUser, previousDemo = realCommunity.isDemoMode, previousWx = global.wx;
  realCommunity.getUser = session.community.getUser;
  realCommunity.isDemoMode = () => false;
  global.wx = session.wx;
  t.after(() => { realCommunity.getUser = previousUser; realCommunity.isDemoMode = previousDemo; if (previousWx === undefined) delete global.wx; else global.wx = previousWx; });
  const realStore = require('../miniprogram/services/store');
  const backups = require('../miniprogram/services/backup');
  session.values.set('herb-origin:journal:v1', clone(session.guestState));
  const restoredNote = { ...clone(localNote), title: '恢复的账号手记', source: 'local' };
  const backup = { app: '百草源', format: 'baicaoyuan-local-backup', version: 1, mode: 'account', ownerId: 'u_A', exportedAt: '2026-10-10T00:00:00.000Z',
    state: { schemaVersion: 1, favorites: [], learning: {}, notes: [restoredNote] } };
  const result = backups.importBackup(JSON.stringify(backup));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.summary.notesAdded, 1);
  const shared = { community: session.community, store: realStore, wx: session.wx, app: session.app, calls: session.calls, toasts: session.toasts };
  const list = page('notes', true, shared).p;
  list.onLoad({ scope: 'local' }); await list.onShow();
  assert.equal(list.data.notes.length, 2);
  assert.equal(list.data.notes[0].id, list.data.notes[1].id);
  assert.notEqual(list.data.notes[0].listKey, list.data.notes[1].listKey);
  const accountRow = list.data.notes.find(note => note.source === 'account-local');
  assert.equal(accountRow.title, restoredNote.title);
  list.openNote(event({ id: accountRow.id, source: accountRow.source }));
  assert.match(session.calls.at(-1)[1], /source=account-local/);
  const reader = page('note-view', true, shared).p;
  reader.onLoad({ id: accountRow.id, source: accountRow.source }); await reader.onShow();
  assert.equal(reader.data.note.title, restoredNote.title);
  const editor = page('note-edit', true, shared).p;
  await editor.onLoad({ id: accountRow.id, source: accountRow.source });
  assert.equal(editor.data.visibility, 'private');
  assert.equal(editor.data.importing, false);
  editor.onTitleInput({ detail: { value: '仅修改账号本机副本' } }); await editor.save();
  assert.equal(realStore.getState().notes[0].title, '仅修改账号本机副本');
  assert.equal(session.app.globalData.notesScope, 'local');
  await reader.onShow();
  assert.equal(reader.data.note.title, '仅修改账号本机副本');
  reader.remove();
  await session.calls.filter(call => call[0] === 'modal').at(-1)[1].success({ confirm: true });
  assert.equal(realStore.getState().notes.length, 0);
  assert.equal(realStore.getGuestState().notes[0].title, localNote.title);
  assert.equal(session.calls.filter(call => ['list', 'get', 'cloudSave', 'cloudDelete', 'view', 'like', 'favorite', 'report'].includes(call[0])).length, 0);
});

test('continuing an account-local draft from a new cloud editor restores its original storage scope', async () => {
  const { p, values, calls } = page('note-edit', true);
  values.set('herb-origin:note-draft:u_A', { noteId: '', source: 'account-local', title: '尚未保存的本机手记', body: '不应静默改为云端保存', relatedKey: '', visibility: 'private', creationKey: 'create-owned-local' });
  await p.onLoad({});
  assert.equal(p.data.source, 'cloud');
  const confirm = calls.filter(call => call[0] === 'modal').at(-1)[1];
  await confirm.success({ confirm: true });
  assert.equal(p.data.source, 'account-local');
  assert.equal(p.data.title, '尚未保存的本机手记');
  assert.equal(p.creationKey, 'create-owned-local');
  await p.save();
  assert.equal(calls.filter(call => call[0] === 'cloudSave').length, 0);
  assert.equal(calls.filter(call => call[0] === 'localSave').length, 1);
});

test('an expired account-local reader cannot edit or delete a guest note with the same ID', async () => {
  const { p, accountState, setUser, calls } = page('note-view', true);
  accountState.notes.push({ ...clone(localNote), title: '甲的账号本机笔记' });
  p.onLoad({ id: localNote.id, source: 'account-local' }); await p.onShow();
  assert.equal(p.data.note.title, '甲的账号本机笔记');
  setUser(null);
  p.remove(); p.edit();
  const deletion = calls.find(call => call[0] === 'modal');
  if (deletion && deletion[1].success) await deletion[1].success({ confirm: true });
  assert.equal(calls.filter(call => call[0] === 'localDelete' || call[0] === 'cloudDelete' || call[0] === 'navigate').length, 0);
  assert.equal(p.data.note, null);
  assert.match(p.data.error, /账号|登录/);
});

test('the local edition uses account-owned local notes and blocks public visibility without preventing demo notes', async () => {
  const local = page('note-edit', true, { config: { serviceMode: 'local' } });
  await local.p.onLoad({});
  assert.equal(local.p.data.source, 'account-local');
  local.p.onTitleInput({ detail: { value: '断网也能记录' } });
  local.p.onBodyInput({ detail: { value: '仅本机保存的观察' } });
  local.p.chooseVisibility(event({ visibility: 'public' }));
  assert.equal(local.p.data.visibility, 'private');
  local.p.uploadCopy();
  assert.equal(local.p.data.source, 'account-local');
  await local.p.save();
  assert.equal(local.calls.filter(call => call[0] === 'cloudSave').length, 0);
  assert.equal(local.calls.filter(call => call[0] === 'localSave').length, 1);
  const demo = page('note-edit', true, { config: { serviceMode: 'local' } });
  demo.setUser({ id: 'demo-official', username: '演示', isDemo: true });
  await demo.p.onLoad({});
  demo.p.onTitleInput({ detail: { value: '模拟社区记录' } }); demo.p.onBodyInput({ detail: { value: '只由体验服务保存' } });
  demo.p.chooseVisibility(event({ visibility: 'public' }));
  await demo.p.save();
  assert.equal(demo.p.data.visibility, 'public');
  assert.equal(demo.calls.filter(call => call[0] === 'cloudSave').length, 1);
  assert.ok(demo.toasts.includes('演示笔记已保存'));
});

test('a hidden report reply cannot replace a fresh report after returning to the reader', async () => {
  const { p, community, toasts } = page('note-view', true);
  p.onLoad({ id: cloudNote.id }); await p.onShow();
  let finishOld, finishNew, attempts = 0;
  community.reportNote = () => new Promise(resolve => { attempts += 1; if (attempts === 1) finishOld = resolve; else finishNew = resolve; });
  const old = p.submitReport('privacy');
  assert.equal(p.data.reporting, true);
  p.onHide(); await p.onShow();
  assert.equal(p.data.reporting, false);
  const fresh = p.submitReport('content');
  finishOld({ ok: false, error: '迟到的旧错误' }); await old;
  assert.equal(p.data.reporting, true);
  assert.equal(p.data.reportError, '');
  finishNew({ ok: true }); await fresh;
  assert.equal(p.data.reporting, false);
  assert.equal(p.data.reportError, '');
  assert.deepEqual(toasts, ['已提交，待运营者处理']);
});

test('report choice and pending acknowledgements are discarded when the account changes', async () => {
  const { p, wx, calls, community, setUser, toasts } = page('note-view', true);
  p.onLoad({ id: cloudNote.id }); await p.onShow();
  let sheet;
  wx.showActionSheet = options => { sheet = options; };
  p.reportNote();
  setUser({ id: 'u_B', username: '乙' });
  sheet.success({ tapIndex: 0 });
  assert.equal(calls.filter(call => call[0] === 'report').length, 0);
  await p.onShow();
  let finish;
  community.reportNote = () => new Promise(resolve => { finish = resolve; });
  const pending = p.submitReport('privacy');
  setUser(null); finish({ ok: true }); await pending;
  assert.equal(p.data.reporting, false);
  assert.match(p.data.reportError, /账号或笔记已变化/);
  assert.equal(toasts.length, 0);
});

test('opening a report picker then changing the displayed note cannot report the newly opened note', async () => {
  const { p, wx, calls } = page('note-view', true);
  p.onLoad({ id: cloudNote.id }); await p.onShow();
  let sheet; wx.showActionSheet = options => { sheet = options; };
  p.reportNote();
  p.onLoad({ id: 'another-public-note' }); await p.onShow();
  sheet.success({ tapIndex: 2 });
  assert.equal(calls.filter(call => call[0] === 'report').length, 0);
});

test('switching accounts while a local deletion confirmation is open cannot delete the new account record', async () => {
  const { p, accountState, setUser, calls } = page('note-view', true);
  accountState.notes.push({ ...clone(localNote), title: '甲的本机副本' });
  p.onLoad({ id: localNote.id, source: 'account-local' }); await p.onShow();
  p.remove();
  const confirm = calls.filter(call => call[0] === 'modal').at(-1)[1];
  setUser({ id: 'u_B', username: '乙' });
  await confirm.success({ confirm: true });
  assert.equal(calls.filter(call => call[0] === 'localDelete' || call[0] === 'cloudDelete').length, 0);
  assert.equal(p.data.note, null);
  assert.match(p.data.error, /账号|登录/);
});
