const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommunity, COLLECTIONS, avatarText } = require('../cloudfunctions/community/core');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function memoryRepository() {
  let documents = new Map();
  let queue = Promise.resolve();
  const matches = (note, filter) => {
    if (filter.scope === 'public' && note.visibility !== 'public') return false;
    if (filter.scope === 'my' && note.authorId !== filter.userId) return false;
    if (!['public', 'my'].includes(filter.scope) && note.visibility !== 'public' && note.authorId !== filter.userId) return false;
    if (filter.ids && !filter.ids.includes(note.id)) return false;
    if (filter.relatedKey && note.relatedKey !== filter.relatedKey) return false;
    if (filter.query && !(note.title + '\n' + note.body).toLowerCase().includes(filter.query.toLowerCase())) return false;
    return true;
  };
  const methods = (data) => ({
    get: async (name, id) => clone(data.get(name + ':' + id)) || null,
    put: async (name, id, value) => {
      if (repo.failWrite) { repo.failWrite = false; throw new Error('database write failed'); }
      data.set(name + ':' + id, clone(value));
    },
    remove: async (name, id) => { data.delete(name + ':' + id); },
    listNotes: async (name, filter, { offset = 0, limit = 20 } = {}) => Array.from(data.entries())
      .filter(([key, value]) => key.startsWith(name + ':') && matches(value, filter))
      .map(([, value]) => clone(value)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .slice(offset, offset + limit),
    countNotes: async (name, filter) => Array.from(data.entries()).filter(([key, value]) => key.startsWith(name + ':') && matches(value, filter)).length
  });
  const repo = {
    get: (...args) => methods(documents).get(...args),
    put: (...args) => methods(documents).put(...args),
    remove: (...args) => methods(documents).remove(...args),
    listNotes: (...args) => methods(documents).listNotes(...args),
    countNotes: (...args) => methods(documents).countNotes(...args),
    transaction(callback) {
      const operation = queue.then(async () => {
        const draft = new Map(Array.from(documents, ([key, value]) => [key, clone(value)]));
        const result = await callback(methods(draft));
        documents = draft;
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    },
    all: () => Array.from(documents.entries())
  };
  return repo;
}
function fixture(options = {}) {
  const repo = memoryRepository();
  let timestamp = Date.UTC(2026, 9, 9, 4);
  const handle = createCommunity({ repo, now: () => timestamp, verifyAvatar: async (fileId) => fileId.includes('valid'), ...options });
  function call(action, input = {}, account = null, openid = '') {
    return handle(Object.assign({}, input, { action, sessionToken: account ? account.sessionToken : '' }), { openid: openid || (account && account.openid) || 'wechat-guest' });
  }
  async function register(suffix, overrides = {}) {
    const openid = 'wechat-' + suffix;
    const result = await call('register', Object.assign({ studentId: 's00' + suffix, phone: '1380000000' + suffix, username: '用户' + suffix, password: 'pass-word-' + suffix }, overrides), null, openid);
    assert.equal(result.ok, true, result.error);
    return Object.assign(result, { openid });
  }
  return { repo, call, register, advance: (milliseconds) => { timestamp += milliseconds; } };
}

test('registration uses salted password hashes, unique identities, and explicit profile fields only', async () => {
  const f = fixture();
  const alice = await f.register(1, { username: ' Alice ', studentId: 'a001' });
  assert.equal(alice.user.studentId, 'A001');
  assert.equal(alice.user.avatarText, 'A');
  assert.match(alice.sessionToken, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(f.repo.all()).includes('pass-word-1'), false);
  assert.equal(alice.user.password, undefined);
  const stored = await f.repo.get(COLLECTIONS.users, alice.user.id);
  assert.equal(stored.password.algorithm, 'scrypt-v1');
  assert.match(stored.password.salt, /^[a-f0-9]{32}$/);
  assert.match(stored.password.hash, /^[a-f0-9]{128}$/);
  const byStudent = await f.call('login', { account: 'a001', password: 'pass-word-1' }, null, alice.openid);
  const byPhone = await f.call('login', { account: alice.user.phone, password: 'pass-word-1' }, null, alice.openid);
  assert.equal(byStudent.user.id, alice.user.id);
  assert.equal(byPhone.user.id, alice.user.id);
  assert.equal((await f.call('login', { account: 'Alice', password: 'pass-word-1' })).code, 'LOGIN_FAILED');
});

test('concurrent registration cannot claim the same student ID or phone twice', async () => {
  const f = fixture();
  const input = { studentId: 'S0001', phone: '13800000001', username: '甲', password: '12345678' };
  const results = await Promise.all(['one', 'two'].map((openid) => f.call('register', input, null, openid)));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.find((result) => !result.ok).code, 'ACCOUNT_EXISTS');
  const winner = results.find((result) => result.ok);
  const duplicatePhone = await f.call('register', Object.assign({}, input, { studentId: 'other001' }), null, 'third');
  assert.equal(duplicatePhone.code, 'ACCOUNT_EXISTS');
  // A student number equal to an existing phone cannot create ambiguous login.
  const ambiguous = await f.call('register', Object.assign({}, input, { studentId: input.phone, phone: '13800000002' }), null, 'fourth');
  assert.equal(ambiguous.code, 'ACCOUNT_EXISTS');
  assert.equal((await f.call('login', { account: input.phone, password: input.password }, null, 'third')).user.id, winner.user.id);
});

test('server validates registration, profile lengths, and login rate limits', async () => {
  const f = fixture();
  for (const values of [
    { studentId: 'a' }, { phone: '12345' }, { username: '' }, { password: 'short' }
  ]) {
    const result = await f.call('register', Object.assign({ studentId: 'A0001', phone: '13800000001', username: '甲', password: '12345678' }, values));
    assert.equal(result.ok, false);
  }
  const alice = await f.register(1);
  assert.equal((await f.call('updateProfile', { username: '甲'.repeat(21), tags: [], bio: '' }, alice)).ok, false);
  assert.equal((await f.call('updateProfile', { username: '甲', tags: Array(7).fill('标签'), bio: '' }, alice)).ok, false);
  assert.equal((await f.call('updateProfile', { username: '甲', tags: ['字'.repeat(13)], bio: '' }, alice)).ok, false);
  assert.equal((await f.call('updateProfile', { username: '甲', tags: [], bio: '字'.repeat(201) }, alice)).ok, false);
  for (let i = 0; i < 10; i++) assert.equal((await f.call('login', { account: 'S001', password: 'incorrect' }, null, 'attack-' + i)).code, 'LOGIN_FAILED');
  assert.equal((await f.call('login', { account: 'S001', password: 'pass-word-1' }, null, 'fresh-attacker')).code, 'RATE_LIMITED');
});

test('sessions bind to WeChat openid, expire, and are revoked on logout', async () => {
  const f = fixture();
  const alice = await f.register(1);
  assert.equal((await f.call('whoami', {}, alice, 'another-wechat')).code, 'AUTH_REQUIRED');
  assert.equal((await f.call('whoami', {}, alice)).user.id, alice.user.id);
  assert.equal((await f.call('logout', {}, alice)).ok, true);
  assert.equal((await f.call('whoami', {}, alice)).code, 'AUTH_REQUIRED');
  const login = await f.call('login', { account: alice.user.phone, password: 'pass-word-1' }, null, alice.openid);
  f.advance(7 * 24 * 60 * 60 * 1000 + 1);
  assert.equal((await f.call('whoami', {}, Object.assign(login, { openid: alice.openid }))).code, 'AUTH_REQUIRED');
});

test('private notes cannot be read, searched, edited, liked or collected by other users', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const bob = await f.register(2);
  const created = await f.call('saveNote', { title: '私密观察', body: '秘密内容', relatedKey: 'herb:h1', visibility: 'private' }, alice);
  assert.equal(created.ok, true, created.error);
  const id = created.note.id;
  assert.equal((await f.call('getNote', { id }, alice)).note.mine, true);
  for (const account of [bob, null]) {
    assert.equal((await f.call('getNote', { id }, account)).code, 'NOTE_UNAVAILABLE');
    assert.equal((await f.call('listNotes', { scope: 'public', query: '秘密内容' }, account)).total, 0);
  }
  for (const action of ['deleteNote', 'toggleLike', 'toggleNoteFavorite']) assert.equal((await f.call(action, { id }, bob)).code, 'NOTE_UNAVAILABLE');
  const otherEdit = await f.call('saveNote', { id, title: '抢改', body: '内容', visibility: 'public' }, bob);
  assert.equal(otherEdit.code, 'NOTE_UNAVAILABLE');
  const stats = (await f.call('getStats', {}, alice)).stats;
  assert.deepEqual(stats, { notes: 1, publicNotes: 0, privateNotes: 1, views: 0, todayViews: 0, likes: 0, favorites: 0, likedNotes: 0, savedNotes: 0 });
});

test('public interactions, visibility changes and deletes keep counts and saved lists consistent', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const bob = await f.register(2);
  const charlie = await f.register(3);
  const input = { title: '观察', body: '叶片变化', relatedKey: 'herb:h1', visibility: 'public' };
  const note = (await f.call('saveNote', input, alice)).note;
  assert.equal((await f.call('saveNote', Object.assign({}, input, { id: note.id }), bob)).code, 'FORBIDDEN');
  const [bobLike, charlieLike] = await Promise.all([bob, charlie].map((user) => f.call('toggleLike', { id: note.id, userId: alice.user.id }, user)));
  assert.equal(bobLike.ok, true);
  assert.equal(charlieLike.note.likeCount, 2);
  await f.call('toggleNoteFavorite', { id: note.id }, bob);
  assert.equal((await f.call('getStats', {}, alice)).stats.likes, 2);
  assert.equal((await f.call('getStats', {}, bob)).stats.savedNotes, 1);
  assert.equal((await f.call('getStats', {}, bob)).stats.likedNotes, 1);
  const publicList = await f.call('listNotes', { scope: 'public', relatedKey: 'herb:h1', limit: 1 });
  assert.equal(publicList.total, 1);
  assert.equal(publicList.notes[0].author.studentId, undefined);
  assert.equal(publicList.notes[0].author.phone, undefined);
  const privatized = await f.call('saveNote', Object.assign({}, input, { id: note.id, visibility: 'private' }), alice);
  assert.equal(privatized.note.createdAt, note.createdAt);
  assert.equal((await f.call('listNotes', { scope: 'favorites' }, bob)).total, 0);
  assert.equal((await f.call('listNotes', { scope: 'liked' }, bob)).total, 0);
  assert.equal((await f.call('getStats', {}, bob)).stats.savedNotes, 0);
  assert.equal((await f.call('getStats', {}, bob)).stats.likedNotes, 0);
  assert.equal((await f.call('getStats', {}, alice)).stats.privateNotes, 1);
  await f.call('saveNote', Object.assign({}, input, { id: note.id }), alice);
  const unlike = await f.call('toggleLike', { id: note.id }, bob);
  assert.equal(unlike.note.likeCount, 1);
  assert.equal(unlike.note.liked, false);
  assert.equal((await f.call('getStats', {}, alice)).stats.likes, 1);
  await f.call('deleteNote', { id: note.id }, alice);
  assert.equal((await f.call('listNotes', { scope: 'favorites' }, bob)).total, 0);
  assert.equal((await f.call('getStats', {}, charlie)).stats.likedNotes, 0);
  assert.deepEqual((await f.call('getStats', {}, alice)).stats, { notes: 0, publicNotes: 0, privateNotes: 0, views: 0, todayViews: 0, likes: 0, favorites: 0, likedNotes: 0, savedNotes: 0 });
});

