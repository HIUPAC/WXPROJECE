const test = require('node:test');
const assert = require('node:assert/strict');
const community = require('../miniprogram/services/community');
const originalGetUser = community.getUser;
const originalIsDemoMode = community.isDemoMode;
const paths = ['backup', 'store', 'play', 'demo'].map(name => require.resolve('../miniprogram/services/' + name));
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const JOURNAL = 'herb-origin:journal:v1';
const PLAY = 'herb-origin:play:v1:guest';
const DEMO = 'herb-origin:official-demo:v1';
const SESSION = 'herb-origin:community:session:v1';
let backup, store, play, demo, user, mock;

test.beforeEach(() => {
  user = null;
  const values = new Map();
  mock = { values, writes: [], blockedRead: '', blockedWrite: '', silentWrite: '', failReadBack: '', waitingReadBack: false,
    getStorageSync(key) {
      if (this.blockedRead === key || (this.waitingReadBack && key === this.failReadBack)) { this.waitingReadBack = false; throw Error('storage read failed'); }
      return values.get(key);
    },
    setStorageSync(key, value) {
      this.writes.push(key);
      if (this.blockedWrite === key) throw Error('quota exceeded');
      if (this.silentWrite === key) return;
      values.set(key, value);
      if (this.failReadBack === key) this.waitingReadBack = true;
    },
  };
  global.wx = mock;
  community.getUser = () => user;
  community.isDemoMode = () => Boolean(mock.activeDemo || (user && user.isDemo));
  paths.forEach(path => delete require.cache[path]);
  backup = require(paths[0]); store = require(paths[1]); play = require(paths[2]); demo = require(paths[3]);
});
test.after(() => { community.getUser = originalGetUser; community.isDemoMode = originalIsDemoMode; delete global.wx; });

function seedLearning() {
  store.toggleFavorite('herb:h1'); store.completeChapter('c1', 'c1-1');
  store.saveNote({ title: '一片叶的观察', body: '原始的本机手记正文。', relatedKey: 'herb:h1' });
  const questions = play.createQuiz();
  play.saveQuiz('quiz-round-001', questions.map(row => row.id), questions.map(row => row.answer));
  const pairIds = [...new Set(play.createDeck().map(row => row.pairId))];
  play.saveMatch('match-round-001', 8, pairIds);
  play.saveObservation('m1', '沿着公共步道观察同一片叶，叶缘有细小缺口，叶背没有看清，留待下一次确认。');
  play.openDaily();
  const result = backup.createBackup(); assert.equal(result.ok, true, result.error);
  return result.backup;
}
function legacy(value) {
  const result = clone(value); delete result.mode; delete result.ownerId;
  result.state.notes.forEach(note => delete note.source);
  return result;
}
function clearGuest() { mock.values.delete(JOURNAL); mock.values.delete(PLAY); mock.writes.length = 0; }

test('a real storage round trip restores local learning only and exports no credentials', () => {
  mock.values.set(SESSION, { password: 'must-not-export', sessionToken: 'private-token' });
  const value = seedLearning(), originalJournal = clone(store.getState()), originalPlay = clone(play.getBackup());
  assert.equal(value.mode, 'guest'); assert.equal(value.ownerId, 'guest');
  assert.ok(!JSON.stringify(value).includes('private-token')); assert.ok(!JSON.stringify(value).includes('must-not-export'));
  clearGuest();
  const result = backup.importBackup(JSON.stringify(value));
  assert.equal(result.ok, true, result.error); assert.equal(result.summary.notesAdded, 1);
  assert.deepEqual(store.getState(), originalJournal); assert.deepEqual(play.getBackup(), originalPlay);
  assert.ok(mock.writes.every(key => key === JOURNAL || key === PLAY));
  assert.equal(mock.values.get(SESSION).sessionToken, 'private-token');
  assert.equal(user, null);
});

