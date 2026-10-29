const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository } = require('../cloudfunctions/community/repository');

function stubDatabase() {
  let error = null;
  const filters = [];
  const writes = [];
  const db = {
    filters, writes,
    fail: (value) => { error = value; },
    command: {
      and: (...conditions) => ({ and: conditions }),
      or: (...conditions) => ({ or: conditions }),
      in: (ids) => ({ in: ids })
    },
    RegExp: (value) => value,
    collection: (name) => ({
      doc: (id) => ({
        get: async () => { if (error) throw error; return { data: null }; },
        set: async (value) => { writes.push({ name, id, value }); },
        remove: async () => {}
      }),
      where: (condition) => {
        filters.push(condition);
        const query = {
          get: async () => ({ data: [] }), count: async () => ({ total: 0 }),
          orderBy: () => query, skip: () => query, limit: () => query
        };
        return query;
      }
    }),
    runTransaction: async (callback, retry) => { db.retry = retry; return callback(db); }
  };
  return db;
}

test('missing-document reads are null while collection, permissions and network failures stay failures', async () => {
  const db = stubDatabase();
  const repo = createRepository(db);
  assert.equal(await repo.get('users', 'u1'), null);
  db.fail({ errMsg: 'document.get:fail document with _id u1 does not exist' });
  assert.equal(await repo.get('users', 'u1'), null);
  for (const message of ['collection users does not exist', 'permission denied', 'network timeout']) {
    db.fail(new Error(message));
    await assert.rejects(() => repo.get('users', 'u1'));
  }
});

test('query permissions always constrain private favorites and user search is escaped literally', async () => {
  const db = stubDatabase();
  const repo = createRepository(db);
  await repo.listNotes('notes', { scope: 'favorites', userId: 'u1', ids: ['n1'], query: 'a.*(b)' }, { limit: 1 });
  const filter = db.filters[0];
  assert.deepEqual(filter.and[0], { or: [{ visibility: 'public' }, { authorId: 'u1' }] });
  assert.deepEqual(filter.and[1], { _id: { in: ['n1'] } });
  assert.equal(filter.and[2].or[0].title.regexp, 'a\\.\\*\\(b\\)');
  await repo.countNotes('notes', { scope: 'public', userId: 'u1' });
  assert.deepEqual(db.filters.at(-1), { visibility: 'public' });
});

test('transactions wrap wx SDK document writes and keep immutable database fields out of replacements', async () => {
  const db = stubDatabase();
  const repo = createRepository(db);
  await repo.transaction(async (tx) => tx.put('users', 'u1', { _id: 'u1', _openid: 'wechat', id: 'u1', username: '甲' }));
  assert.deepEqual(db.writes[0].value, { data: { id: 'u1', username: '甲' } });
  assert.equal(db.retry, 5);
});

test('saved-note batching deduplicates identifiers before counting and paginating', async () => {
  const db = stubDatabase();
  const rows = Array.from({ length: 23 }, (_, index) => ({ id: 'n' + index, updatedAt: '2026-10-14T08:00:00.000Z' }));
  const groups = [];
  db.collection = () => ({ where(condition) {
    const ids = condition.and.find(clause => clause._id)._id.in;
    groups.push(ids);
    const matches = rows.filter(note => ids.includes(note.id));
    const query = {
      get: async () => ({ data: matches }), count: async () => ({ total: matches.length }), limit: () => query
    };
    return query;
  } });
  const repo = createRepository(db);
  const ids = rows.map(note => note.id).concat(['n0', 'n1', 'n20', 'n22']);
  const filter = { scope: 'favorites', userId: 'u1', ids };
  const listed = await repo.listNotes('notes', filter, { offset: 18, limit: 5 });
  const expected = rows.slice().sort((a, b) => b.id.localeCompare(a.id)).slice(18, 23);
  assert.deepEqual(listed, expected);
  assert.equal(await repo.countNotes('notes', filter), 23);
  assert.equal(groups.length, 4);
  assert.ok(groups.every(group => group.length <= 20));
  assert.equal(new Set(groups.slice(0, 2).flat()).size, 23);
  assert.equal(groups.slice(0, 2).flat().length, 23);
  assert.equal(ids.length, 27);
});