test('explicit reaction states deduplicate concurrent retries and update author totals exactly once', async () => {
  const f = fixture();
  const alice = await f.register(1), bob = await f.register(2), charlie = await f.register(3);
  const created = (await f.call('saveNote', { title: '去重互动', body: '公开内容', visibility: 'public' }, alice)).note;
  const id = created.id;
  for (const [action, stateField, countField, statField] of [
    ['toggleLike', 'liked', 'likeCount', 'likes'], ['toggleNoteFavorite', 'favorite', 'favoriteCount', 'favorites']
  ]) {
    const repeated = await Promise.all(Array.from({ length: 5 }, () => f.call(action, { id, active: true }, bob)));
    assert.ok(repeated.every(result => result.ok && result.note[stateField] && result.note[countField] === 1));
    const other = await f.call(action, { id, active: true }, charlie);
    assert.equal(other.note[countField], 2);
    assert.equal((await f.call('getStats', {}, alice)).stats[statField], 2);
    const cleared = await Promise.all(Array.from({ length: 4 }, () => f.call(action, { id, active: false }, bob)));
    assert.ok(cleared.every(result => result.ok && !result.note[stateField] && result.note[countField] === 1));
    assert.equal((await f.call('getStats', {}, alice)).stats[statField], 1);
  }
  assert.equal((await f.call('getNote', { id }, bob)).note.updatedAt, created.updatedAt);
  assert.equal((await f.call('getStats', {}, bob)).stats.likedNotes, 0);
  assert.equal((await f.call('getStats', {}, bob)).stats.savedNotes, 0);
  assert.equal((await f.call('getStats', {}, charlie)).stats.likedNotes, 1);
  assert.equal((await f.call('getStats', {}, charlie)).stats.savedNotes, 1);
});