test('legacy v1 content merges only into the current account without altering guest or another account', () => {
  const value = legacy(seedLearning()), guest = clone(mock.values.get(JOURNAL));
  user = { id: 'student-b' }; store.saveNote({ title: '乙的私记', body: '不应读取或覆盖。' });
  const bKey = JOURNAL + ':user:student-b', beforeB = clone(mock.values.get(bKey));
  user = { id: 'student-a' }; mock.writes.length = 0;
  const result = backup.importBackup(value);
  assert.equal(result.ok, true, result.error); assert.match(result.message, /旧版备份未标记账号/);
  assert.equal(store.getState().notes.length, 1);
  assert.deepEqual(mock.values.get(JOURNAL), guest); assert.deepEqual(mock.values.get(bKey), beforeB);
  assert.deepEqual(mock.writes, [JOURNAL + ':user:student-a', 'herb-origin:play:v1:student-a']);
  assert.equal(user.id, 'student-a');
});

test('account and mode mismatch are rejected before any writes or implicit account switch', () => {
  user = { id: 'student-a' }; const value = seedLearning();
  user = { id: 'student-b' }; mock.writes.length = 0;
  assert.equal(backup.importBackup(value).code, 'BACKUP_OWNER_MISMATCH');
  value.ownerId = 'student-b'; value.mode = 'demo';
  assert.equal(backup.importBackup(value).code, 'BACKUP_OWNER_MISMATCH');
  assert.equal(user.id, 'student-b'); assert.deepEqual(mock.writes, []);
});

test('repeated imports are idempotent and never add attempts, observations or duplicate notes', () => {
  const value = seedLearning(); clearGuest();
  assert.equal(backup.importBackup(value).ok, true);
  const saved = clone([...mock.values]), writes = mock.writes.length;
  const repeat = backup.importBackup(value);
  assert.equal(repeat.ok, true); assert.equal(repeat.summary.notesAdded, 0); assert.equal(repeat.summary.observationsAdded, 0);
  assert.equal(mock.writes.length, writes); assert.deepEqual(clone([...mock.values]), saved);
  assert.equal(play.getSummary().quizRuns, 1); assert.equal(play.getSummary().matchRuns, 1);
});

test('different text with the same note id is preserved as a stable conflict copy', () => {
  const value = seedLearning(), id = value.state.notes[0].id;
  store.saveNote({ id, title: '本机后来编辑的标题', body: '应保留当前正文。' });
  const result = backup.importBackup(value);
  assert.equal(result.ok, true); assert.equal(result.summary.noteConflicts, 1); assert.equal(store.getState().notes.length, 2);
  assert.equal(store.getNote(id).title, '本机后来编辑的标题');
  const restored = store.getState().notes.find(note => note.id !== id); assert.match(restored.id, /-restored-/);
  assert.equal(restored.body, value.state.notes[0].body);
  assert.equal(backup.importBackup(value).summary.notesAdded, 0); assert.equal(store.getState().notes.length, 2);
});

test('a conflicting observation becomes a local note with its complete original text', () => {
  const value = seedLearning(), original = value.state.play.observations[0].text;
  play.saveObservation('m1', '这次在同一日期补充新的实际观察，叶片呈深绿色，叶缘的缺口仍需再次核对。');
  const before = clone(play.getBackup());
  const result = backup.importBackup(value);
  assert.equal(result.ok, true); assert.equal(result.summary.observationCopies, 1); assert.equal(result.summary.observationsAdded, 0);
  assert.match(result.message, /保留为本机笔记/);
  const restored = store.getState().notes.find(note => /^observation-restored-/.test(note.id)); assert.ok(restored.body.includes(original));
  assert.deepEqual(play.getBackup(), before);
  backup.importBackup(value); assert.equal(store.getState().notes.filter(note => /^observation-restored-/.test(note.id)).length, 1);
});

