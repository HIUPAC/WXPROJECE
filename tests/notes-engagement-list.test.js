const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../miniprogram/data/catalog');

const copy = value => JSON.parse(JSON.stringify(value));
const note = (id = 'n1', changes = {}) => ({ id, title: '草木观察', body: '叶片与花序的观察记录',
  updatedAt: '2026-10-14T08:00:00.000Z', visibility: 'public', mine: false,
  author: { id: 'author', username: '观察者', avatarText: '观' }, liked: false, favorite: false,
  viewCount: 8, todayViewCount: 2, viewDay: 20740, likeCount: 4, favoriteCount: 3, ...changes });
const event = (id = 'n1', action = 'like', source = 'cloud') => ({ currentTarget: { dataset: { listKey: source + ':' + id, action, id, source } } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function page(options = {}) {
  let definition, user = options.user === undefined ? { id: 'u_A', username: '甲' } : options.user;
  let timerId = 0;
  const calls = [], toasts = [], timers = new Map();
  const guestState = { notes: [{ ...note('same'), source: 'local' }] };
  const accountState = { notes: [{ ...note('same'), title: '账号独立副本', source: 'account-local' }] };
  const store = { getGuestState: () => copy(guestState), getState: () => copy(user ? accountState : guestState),
    isFavorite: () => false, toggleFavorite: item => { calls.push(['official', item.id]); return { ok: true, favorite: true }; } };
  const community = { getUser: () => user,
    listNotes: async args => { calls.push(['list', copy(args)]); return { ok: true, notes: [note()], total: 1, hasMore: false }; },
    toggleLike: async (id, args) => { calls.push(['like', id, copy(args)]); return { ok: true, note: note(id, { liked: args.active, likeCount: 19 }) }; },
    toggleNoteFavorite: async (id, args) => { calls.push(['favorite', id, copy(args)]); return { ok: true, note: note(id, { favorite: args.active, favoriteCount: 27 }) }; },
    ...options.community };
  const navigation = { push: url => calls.push(['open', url]), openAuth: () => calls.push(['login']) };
  const wx = { showToast: args => toasts.push(args.title) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/notes/index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, getApp: () => ({ globalData: {} }), Date,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    require(target) {
      if (target.endsWith('/data/catalog')) return catalog;
      if (target.endsWith('/services/store')) return store;
      if (target.endsWith('/services/community')) return community;
      if (target.endsWith('/services/navigation')) return navigation;
      if (target === '../../config') return { serviceMode: 'community' };
      throw new Error('Unexpected dependency: ' + target);
    }
  });
  const p = { ...definition, data: copy(definition.data), setData(delta) { Object.assign(this.data, delta); } };
  p.setData({ scope: options.scope || 'public' });
  return { p, community, store, guestState, accountState, calls, toasts, timers,
    setUser(next) { user = next; }, async search() { const [id, callback] = [...timers][0]; timers.delete(id); await callback(); } };
}

test('community rows retain active states and valid statistics without recording a list view', async () => {
  const session = page({ community: { listNotes: async () => ({ ok: true, notes: [note('n1', { liked: true, favorite: true }),
    note('n2', { likeCount: -3, favoriteCount: Infinity, todayViewCount: -1 })], total: 2 }) } });
  await session.p.refresh();
  assert.equal(session.p.data.notes[0].liked, true);
  assert.equal(session.p.data.notes[0].favorite, true);
  assert.equal(session.p.data.notes[0].todayViewCount, 2);
  assert.equal(session.p.data.notes[0].body, undefined);
  assert.equal(session.p.data.notes[1].likeCount, 0);
  assert.equal(session.p.data.notes[1].favoriteCount, 0);
  assert.equal(session.p.data.notes[1].todayViewCount, null);
  assert.deepEqual(session.calls, []);
});

test('local and account notebooks keep separate IDs and never manufacture interactions or statistics', async () => {
  const { p, calls } = page({ scope: 'local' });
  await p.refresh();
  assert.equal(p.data.notes.length, 2);
  assert.notEqual(p.data.notes[0].listKey, p.data.notes[1].listKey);
  for (const entry of p.data.notes) {
    assert.equal(entry.liked, false); assert.equal(entry.favorite, false);
    assert.equal(entry.viewCount, 0); assert.equal(entry.likeCount, 0); assert.equal(entry.favoriteCount, 0);
    await p.react(event(entry.id, 'like', entry.source));
  }
  assert.deepEqual(calls, []);
});

test('quick actions submit an explicit target and display the server count without optimistic arithmetic', async () => {
  const { p, calls, toasts } = page();
  await p.refresh();
  await p.react(event());
  assert.deepEqual(calls.find(call => call[0] === 'like'), ['like', 'n1', { active: true }]);
  assert.equal(p.data.notes[0].liked, true); assert.equal(p.data.notes[0].likeCount, 19);
  await p.react(event('n1', 'favorite'));
  assert.deepEqual(calls.find(call => call[0] === 'favorite'), ['favorite', 'n1', { active: true }]);
  assert.equal(p.data.notes[0].favoriteCount, 27);
  assert.ok(!calls.some(call => call[0] === 'open'));
  assert.deepEqual(toasts, ['已点赞', '已收藏笔记']);
});

test('one pending card operation blocks repeated taps and failures leave counts unchanged and allow retry', async () => {
  const { p, community, toasts } = page();
  await p.refresh();
  const pending = deferred(); let attempts = 0;
  community.toggleLike = () => { attempts += 1; return pending.promise; };
  community.toggleNoteFavorite = () => { attempts += 100; };
  const action = p.react(event());
  await p.react(event()); await p.react(event('n1', 'favorite'));
  assert.equal(attempts, 1); assert.equal(p.data.notes[0].actionLoading, 'like');
  assert.equal(p.data.notes[0].liked, false); assert.equal(p.data.notes[0].likeCount, 4);
  pending.resolve({ ok: false, error: '网络失败' }); await action;
  assert.equal(p.data.notes[0].actionLoading, ''); assert.equal(p.data.notes[0].likeCount, 4);
  assert.deepEqual(toasts, ['网络失败']);
  community.toggleLike = async () => ({ ok: true, note: note('n1', { liked: true, likeCount: 5 }) });
  await p.react(event()); assert.equal(p.data.notes[0].liked, true);
});

test('favorite cancellation removes the card and adjusts the next server offset instead of skipping a note', async () => {
  const { p, community, calls } = page({ scope: 'favorites' });
  community.listNotes = async args => {
    calls.push(['list', copy(args)]);
    return args.offset === 0 ? { ok: true, notes: [note('n1', { favorite: true }), note('n2', { favorite: true })], total: 4, hasMore: true }
      : { ok: true, notes: [note('n3', { favorite: true }), note('n4', { favorite: true })], total: 3, hasMore: false };
  };
  community.toggleNoteFavorite = async (id, args) => { calls.push(['favorite', id, args]); return { ok: true, note: note(id, { favorite: false }) }; };
  await p.refresh(); await p.react(event('n1', 'favorite'));
  assert.equal(p.data.total, 3); assert.deepEqual(Array.from(p.data.notes, item => item.id), ['n2']);
  assert.equal(calls.find(call => call[0] === 'favorite')[2].active, false);
  await p.loadMore();
  assert.equal(calls.filter(call => call[0] === 'list')[1][1].offset, 1);
  assert.deepEqual(Array.from(p.data.notes, item => item.id), ['n2', 'n3', 'n4']);
});

test('liked cancellation updates the collection total and stops pagination when the collection becomes empty', async () => {
  const { p, community } = page({ scope: 'liked', community: {
    listNotes: async () => ({ ok: true, notes: [note('n1', { liked: true })], total: 1, hasMore: false }) } });
  community.toggleLike = async () => ({ ok: true, note: note('n1') });
  await p.refresh(); await p.react(event());
  assert.equal(p.data.total, 0); assert.equal(p.data.notes.length, 0); assert.equal(p.data.hasMore, false);
});

test('overlapping cloud pages are deduplicated while pagination advances by the raw server page length', async () => {
  const { p, community, calls } = page();
  const pages = [[note('n1'), note('n2')], [note('n2'), note('n3')], [note('n4')]];
  community.listNotes = async args => { calls.push(['list', copy(args)]); const notes = pages.shift(); return { ok: true, notes, total: 4, hasMore: pages.length > 0 }; };
  await p.refresh(); await p.loadMore(); await p.loadMore();
  assert.deepEqual(calls.map(call => call[1].offset), [0, 2, 4]);
  assert.deepEqual(Array.from(p.data.notes, item => item.id), ['n1', 'n2', 'n3', 'n4']);
  assert.equal(p.data.hasMore, false);
});

test('an append snapshot started before a successful quick action cannot undo that action', async () => {
  const { p, community } = page();
  community.listNotes = async () => ({ ok: true, notes: [note()], total: 2, hasMore: true });
  await p.refresh();
  const response = deferred(); community.listNotes = () => response.promise;
  const append = p.loadMore(); await p.react(event());
  response.resolve({ ok: true, notes: [note('n1'), note('n2')], total: 2, hasMore: false }); await append;
  assert.equal(p.data.notes[0].liked, true); assert.equal(p.data.notes[0].likeCount, 19);
  assert.equal(p.data.notes.length, 2); assert.equal(p.data.loading, false);
});

test('cancelling a collection item reissues an in-flight page at its new offset and ignores its old reply', async () => {
  const { p, community, calls } = page({ scope: 'favorites' });
  community.listNotes = async () => ({ ok: true, notes: [note('n1', { favorite: true })], total: 3, hasMore: true });
  community.toggleNoteFavorite = async () => ({ ok: true, note: note() });
  await p.refresh();
  const old = deferred(), fresh = deferred(); let attempts = 0;
  community.listNotes = args => { calls.push(['list', copy(args)]); return ++attempts === 1 ? old.promise : fresh.promise; };
  const append = p.loadMore(), action = p.react(event('n1', 'favorite'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.filter(call => call[0] === 'list').map(call => call[1].offset), [1, 0]);
  old.resolve({ ok: true, notes: [note('n1', { favorite: true })], total: 3, hasMore: false }); await append;
  assert.equal(p.data.loading, true); assert.equal(p.data.notes.length, 0);
  fresh.resolve({ ok: true, notes: [note('n2', { favorite: true }), note('n3', { favorite: true })], total: 2, hasMore: false }); await action;
  assert.deepEqual(Array.from(p.data.notes, item => item.id), ['n2', 'n3']);
});

test('late reactions after switching to a local notebook do not update local rows or show success', async () => {
  const { p, community, toasts } = page(); await p.refresh();
  const response = deferred(); community.toggleLike = () => response.promise;
  const action = p.react(event());
  p.setData({ scope: 'local' }); await p.refresh();
  response.resolve({ ok: true, note: note('n1', { liked: true }) }); await action;
  assert.equal(p.data.notes[0].source, 'account-local'); assert.equal(p.data.notes[0].liked, false);
  assert.deepEqual(toasts, []);
});

test('an old hidden-page reply cannot release or overwrite a newer pending reaction', async () => {
  const { p, community, toasts } = page(); await p.onShow();
  const old = deferred(), fresh = deferred(); let attempts = 0;
  community.toggleLike = () => ++attempts === 1 ? old.promise : fresh.promise;
  const first = p.react(event()); p.onHide(); await p.onShow();
  const second = p.react(event());
  old.resolve({ ok: false, error: '旧错误' }); await first;
  assert.equal(p.data.notes[0].actionLoading, 'like'); assert.deepEqual(toasts, []);
  fresh.resolve({ ok: true, note: note('n1', { liked: true, likeCount: 9 }) }); await second;
  assert.equal(p.data.notes[0].actionLoading, ''); assert.equal(p.data.notes[0].likeCount, 9);
});

test('account changes before a card tap cannot send another account a target from the old account', async () => {
  const { p, setUser, calls } = page(); await p.refresh();
  setUser({ id: 'u_B', username: '乙' }); await p.react(event());
  assert.ok(!calls.some(call => call[0] === 'like'));
  assert.equal(p.data.notes.length, 0); assert.equal(p.data.user.id, 'u_B'); assert.match(p.data.error, /账号/);
});

test('expiration during a quick action clears private collection rows and discards its acknowledgement', async () => {
  const { p, community, setUser, toasts } = page({ scope: 'liked', community: {
    listNotes: async () => ({ ok: true, notes: [note('n1', { liked: true })], total: 1 }) } });
  await p.refresh();
  community.toggleLike = async () => { setUser(null); return { ok: false, error: '请重新登录', code: 'AUTH_REQUIRED' }; };
  await p.react(event());
  assert.equal(p.data.notes.length, 0); assert.equal(p.data.needsLogin, true); assert.equal(p.data.loading, false);
  assert.equal(p.data.user, null); assert.deepEqual(toasts, []);
});

test('guest card actions open authentication without mutating community counts', async () => {
  const { p, calls } = page({ user: null }); await p.refresh(); await p.react(event());
  assert.ok(calls.some(call => call[0] === 'login')); assert.ok(!calls.some(call => call[0] === 'like'));
  assert.equal(p.data.notes[0].likeCount, 4);
});

test('a malformed success response leaves the original card usable and shows a retry message', async () => {
  const { p, community, toasts } = page(); await p.refresh();
  community.toggleLike = async () => ({ ok: true, note: { id: 'n1', liked: true } });
  await p.react(event());
  assert.equal(p.data.notes[0].liked, false); assert.equal(p.data.notes[0].likeCount, 4);
  assert.equal(p.data.notes[0].actionLoading, ''); assert.match(toasts[0], /重试/);
});

test('permission rejection removes an unavailable note and its stale preview from the list', async () => {
  const { p, community, toasts } = page(); await p.refresh();
  community.toggleLike = async () => ({ ok: false, code: 'NOTE_UNAVAILABLE', error: '这条笔记已设为私密' });
  await p.react(event());
  assert.equal(p.data.notes.length, 0); assert.equal(p.data.total, 0); assert.equal(p.data.hasMore, false);
  assert.equal(p.noteUpdates['cloud:n1'].note, null);
  assert.deepEqual(toasts, ['这条笔记已设为私密']);
});

test('a changed visibility returned by the service removes an owned private note from the public feed', async () => {
  const { p, community } = page(); await p.refresh();
  community.toggleLike = async () => ({ ok: true, note: note('n1', { liked: true, visibility: 'private', mine: true }) });
  await p.react(event());
  assert.equal(p.data.notes.length, 0); assert.equal(p.data.total, 0);
});

test('quick action snapshots never lower lifetime views or replace newer-day views with older-day counts', async () => {
  const { p, community } = page(); await p.refresh();
  community.toggleLike = async () => ({ ok: true, note: note('n1', { liked: true, viewCount: 3, viewDay: 20739, todayViewCount: 7 }) });
  await p.react(event());
  assert.equal(p.data.notes[0].viewCount, 8); assert.equal(p.data.notes[0].todayViewCount, 2);
  assert.equal(p.data.notes[0].viewDay, 20740);
});

test('search changes stop the previous loader, guard pagination, and ignore late feed replies', async () => {
  const { p, community, calls, search } = page();
  const old = deferred(); community.listNotes = () => old.promise;
  const first = p.refresh();
  p.searchInput({ detail: { value: '花序' } });
  assert.equal(p.data.loading, false); assert.equal(p.data.searchPending, true);
  p.setData({ hasMore: true }); await p.loadMore();
  old.resolve({ ok: true, notes: [note('old')], total: 1 }); await first;
  assert.equal(p.data.notes.length, 0); assert.equal(p.data.searchPending, true);
  community.listNotes = async args => { calls.push(['search', copy(args)]); return { ok: true, notes: [note('fresh')], total: 1 }; };
  await search();
  assert.equal(calls[0][1].query, '花序'); assert.equal(calls[0][1].offset, 0);
  assert.equal(p.data.notes[0].id, 'fresh'); assert.equal(p.data.loading, false); assert.equal(p.data.searchPending, false);
});

test('hiding the list clears its pending search and loading indicators', async () => {
  const { p, timers } = page(); await p.refresh();
  p.searchInput({ detail: { value: '叶片' } }); p.onHide();
  assert.equal(timers.size, 0); assert.equal(p.data.loading, false); assert.equal(p.data.searchPending, false);
});

test('official article favorites update their local card state without reloading the community feed', async () => {
  const { p, calls } = page(); await p.refresh();
  calls.length = 0;
  const item = p.data.officialPreview[0]; p.toggleFavorite({ detail: { item } });
  assert.equal(p.data.officialPreview[0].favorite, true);
  assert.deepEqual(calls, [['official', item.id]]);
});