test('explicit reaction no-ops need no writes and still enforce note permissions and input types', async () => {
  const f = fixture();
  const alice = await f.register(1), bob = await f.register(2);
  const input = { title: '私密互动', body: '内容', visibility: 'private' };
  const id = (await f.call('saveNote', input, alice)).note.id;
  for (const action of ['toggleLike', 'toggleNoteFavorite']) {
    assert.equal((await f.call(action, { id, active: false }, bob)).code, 'NOTE_UNAVAILABLE');
    for (const active of [null, 'true', 0]) assert.equal((await f.call(action, { id, active }, alice)).code, 'INVALID_INPUT');
    f.repo.failWrite = true;
    assert.equal((await f.call(action, { id, active: false }, alice)).ok, true);
    assert.equal((await f.call(action, { id, active: true }, alice)).code, 'SERVICE_UNAVAILABLE');
    const added = await f.call(action, { id, active: true }, alice);
    assert.equal(added.ok, true);
    assert.equal((await f.call(action, { id, active: true }, alice)).ok, true);
  }
  const stats = (await f.call('getStats', {}, alice)).stats;
  assert.equal(stats.likes, 1); assert.equal(stats.favorites, 1);
  assert.equal(stats.likedNotes, 1); assert.equal(stats.savedNotes, 1);
});