test('different last game records are preserved in local notes while counters merge without adding runs', () => {
  const value = seedLearning();
  const questions = play.createQuiz();
  play.saveQuiz('quiz-round-002', questions.map(row => row.id), questions.map(row => row.answer));
  const pairIds = [...new Set(play.createDeck().map(row => row.pairId))]; play.saveMatch('match-round-002', 7, pairIds);
  const result = backup.importBackup(value);
  assert.equal(result.ok, true); assert.equal(result.summary.gameCopies, 2);
  assert.equal(play.getSummary().quizRuns, 2); assert.equal(play.getSummary().matchRuns, 2);
  assert.equal(play.getBackup().quiz.last.runId, 'quiz-round-002'); assert.equal(play.getBackup().match.lastRunId, 'match-round-002');
  const copies = store.getState().notes.filter(note => /^play-restored-/.test(note.id)); assert.equal(copies.length, 2);
  assert.ok(copies.some(note => note.body.includes('quiz-round-001'))); assert.ok(copies.some(note => note.body.includes('match-round-001')));
  backup.importBackup(value); assert.equal(store.getState().notes.filter(note => /^play-restored-/.test(note.id)).length, 2);
});

test('malicious fields, unsafe ids, unknown content, bad versions, invalid scores and oversized input never write', () => {
  const base = seedLearning(); clearGuest();
  const mutations = [
    value => { value.version = 2; }, value => { value.sessionToken = 'credential'; },
    value => { value.state.password = 'credential'; }, value => { value.state.notes[0].authorId = 'someone-else'; },
    value => { value.state.notes[0].id = '__proto__'; }, value => { value.state.notes[0].id = '../another-key'; },
    value => { value.state.notes[0].relatedKey = 'course:missing'; }, value => { value.state.notes[0].updatedAt = '2025-02-30T00:00:00.000Z'; },
    value => { value.state.favorites.push('herb:unknown'); }, value => { value.state.learning.missing = ['chapter']; },
    value => { value.state.play.quiz.last.score = 4; }, value => { value.state.notes[0].source = 'cloud'; },
    value => { value.state.notes[0].body = '字'.repeat(10001); }, value => { value.state.notes.push(clone(value.state.notes[0])); },
  ];
  mutations.forEach(mutate => { const value = clone(base); mutate(value); assert.equal(backup.importBackup(value).ok, false); });
  assert.equal(backup.importBackup('x'.repeat(backup.MAX_BYTES + 1)).ok, false);
  assert.equal(backup.importBackup('{"__proto__":{"polluted":true}}').ok, false);
  assert.equal({}.polluted, undefined); assert.deepEqual(mock.writes, []);
});

test('object inputs cannot execute getters, toJSON, cycles or sparse arrays', () => {
  const base = seedLearning(); clearGuest(); let executed = 0;
  const accessor = clone(base); Object.defineProperty(accessor, 'secret', { enumerable: true, get() { executed += 1; return 'secret'; } });
  assert.equal(backup.importBackup(accessor).ok, false);
  const custom = clone(base); custom.toJSON = () => { executed += 1; return base; };
  assert.equal(backup.importBackup(custom).ok, false);
  const cyclic = clone(base); cyclic.circular = cyclic; assert.equal(backup.importBackup(cyclic).ok, false);
  const sparse = clone(base); sparse.state.favorites = new Array(2); assert.equal(backup.importBackup(sparse).ok, false);
  assert.equal(executed, 0); assert.deepEqual(mock.writes, []);
});

test('unreadable or malformed existing storage aborts all planned writes and exports fail honestly', () => {
  const value = seedLearning(), before = clone(mock.values.get(JOURNAL)); mock.writes.length = 0;
  mock.blockedRead = PLAY;
  assert.equal(backup.importBackup(value).ok, false); assert.equal(backup.createBackup().ok, false); assert.deepEqual(mock.writes, []);
  mock.blockedRead = ''; mock.values.set(JOURNAL, { schemaVersion: 99, notes: [{ body: 'must preserve' }] });
  const damaged = clone(mock.values.get(JOURNAL));
  assert.equal(backup.importBackup(value).ok, false); assert.equal(backup.createBackup().ok, false);
  assert.deepEqual(mock.values.get(JOURNAL), damaged); assert.deepEqual(mock.writes, []);
  mock.values.set(JOURNAL, before);
  assert.equal(backup.createBackup().ok, true);
});

