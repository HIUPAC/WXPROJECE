const test = require('node:test');
const assert = require('node:assert/strict');
const { findItem } = require('../miniprogram/data/catalog');
const community = require('../miniprogram/services/community');
const originalGetUser = community.getUser;
const modulePath = require.resolve('../miniprogram/services/store');
let store;
let mock;
let currentUser;

function createStorage() {
  const values = new Map();
  return {
    values,
    calls: [],
    failRead: false,
    failWrite: false,
    getStorageSync(key) {
      if (this.failRead) throw new Error('storage unavailable');
      return values.get(key);
    },
    setStorageSync(key, value) {
      this.calls.push(key);
      if (this.failWrite) throw new Error('quota exceeded');
      // Returning references intentionally catches accidental mutations before writes.
      values.set(key, value);
    }
  };
}

test.beforeEach(() => {
  mock = createStorage();
  currentUser = null;
  community.getUser = () => currentUser;
  global.wx = mock;
  delete require.cache[modulePath];
  store = require(modulePath);
});

test.after(() => {
  community.getUser = originalGetUser;
  delete global.wx;
});

test('favorite toggles use one storage key and survive a module reload', () => {
  const herb = findItem('herb', 'h1');
  assert.deepEqual(store.getState(), { schemaVersion: 1, favorites: [], learning: {}, notes: [] });
  assert.deepEqual(store.toggleFavorite(herb), { ok: true, key: 'herb:h1', favorite: true });
  assert.equal(store.isFavorite('herb:h1'), true);
  assert.deepEqual(mock.calls, ['herb-origin:journal:v1']);
  delete require.cache[modulePath];
  store = require(modulePath);
  assert.equal(store.isFavorite(herb), true);
  assert.deepEqual(store.toggleFavorite('herb:h1'), { ok: true, key: 'herb:h1', favorite: false });
  assert.equal(store.isFavorite(herb), false);
});

test('chapter completions are valid, deduplicated, and persist accurate progress', () => {
  assert.equal(store.completeChapter('c1', 'c2-1').ok, false);
  assert.equal(store.completeChapter('missing', 'c1-1').ok, false);
  assert.equal(store.completeChapter('c1', null).ok, false);
  assert.equal(mock.calls.length, 0);
  assert.equal(store.completeChapter('c1', 'c1-1').ok, true);
  assert.deepEqual(store.getProgress('c1'), { completed: ['c1-1'], count: 1, total: 3, percent: 33, started: true, finished: false });
  const calls = mock.calls.length;
  assert.equal(store.completeChapter('c1', 'c1-1').ok, true);
  assert.equal(mock.calls.length, calls);
  store.completeChapter('c1', 'c1-2');
  store.completeChapter('c1', 'c1-3');
  assert.equal(store.getProgress(findItem('course', 'c1')).percent, 100);
  assert.equal(store.getProgress('c1').finished, true);
  assert.deepEqual(store.getProgress('unknown'), { completed: [], count: 0, total: 0, percent: 0, started: false, finished: false });
  delete require.cache[modulePath];
  store = require(modulePath);
  assert.deepEqual(store.getState().learning, { c1: ['c1-1', 'c1-2', 'c1-3'] });
  assert.deepEqual(store.getStats(), { favorites: 0, notes: 0, learning: 0, completed: 1 });
});