test('view counts are transactional, ignore author views, deduplicate retries and same-day refreshes', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const bob = await f.register(2);
  const id = (await f.call('saveNote', { title: '观察', body: '公开内容', visibility: 'public' }, alice)).note.id;
  await f.call('getNote', { id, view: true, viewKey: 'author-view-key' }, alice);
  assert.equal((await f.call('getNote', { id }, alice)).note.viewCount, 0);
  const repeated = await Promise.all(Array.from({ length: 5 }, () => f.call('getNote', { id, view: true, viewKey: 'opening-0001' }, bob)));
  assert.equal(repeated.every((result) => result.note.viewCount === 1), true);
  assert.equal((await f.call('getNote', { id, view: true, viewKey: 'opening-0002' }, bob)).note.viewCount, 1);
  assert.equal((await f.call('getNote', { id, view: true, viewKey: 'guest-000001' }, null)).note.viewCount, 2);
  f.advance(24 * 60 * 60 * 1000);
  assert.equal((await f.call('getNote', { id, view: true, viewKey: 'opening-0001' }, bob)).note.viewCount, 2);
  assert.equal((await f.call('getNote', { id, view: true, viewKey: 'opening-0003' }, bob)).note.viewCount, 3);
  assert.equal((await f.call('getStats', {}, alice)).stats.views, 3);
});