test('an active but unreadable demo identity cannot be mistaken for a successful guest backup', () => {
  const value = seedLearning(); mock.activeDemo = true; mock.writes.length = 0;
  assert.equal(backup.createBackup().ok, false); assert.equal(backup.importBackup(value).ok, false);
  assert.deepEqual(mock.writes, []); assert.equal(mock.values.get(JOURNAL).notes.length, 1);
});

test('failed first writes preserve originals and a retry restores once', () => {
  const value = seedLearning(); clearGuest(); mock.blockedWrite = JOURNAL;
  const failed = backup.importBackup(value);
  assert.equal(failed.ok, false); assert.equal(failed.partial, false); assert.equal(mock.values.has(JOURNAL), false);
  assert.equal(mock.values.has(PLAY), false);
  mock.blockedWrite = ''; assert.equal(backup.importBackup(value).ok, true);
  assert.equal(store.getState().notes.length, 1); assert.equal(play.getSummary().quizRuns, 1);
});

test('later write failures report precisely which modules were restored and retry is safe', () => {
  const value = seedLearning(); clearGuest(); mock.blockedWrite = PLAY;
  const failed = backup.importBackup(value);
  assert.equal(failed.ok, false); assert.equal(failed.partial, true); assert.deepEqual(failed.restored, ['收藏、课程与本机笔记']);
  assert.match(failed.error, /部分记录已恢复/); assert.equal(store.getState().notes.length, 1); assert.equal(play.getSummary().quizRuns, 0);
  mock.blockedWrite = ''; const retried = backup.importBackup(value);
  assert.equal(retried.ok, true); assert.equal(retried.summary.notesAdded, 0); assert.equal(store.getState().notes.length, 1); assert.equal(play.getSummary().quizRuns, 1);
});

test('read-back failures and silently discarded writes are never reported as successful', () => {
  const value = seedLearning(); clearGuest(); mock.failReadBack = JOURNAL;
  const uncertain = backup.importBackup(value);
  assert.equal(uncertain.ok, false); assert.equal(uncertain.partial, true); assert.equal(uncertain.uncertain, '收藏、课程与本机笔记');
  assert.match(uncertain.error, /可能已保存/); assert.equal(mock.values.get(JOURNAL).notes.length, 1);
  mock.failReadBack = ''; assert.equal(backup.importBackup(value).ok, true); assert.equal(store.getState().notes.length, 1);
  clearGuest(); mock.silentWrite = JOURNAL;
  assert.equal(backup.importBackup(value).ok, false); assert.equal(mock.values.has(JOURNAL), false);
});

test('an account change between preparation and writes aborts without reading or writing the new account', () => {
  const value = seedLearning(); clearGuest();
  const originalRead = mock.getStorageSync;
  mock.getStorageSync = function(key) {
    const result = originalRead.call(this, key);
    if (key === PLAY) user = { id: 'different-account' };
    return result;
  };
  const failed = backup.importBackup(value);
  assert.equal(failed.ok, false); assert.match(failed.error, /账号已切换/); assert.deepEqual(mock.writes, []);
  assert.equal(mock.values.has(JOURNAL + ':user:different-account'), false);
});