test('notes trim input, save locally, and edits preserve id and creation date', () => {
  const saved = store.saveNote({ title: '  花朵观察  ', body: '  花瓣与花心。\n\n记录日期。  ', relatedKey: 'herb:h1' });
  assert.equal(saved.ok, true);
  assert.equal(saved.note.title, '花朵观察');
  assert.equal(saved.note.body, '花瓣与花心。\n\n记录日期。');
  assert.match(saved.note.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(saved.note.updatedAt, saved.note.createdAt);
  const edited = store.saveNote({ id: saved.note.id, title: '补充观察', body: '新增叶片细节。' });
  assert.equal(edited.ok, true);
  assert.equal(edited.note.id, saved.note.id);
  assert.equal(edited.note.createdAt, saved.note.createdAt);
  assert.equal(edited.note.relatedKey, 'herb:h1');
  assert.equal(store.getState().notes.length, 1);
  assert.equal(store.getNote(saved.note.id).title, '补充观察');
  delete require.cache[modulePath];
  store = require(modulePath);
  assert.equal(store.getNote(saved.note.id).body, '新增叶片细节。');
  assert.deepEqual(store.deleteNote(saved.note.id), { ok: true });
  assert.equal(store.getNote(saved.note.id), null);
  assert.equal(store.deleteNote(saved.note.id).ok, false);
});

test('defensive snapshots cannot change stored favorites, learning, or notes', () => {
  store.toggleFavorite('herb:h1');
  store.completeChapter('c1', 'c1-1');
  const saved = store.saveNote({ title: '观察', body: '内容' });
  const state = store.getState();
  state.favorites.push('herb:h2');
  state.learning.c1.push('c1-2');
  state.notes[0].body = '被修改';
  saved.note.body = '也被修改';
  store.getNote(saved.note.id).title = '外部修改';
  store.getProgress('c1').completed.push('c1-3');
  assert.deepEqual(store.getState().favorites, ['herb:h1']);
  assert.deepEqual(store.getState().learning.c1, ['c1-1']);
  assert.equal(store.getNote(saved.note.id).body, '内容');
  assert.equal(store.getNote(saved.note.id).title, '观察');
});

test('failed writes preserve existing storage and return failure for every mutation', () => {
  store.toggleFavorite('herb:h1');
  store.completeChapter('c1', 'c1-1');
  const saved = store.saveNote({ title: '原笔记', body: '原正文' });
  const before = store.getState();
  mock.failWrite = true;
  [
    store.toggleFavorite('herb:h1'),
    store.completeChapter('c1', 'c1-2'),
    store.saveNote({ title: '新笔记', body: '不能保存' }),
    store.saveNote({ id: saved.note.id, title: '更新', body: '不能保存' }),
    store.deleteNote(saved.note.id)
  ].forEach((result) => {
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });
  assert.deepEqual(store.getState(), before);
});

test('failed reads do not overwrite existing data on a subsequent mutation', () => {
  const saved = store.saveNote({ title: '已有笔记', body: '保留正文' });
  const before = store.getState();
  const writes = mock.calls.length;
  mock.failRead = true;
  assert.deepEqual(store.getState(), { schemaVersion: 1, favorites: [], learning: {}, notes: [] });
  assert.equal(store.toggleFavorite('herb:h2').ok, false);
  assert.equal(store.completeChapter('c2', 'c2-1').ok, false);
  assert.equal(store.saveNote({ title: '新笔记', body: '内容' }).ok, false);
  assert.equal(store.deleteNote(saved.note.id).ok, false);
  assert.equal(mock.calls.length, writes);
  mock.failRead = false;
  assert.deepEqual(store.getState(), before);
});

test('malformed storage is sanitized, deduplicated, and never executes object keys', () => {
  mock.values.set('herb-origin:journal:v1', 'invalid json');
  assert.deepEqual(store.getState(), { schemaVersion: 1, favorites: [], learning: {}, notes: [] });
  mock.values.set('herb-origin:journal:v1', { schemaVersion: 999, favorites: ['herb:h1'] });
  assert.equal(store.getStats().favorites, 0);
  const valid = store.saveNote({ title: '有效笔记', body: '有效正文' }).note;
  mock.values.set('herb-origin:journal:v1', {
    schemaVersion: 1,
    favorites: ['herb:h1', 'herb:h1', 'invalid:h1', null, {}, 'course:c1'],
    learning: { c1: ['c1-1', 'c1-1', 'c2-1', null], c2: 'wrong', missing: ['missing-1'] },
    notes: [valid, valid, null, { id: 'bad', title: '无正文' }, Object.assign({}, valid, { id: 'bad-date', createdAt: 'invalid' })]
  });
  assert.deepEqual(store.getState().favorites, ['herb:h1', 'course:c1']);
  assert.deepEqual(store.getState().learning, { c1: ['c1-1'] });
  assert.deepEqual(store.getState().notes, [valid]);
});

test('invalid favorite and note inputs are rejected without writes', () => {
  [null, '', {}, 'herb:unknown', 'course:c1:extra', { kind: 'herb', id: 'c1' }].forEach((value) => {
    assert.equal(store.isFavorite(value), false);
    assert.equal(store.toggleFavorite(value).ok, false);
  });
  [
    null, {}, { title: '', body: '正文' }, { title: '标题', body: '  ' },
    { title: 42, body: '正文' }, { title: '标题', body: {} },
    { title: '字'.repeat(81), body: '正文' }, { title: '标题', body: '字'.repeat(10001) },
    { id: null, title: '标题', body: '正文' }, { id: 'missing', title: '标题', body: '正文' },
    { title: '标题', body: '正文', relatedKey: 'herb:unknown' },
    { title: '标题', body: '正文', relatedKey: {} }
  ].forEach((input) => assert.equal(store.saveNote(input).ok, false));
  assert.equal(store.deleteNote(null).ok, false);
  assert.equal(mock.calls.length, 0);
});

test('summary counts represent favorites, notes, unfinished learning, and finished courses without overlap', () => {
  store.toggleFavorite('herb:h1');
  store.toggleFavorite('route:r1');
  store.saveNote({ title: '观察一', body: '正文' });
  store.saveNote({ title: '观察二', body: '正文' });
  store.completeChapter('c1', 'c1-1');
  store.completeChapter('c3', 'c3-1');
  store.completeChapter('c3', 'c3-2');
  assert.deepEqual(store.getStats(), { favorites: 2, notes: 2, learning: 1, completed: 1 });
});

test('accounts keep journals separate and never inherit the guest journal when signing in', () => {
  store.toggleFavorite('herb:h1');
  store.completeChapter('c1', 'c1-1');
  const guestNote = store.saveNote({ title: '游客观察', body: '留在本机' }).note;
  const guestState = store.getState();

  currentUser = { id: 'student-a' };
  assert.deepEqual(store.getState(), { schemaVersion: 1, favorites: [], learning: {}, notes: [] });
  assert.equal(store.getNote(guestNote.id), null);
  assert.deepEqual(store.getGuestNote(guestNote.id), guestNote);
  const aNote = store.saveNote({ title: '甲的私记', body: '个人内容' }).note;
  store.toggleFavorite('course:c2');
  store.completeChapter('c2', 'c2-1');
  const aState = store.getState();

  currentUser = { id: 'student-b' };
  assert.deepEqual(store.getState(), { schemaVersion: 1, favorites: [], learning: {}, notes: [] });
  assert.equal(store.getNote(aNote.id), null);
  assert.equal(store.deleteNote(aNote.id).ok, false);
  store.saveNote({ title: '乙的私记', body: '互不影响' });
  assert.deepEqual(store.getGuestState(), guestState);

  currentUser = { id: 'student-a' };
  assert.deepEqual(store.getState(), aState);
  currentUser = null;
  assert.deepEqual(store.getState(), guestState);
  assert.ok(mock.calls.includes('herb-origin:journal:v1:user:student-a'));
  assert.ok(mock.calls.includes('herb-origin:journal:v1:user:student-b'));
});

test('guest journal access is read-only and snapshots cannot mutate saved notes', () => {
  const guest = store.saveNote({ title: '游客笔记', body: '原始内容' }).note;
  currentUser = { id: 'signed-in' };
  const writes = mock.calls.length;
  store.getGuestNote(guest.id).body = '外部修改';
  store.getGuestState().notes.splice(0);
  assert.equal(store.getGuestNote(guest.id).body, '原始内容');
  assert.equal(store.saveNote({ id: guest.id, title: '修改', body: '不可越界' }).ok, false);
  assert.equal(mock.calls.length, writes);
});