test('author views create no receipts and queued readings use the day of transaction execution', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const id = (await f.call('saveNote', { title: '排队浏览', body: '公开内容', visibility: 'public' }, alice)).note.id;
  f.repo.failWrite = true;
  const own = await f.call('getNote', { id, view: true, viewKey: 'author-no-write-001' }, alice);
  assert.equal(own.ok, true); assert.equal(own.view.reason, 'AUTHOR');
  assert.equal(f.repo.all().filter(([key]) => key.startsWith(COLLECTIONS.views + ':')).length, 0);
  f.repo.failWrite = false;
  f.advance(12 * 60 * 60 * 1000 - 1);
  let start;
  const gate = new Promise(resolve => { start = resolve; });
  const transact = f.repo.transaction.bind(f.repo);
  f.repo.transaction = callback => gate.then(() => transact(callback));
  const pending = f.call('getNote', { id, view: true, viewKey: 'queued-midnight-001' });
  f.advance(1);
  start();
  const counted = await pending;
  assert.equal(counted.view.reason, 'COUNTED');
  const current = (await f.call('getNote', { id })).note;
  assert.equal(counted.view.day, current.viewDay);
  assert.equal(current.viewCount, 1); assert.equal(current.todayViewCount, 1);
  assert.equal((await f.call('getStats', {}, alice)).stats.todayViews, 1);
});

test('concurrent distinct viewers update note and author daily totals without changing edit timestamps', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const created = (await f.call('saveNote', { title: '并发观察', body: '公开内容', visibility: 'public' }, alice)).note;
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    f.call('getNote', { id: created.id, view: true, viewKey: 'opening-same-key' }, null, 'reader-' + index)));
  assert.ok(results.every(result => result.ok && result.view.counted));
  const note = (await f.call('getNote', { id: created.id })).note;
  assert.equal(note.viewCount, 8);
  assert.equal(note.todayViewCount, 8);
  assert.equal(note.updatedAt, created.updatedAt);
  const stats = (await f.call('getStats', {}, alice)).stats;
  assert.equal(stats.views, 8); assert.equal(stats.todayViews, 8);
  const listed = (await f.call('listNotes', { scope: 'public' })).notes[0];
  assert.equal(listed.viewCount, 8); assert.equal(listed.todayViewCount, 8);
  assert.equal((await f.call('getStats', {}, alice)).stats.views, 8);
});