test('a journal changed after preparation is never overwritten by the stale restoration plan', () => {
  const value = seedLearning(); clearGuest();
  let reads = 0; const originalRead = mock.getStorageSync;
  mock.getStorageSync = function(key) {
    if (key === JOURNAL && ++reads === 2) this.values.set(JOURNAL, { schemaVersion: 1, favorites: ['herb:h2'], learning: {}, notes: [] });
    return originalRead.call(this, key);
  };
  const failed = backup.importBackup(value);
  assert.equal(failed.ok, false); assert.match(failed.error, /本机记录已变化/); assert.deepEqual(mock.writes, []);
  assert.deepEqual(mock.values.get(JOURNAL).favorites, ['herb:h2']);
});

test('own demo notes restore only in demo mode and never alter profile, avatars, editor notes or interactions', () => {
  assert.equal(demo.initialize().ok, true); user = demo.getUser();
  demo.request('saveNote', { creationKey: 'backup-demo-001', title: '演示观察', body: '自己的演示正文。', visibility: 'public', relatedKey: 'herb:h1' });
  const value = backup.createBackup(); assert.equal(value.ok, true, value.error);
  const own = value.backup.state.notes.find(row => row.title === '演示观察');
  const before = clone(mock.values.get(DEMO));
  demo.request('deleteNote', { id: own.id });
  const editor = clone(mock.values.get(DEMO).notes.find(row => row.authorId === 'demo-editor'));
  const result = backup.importBackup(value.backup); assert.equal(result.ok, true, result.error); assert.equal(result.summary.demoNotesAdded, 1);
  const after = mock.values.get(DEMO);
  assert.deepEqual(after.user, before.user); assert.deepEqual(after.avatarFiles, before.avatarFiles);
  assert.deepEqual(after.notes.find(row => row.authorId === 'demo-editor'), editor);
  assert.equal(demo.ownNotes().find(row => row.id === own.id).body, own.body);
  assert.equal(after.notes.find(row => row.id === own.id).likeCount, 0);
  assert.equal(backup.importBackup(value.backup).summary.demoNotesAdded, 0);
  user = null; mock.writes.length = 0;
  assert.equal(backup.importBackup(legacy(value.backup)).code, 'DEMO_REQUIRED'); assert.deepEqual(mock.writes, []);
  user = demo.getUser(); const forged = clone(value.backup); forged.state.notes[0].id = 'demo-editor-observation'; forged.state.notes[0].source = 'demo';
  assert.equal(backup.importBackup(forged).ok, false); assert.deepEqual(mock.writes, []);
});

test('retry after an unconfirmed demo write refreshes cached notes even when storage already contains the merge', () => {
  assert.equal(demo.initialize().ok, true); user = demo.getUser();
  const created = demo.request('saveNote', { creationKey: 'uncertain-demo-001', title: '待恢复演示笔记', body: '重试后应出现在本机列表。', visibility: 'private' });
  const value = backup.createBackup(); assert.equal(value.ok, true);
  demo.request('deleteNote', { id: created.note.id }); mock.failReadBack = DEMO;
  const failed = backup.importBackup(value.backup); assert.equal(failed.ok, false); assert.equal(failed.uncertain, '自己的演示笔记');
  mock.failReadBack = ''; const retried = backup.importBackup(value.backup); assert.equal(retried.ok, true);
  assert.ok(demo.ownNotes().some(note => note.id === created.note.id));
  assert.equal(demo.ownNotes().filter(note => note.id === created.note.id).length, 1);
});

test('merging more than 366 inspiration dates aborts without dropping either history', () => {
  const value = seedLearning();
  const today = Math.floor((Date.now() + 8 * 3600000) / 86400000);
  const saved = mock.values.get(PLAY); saved.openedDays = Array.from({ length: 366 }, (_, index) => today - index);
  value.state.play.openedDays = [today - 366];
  const before = clone([...mock.values]); mock.writes.length = 0;
  const failed = backup.importBackup(value);
  assert.equal(failed.ok, false); assert.match(failed.error, /超过 366 天/);
  assert.deepEqual(clone([...mock.values]), before); assert.deepEqual(mock.writes, []);
});