test('daily views reset at Beijing midnight, retries stay idempotent and deletion subtracts current daily totals', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const input = { title: '跨日观察', body: '公开内容', visibility: 'public' };
  const id = (await f.call('saveNote', input, alice)).note.id;
  f.advance(12 * 60 * 60 * 1000 - 1);
  const first = await f.call('getNote', { id, view: true, viewKey: 'midnight-view-001' });
  assert.equal(first.view.reason, 'COUNTED');
  assert.equal(first.note.todayViewCount, 1);
  f.advance(1);
  const unchanged = await f.call('getNote', { id });
  assert.equal(unchanged.note.viewCount, 1); assert.equal(unchanged.note.todayViewCount, 0);
  assert.equal((await f.call('getStats', {}, alice)).stats.todayViews, 0);
  const retry = await f.call('getNote', { id, view: true, viewKey: 'midnight-view-001' });
  assert.equal(retry.view.reason, 'REQUEST_REPLAY');
  assert.equal(retry.note.todayViewCount, 0);
  const second = await f.call('getNote', { id, view: true, viewKey: 'midnight-view-002' });
  assert.equal(second.note.viewCount, 2); assert.equal(second.note.todayViewCount, 1);
  assert.equal((await f.call('getStats', {}, alice)).stats.todayViews, 1);
  await f.call('saveNote', { ...input, id, visibility: 'private' }, alice);
  assert.equal((await f.call('getNote', { id, view: true, viewKey: 'private-view-001' })).code, 'NOTE_UNAVAILABLE');
  assert.equal((await f.call('getNote', { id }, alice)).note.todayViewCount, 1);
  await f.call('deleteNote', { id }, alice);
  const stats = (await f.call('getStats', {}, alice)).stats;
  assert.equal(stats.views, 0); assert.equal(stats.todayViews, 0);
});

test('guest and authenticated readings from the same WeChat user share a daily quota', async () => {
  const f = fixture();
  const alice = await f.register(1), bob = await f.register(2);
  const id = (await f.call('saveNote', { title: '去重观察', body: '公开内容', visibility: 'public' }, alice)).note.id;
  assert.equal((await f.call('getNote', { id, view: true, viewKey: 'guest-view-001' }, null, bob.openid)).view.counted, true);
  const loggedIn = await f.call('getNote', { id, view: true, viewKey: 'logged-in-view-001' }, bob);
  assert.equal(loggedIn.view.reason, 'ALREADY_VIEWED_TODAY');
  assert.equal(loggedIn.note.viewCount, 1);
  assert.equal((await f.call('getNote', { id, view: true, viewKey: 'authors-view-001' }, alice)).view.reason, 'AUTHOR');
  assert.equal((await f.call('getStats', {}, alice)).stats.todayViews, 1);
});

test('legacy note totals remain intact when daily fields are first added', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const id = (await f.call('saveNote', { title: '旧观察', body: '公开内容', visibility: 'public' }, alice)).note.id;
  const note = await f.repo.get(COLLECTIONS.notes, id);
  note.viewCount = 12;
  await f.repo.put(COLLECTIONS.notes, id, note);
  const user = await f.repo.get(COLLECTIONS.users, alice.user.id);
  user.stats.views = 12;
  await f.repo.put(COLLECTIONS.users, user.id, user);
  const counted = await f.call('getNote', { id, view: true, viewKey: 'legacy-view-001' });
  assert.equal(counted.note.viewCount, 13); assert.equal(counted.note.todayViewCount, 1);
  const stats = (await f.call('getStats', {}, alice)).stats;
  assert.equal(stats.views, 13); assert.equal(stats.todayViews, 1);
});

test('failed transactional writes roll back counters and can safely retry', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const bob = await f.register(2);
  const id = (await f.call('saveNote', { title: '观察', body: '公开内容', visibility: 'public' }, alice)).note.id;
  f.repo.failWrite = true;
  assert.equal((await f.call('toggleLike', { id }, bob)).code, 'SERVICE_UNAVAILABLE');
  assert.equal((await f.call('getNote', { id }, bob)).note.likeCount, 0);
  assert.equal((await f.call('getStats', {}, bob)).stats.likedNotes, 0);
  assert.equal((await f.call('toggleLike', { id }, bob)).note.likeCount, 1);
  f.repo.failWrite = true;
  assert.equal((await f.call('getNote', { id, view: true, viewKey: 'retry-view-01' }, bob)).code, 'SERVICE_UNAVAILABLE');
  assert.equal((await f.call('getNote', { id }, bob)).note.todayViewCount, 0);
  assert.equal((await f.call('getStats', {}, alice)).stats.todayViews, 0);
  const retry = await f.call('getNote', { id, view: true, viewKey: 'retry-view-01' }, bob);
  assert.equal(retry.note.viewCount, 1); assert.equal(retry.note.todayViewCount, 1);
});

test('retrying a new note with a stable creation key preserves one note and one set of statistics', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const bob = await f.register(2);
  const input = { title: '重试观察', body: '网络重试', visibility: 'public', creationKey: 'draft-creation-01' };
  const [first, retry] = await Promise.all([f.call('saveNote', input, alice), f.call('saveNote', input, alice)]);
  assert.equal(first.ok, true);
  assert.equal(first.note.id, retry.note.id);
  assert.equal(first.note.createdAt, retry.note.createdAt);
  assert.equal((await f.call('getStats', {}, alice)).stats.notes, 1);
  assert.equal((await f.call('getStats', {}, alice)).stats.publicNotes, 1);
  assert.equal((await f.call('listNotes', { scope: 'my' }, alice)).total, 1);
  const anotherAccount = await f.call('saveNote', input, bob);
  assert.notEqual(anotherAccount.note.id, first.note.id);
  const privatized = await f.call('saveNote', Object.assign({}, input, { visibility: 'private' }), alice);
  assert.equal(privatized.note.id, first.note.id);
  assert.equal((await f.call('getStats', {}, alice)).stats.publicNotes, 0);
  assert.equal((await f.call('getStats', {}, alice)).stats.privateNotes, 1);
});

test('profile changes propagate to existing note authors and avatar upload belongs to the authenticated account', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const bob = await f.register(2);
  const id = (await f.call('saveNote', { title: '观察', body: '内容', visibility: 'public' }, alice)).note.id;
  const ticket = await f.call('prepareAvatar', { extension: 'png' }, alice, 'valid-wechat');
  assert.equal(ticket.code, 'AUTH_REQUIRED');
  const ownTicket = await f.call('prepareAvatar', { extension: 'png' }, alice);
  const fileId = 'cloud://valid-env.bucket/' + ownTicket.cloudPath;
  assert.equal((await f.call('finishAvatar', { ticket: ownTicket.ticket, fileId }, bob)).ok, false);
  assert.equal((await f.call('finishAvatar', { ticket: ownTicket.ticket, fileId: 'https://foreign/avatar.png' }, alice)).ok, false);
  assert.equal((await f.call('finishAvatar', { ticket: ownTicket.ticket, fileId }, alice)).avatarUrl, fileId);
  assert.equal((await f.call('updateProfile', { username: 'Bob', tags: [], bio: '', avatarUrl: fileId }, bob)).ok, false);
  const updated = await f.call('updateProfile', { username: ' beta中 ', tags: ['植物', '植物', '记录'], bio: '个人介绍', avatarUrl: fileId }, alice);
  assert.deepEqual(updated.user.tags, ['植物', '记录']);
  assert.equal(updated.user.avatarText, 'B');
  const note = (await f.call('getNote', { id }, bob)).note;
  assert.equal(note.author.username, 'beta中');
  assert.equal(note.author.avatarUrl, fileId);
  assert.equal(note.author.bio, '个人介绍');
});

test('default avatar finds the first Chinese character or letter', () => {
  assert.equal(avatarText(' 张三'), '张');
  assert.equal(avatarText('123alice'), 'A');
  assert.equal(avatarText('🌿小草'), '小');
  assert.equal(avatarText('1234'), '1');
});

test('public submissions and profiles require content approval while private drafts remain saveable', async () => {
  let status = 'pass';
  const checked = [];
  const f = fixture({ verifyText: async (content, context, scene) => { checked.push({ content, scene }); return { status }; } });
  const alice = await f.register(1);
  assert.equal(checked[0].scene, 1);
  const note = { title: '今天的观察', body: '一片新叶', visibility: 'public', relatedKey: '' };
  const saved = await f.call('saveNote', note, alice);
  assert.equal(saved.ok, true);
  status = 'blocked';
  assert.equal((await f.call('saveNote', { ...note, id: saved.note.id, body: '不合适的正文' }, alice)).code, 'CONTENT_REJECTED');
  assert.equal((await f.call('getNote', { id: saved.note.id }, alice)).note.body, note.body);
  assert.equal((await f.call('updateProfile', { username: '名字', tags: [], bio: '说明' }, alice)).code, 'CONTENT_REJECTED');
  const count = checked.length;
  assert.equal((await f.call('saveNote', { ...note, visibility: 'private' }, alice)).ok, true);
  assert.equal(checked.length, count);
  status = 'unavailable';
  assert.equal((await f.call('saveNote', note, alice)).code, 'MODERATION_UNAVAILABLE');
  assert.equal((await f.call('getStats', {}, alice)).stats.notes, 2);
});

test('a failed registration content check creates no account or session', async () => {
  const f = fixture({ verifyText: async () => { throw new Error('network'); } });
  const result = await f.call('register', { studentId: 'S001', phone: '13800000001', username: '名字', password: 'pass-word-1' });
  assert.equal(result.code, 'MODERATION_UNAVAILABLE');
  assert.equal(f.repo.all().filter(([key]) => !key.startsWith(COLLECTIONS.rates + ':')).length, 0);
});

test('reports are private records, deduplicate a reporters same-day submission and enforce note visibility', async () => {
  const f = fixture();
  const alice = await f.register(1);
  const privateNote = await f.call('saveNote', { title: '私密', body: '内容', visibility: 'private', relatedKey: '' }, alice);
  assert.equal((await f.call('reportNote', { id: privateNote.note.id, reason: 'privacy' })).ok, false);
  assert.equal((await f.call('reportNote', { id: privateNote.note.id, reason: 'privacy' }, alice)).code, 'NOTE_NOT_PUBLIC');
  const saved = await f.call('saveNote', { title: '公开', body: '内容', visibility: 'public', relatedKey: '' }, alice);
  assert.equal((await f.call('reportNote', { id: saved.note.id, reason: 'unknown' })).ok, false);
  const result = await f.call('reportNote', { id: saved.note.id, reason: 'infringement', detail: '请核实来源' });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal((await f.call('reportNote', { id: saved.note.id, reason: 'infringement' })).duplicate, true);
  const reports = f.repo.all().filter(([key]) => key.startsWith(COLLECTIONS.reports + ':'));
  assert.equal(reports.length, 1);
  assert.equal(reports[0][1].status, 'pending');
  assert.equal(reports[0][1].noteId, saved.note.id);
  assert.equal((await f.call('listNotes', { scope: 'public' })).notes.some(note => note.reporterOpenid), false);
});

test('the release policy blocks cloud image uploads and hides previously uploaded avatars', async () => {
  const f = fixture({ allowAvatarUploads: false });
  const alice = await f.register(1);
  const user = await f.repo.get(COLLECTIONS.users, alice.user.id);
  user.avatarUrl = 'cloud://env.bucket/avatars/old.png';
  await f.repo.put(COLLECTIONS.users, user.id, user);
  assert.equal((await f.call('whoami', {}, alice)).user.avatarUrl, '');
  assert.equal((await f.call('prepareAvatar', { extension: 'png' }, alice)).code, 'AVATAR_UNAVAILABLE');
  assert.equal((await f.call('finishAvatar', { ticket: 'a_legacy', fileId: user.avatarUrl }, alice)).code, 'AVATAR_UNAVAILABLE');
  const saved = await f.call('saveNote', { title: '观察', body: '内容', visibility: 'public', relatedKey: '' }, alice);
  assert.equal(saved.note.author.avatarUrl, '');
  assert.equal((await f.call('listNotes', { scope: 'public' })).notes[0].author.avatarUrl, '');
});
