const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../miniprogram/data/catalog');
const storePath = require.resolve('../miniprogram/services/store');
function page(name, dependencies = {}) {
  let options;
  const changes = [];
  const app = { globalData: {} };
  const values = new Map();
  const wx = { getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, value),
    showToast() {}, navigateTo() {}, switchTab() {}, nextTick(fn) { fn(); }, pageScrollTo() {} };
  global.wx = wx;
  delete require.cache[storePath];
  const store = require(storePath);
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js'), 'utf8'), {
    Page(value) { options = value; }, wx, getApp: () => app, setTimeout, clearTimeout,
    require(target) {
      if (target === '../../config') return dependencies.config || { serviceMode: 'community' };
      if (target.endsWith('/data/catalog')) return dependencies.catalog || catalog;
      if (target.endsWith('/services/store')) return dependencies.store || store;
      if (target.endsWith('/services/reading')) return dependencies.reading || { remember: () => ({ ok: true }), getRecent: () => [] };
      if (target.endsWith('/services/backup')) return {};
      if (target.endsWith('/services/play')) return { getSummary: () => ({ quizBest: 0, matchBest: 0, observationCount: 0, badgeCount: 0, error: '' }) };
      if (target.endsWith('/services/community')) return dependencies.community || { getUser: () => null, listNotes: async () => ({ ok: true, notes: [], total: 0, hasMore: false }) };
      if (target.endsWith('/services/navigation')) return dependencies.navigation || { openLibrary() {}, openNotes() {}, openDetail() {}, editNote() {}, openAuth() {} };
      throw new Error('Unexpected page dependency ' + target);
    }
  });
  const instance = { ...options, data: JSON.parse(JSON.stringify(options.data)), setData(delta) {
    changes.push(delta);
    for (const [key, value] of Object.entries(delta)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = this.data;
      parts.slice(0, -1).forEach(part => { target = target[part]; });
      target[parts.at(-1)] = value;
    }
  }};
  return { instance, changes, values, store, app };
}
test.after(() => { delete global.wx; });

test('library appends small batches, preserves loaded rows on favorite changes and honors direct filters', () => {
  const { instance: p, changes, app } = page('library');
  p.onLoad({ kind: 'herb' }); p.onShow();
  assert.equal(p.data.kind, 'herb');
  assert.equal(p.data.items.length, 20);
  p.loadMore();
  assert.equal(p.data.items.length, 40);
  p.favoriteHerb({ currentTarget: { dataset: { id: p.data.items[25].id } } });
  assert.equal(p.data.items.length, 40);
  assert.equal(p.data.items[25].favorite, true);
  p.onShow(); assert.equal(p.data.items.length, 40);
  p.toggleBotanical();
  assert.equal(p.data.items.length, 20);
  assert.equal(p.data.hasArchiveFilter, true);
  assert.ok(p.data.items.every(item => !['水部', '火部', '金石部'].includes(item.archive.department)));
  p.clearArchiveFilters();
  assert.equal(p.data.kind, 'herb');
  assert.equal(p.data.hasArchiveFilter, false);
  app.globalData.libraryFilter = 'course'; app.globalData.libraryQuery = '';
  p.onShow(); assert.equal(p.data.items.length, 9);
  assert.equal(p.data.hasMore, false);
  changes.forEach(delta => assert.ok(Buffer.byteLength(JSON.stringify(delta)) < 60 * 1024));
  p.onUnload();
});

test('profile resolves large favorites from metadata and paginates without loading original texts', () => {
  const { instance: p, values } = page('profile');
  const herbs = catalog.filterCatalog('herb');
  values.set('herb-origin:journal:v1', { schemaVersion: 1, favorites: herbs.map(item => 'herb:' + item.id), learning: {}, notes: [] });
  p.onShow();
  assert.equal(p.data.favoriteCount, herbs.length);
  assert.equal(p.data.favoriteItems.length, 24);
  p.loadMoreFavorites(); assert.equal(p.data.favoriteItems.length, 48);
  assert.ok(p.data.favoriteItems.every(item => !item.body && !item.archive.sections));
  p.onShow(); assert.equal(p.data.favoriteItems.length, 48);
});

test('a late entry response cannot overwrite the selected whole-volume reader', async () => {
  let resolve;
  const first = new Promise(done => { resolve = done; });
  const { instance: p, changes } = page('detail', { catalog: { ...catalog,
    getItem: () => first,
    getVolume: () => Promise.resolve([{ title: '卷15 · 原文', body: '整卷原文' }])
  }});
  p.onLoad({ kind: 'herb', id: 'h1' });
  p.readVolume();
  await new Promise(done => setImmediate(done));
  assert.equal(p.data.sectionTitle, '卷15 · 原文');
  resolve({ archive: { sections: [{ title: '迟到的本条', body: '旧响应' }] } });
  await new Promise(done => setImmediate(done));
  assert.equal(p.data.sectionTitle, '卷15 · 原文');
  assert.ok(p.data.archiveWholeVolume);
  assert.equal(p.data.item.archive.sections, undefined);
  changes.forEach(delta => assert.ok(Buffer.byteLength(JSON.stringify(delta)) < 32 * 1024));
  p.onUnload();
});

test('expanded courses connect specific chapter practice, private templates, quizzes and official notes', () => {
  const actions = [];
  const { instance: p } = page('detail', { navigation: { openNotes() {},
    push: url => actions.push(['push', url]), editNote: (...args) => actions.push(['note', ...args]),
    openDetail: (kind, id) => actions.push(['detail', kind, id]) } });
  p.onLoad({ kind: 'course', id: 'c7' }); p.startLearning(); p.practiceNote(); p.openQuiz(); p.useTemplate();
  assert.equal(p.data.chapters.length, 4); assert.equal(p.data.progress.total, 4);
  assert.ok(p.data.item.objectives.length >= 2); assert.ok(p.data.relatedItems.length > 0);
  const practice = actions.find(action => action[0] === 'note');
  assert.equal(practice[2], 'course:c7'); assert.equal(practice[3].ownerId, 'guest');
  assert.ok(practice[3].body.includes(p.data.activeChapter.practice));
  assert.ok(actions.some(action => action[0] === 'push' && action[1] === '/pages/play/index?mode=quiz&topic=season'));
  const related = p.data.relatedItems[0]; p.openRelatedItem({ currentTarget: { dataset: related } });
  assert.deepEqual(actions.at(-1), ['detail', related.kind, related.id]);
});

test('recent reading records only a successfully loaded archive and never interrupts course reading', async () => {
  const remembered = [];
  let loads = 0;
  const { instance: p } = page('detail', { catalog: { ...catalog,
    getItem: () => ++loads === 1 ? Promise.reject(new Error('load failed')) :
      Promise.resolve({ archive: { sections: [{ title: '原文', body: '可读取的原文' }] } })
  }, reading: { remember(item) { remembered.push(item.kind + ':' + item.id); return { ok: true }; } } });
  p.onLoad({ kind: 'herb', id: 'h1' });
  await new Promise(done => setImmediate(done));
  assert.equal(remembered.length, 0);
  assert.ok(p.data.archiveError);
  p.retryArchive();
  await new Promise(done => setImmediate(done));
  p.showSection(0);
  assert.deepEqual(remembered, ['herb:h1']);
  p.onUnload();
  const { instance: course } = page('detail', { reading: { remember() { throw new Error('storage unavailable'); } } });
  course.onLoad({ kind: 'course', id: 'c1' });
  assert.doesNotThrow(() => course.startLearning());
  assert.ok(course.data.activeChapter && course.data.activeParagraphs.length);
});

test('an archive loaded while hidden records history only after its readable content is shown again', async () => {
  const remembered = [];
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { instance: p } = page('detail', { catalog: { ...catalog, getItem: () => pending },
    reading: { remember(item, scope) { remembered.push({ key: item.kind + ':' + item.id, scope }); return { ok: true }; } } });
  p.onLoad({ kind: 'herb', id: 'h1' }); p.onShow(); p.onHide();
  resolve({ archive: { sections: [{ title: '原文', body: '隐藏期间加载完成的可读正文' }] } });
  await new Promise(done => setImmediate(done));
  assert.equal(remembered.length, 0);
  assert.equal(p.data.archiveLoading, false);
  assert.ok(p.data.sectionParagraphs.length);
  p.onShow();
  assert.deepEqual(remembered, [{ key: 'herb:h1', scope: 'guest' }]);
  p.onShow(); assert.equal(remembered.length, 1);
  p.onUnload();
});

test('an archive response from the previous account does not record history in the new account until reentry', async () => {
  const remembered = [];
  let user = { id: 'student-A' }, resolve;
  const pending = new Promise(done => { resolve = done; });
  const { instance: p } = page('detail', { catalog: { ...catalog, getItem: () => pending },
    community: { getUser: () => user, listNotes: async () => ({ ok: true, total: 0 }) },
    reading: { remember(item, scope) { remembered.push({ key: item.kind + ':' + item.id, scope }); return { ok: true }; } } });
  p.onLoad({ kind: 'herb', id: 'h1' }); p.onShow();
  user = { id: 'student-B' };
  resolve({ archive: { sections: [{ title: '原文', body: '在旧账号发起加载的可读正文' }] } });
  await new Promise(done => setImmediate(done));
  assert.equal(remembered.length, 0);
  assert.ok(p.data.sectionParagraphs.length);
  p.onShow();
  assert.deepEqual(remembered, [{ key: 'herb:h1', scope: 'student-B' }]);
  p.onShow(); assert.equal(remembered.length, 1);
  p.onUnload();
});

test('course reader presents structured guidance once and preserves similar prose in the actual chapter text', () => {
  const original = catalog.findItem('course', 'c1');
  const goal = '记录观察条件。', practice = '选择一片叶子，记录叶缘。', checklist = ['写清日期', '保留不确定的问题'];
  const preserved = ['正文：不同的对象要分别记录。', '本节目标：记录观察条件。这里继续解释观察方法。',
    '动手练习：选择一片叶子，记录叶缘。也可以比较其他叶片。', '完成自检：请解释为什么要保留不确定的问题。'];
  const chapter = { ...original.chapters[0], goal, practice, checklist,
    body: ['本节目标：' + goal, preserved[0], preserved[1], '动手练习：' + practice,
      preserved[2], '完成自检：写清日期；保留不确定的问题。', preserved[3]].join('\n\n') };
  const course = { ...original, chapters: [chapter] };
  const { instance: p } = page('detail', { catalog: { ...catalog,
    findItem: (kind, id) => kind === 'course' && id === course.id ? course : catalog.findItem(kind, id) } });
  p.onLoad({ kind: 'course', id: course.id }); p.startLearning();
  assert.deepEqual(Array.from(p.data.activeParagraphs), preserved);
  assert.equal(p.data.activeChapter.goal, goal);
  assert.equal(p.data.activeChapter.practice, practice);
  assert.deepEqual(Array.from(p.data.activeChapter.checklist), checklist);
  p.onUnload();
});

test('learning-only edition shows current-scope related notes without cloud requests while demo keeps simulated notes', async t => {
  const cases = [
    { name: 'guest', user: null, notes: [{ relatedKey: 'course:c1' }, { relatedKey: 'course:c1' }, { relatedKey: 'course:c2' }], myCount: 2 },
    { name: 'formal account', user: { id: 'student-A' }, notes: [{ relatedKey: 'course:c1' }, { relatedKey: 'course:c2' }], myCount: 1 },
    { name: 'demo account', user: { id: 'demo-official', isDemo: true }, notes: [{ relatedKey: 'course:c1' }], myCount: 3 }
  ];
  for (const current of cases) await t.test(current.name, async () => {
    const requests = [], actions = [];
    const { instance: p } = page('detail', {
      config: { serviceMode: 'local' },
      community: { getUser: () => current.user, listNotes: async options => {
        requests.push(options);
        return { ok: true, total: options.scope === 'public' ? 7 : 3 };
      } },
      store: { isFavorite: () => false, getState: () => ({ notes: current.notes }),
        getGuestState: () => ({ notes: [{ relatedKey: 'course:c1' }, { relatedKey: 'course:c1' }, { relatedKey: 'course:c1' }, { relatedKey: 'course:c1' }] }),
        getProgress: item => ({ completed: [], count: 0, total: item.chapters.length, percent: 0, started: false, finished: false }) },
      navigation: { openNotes: (...args) => actions.push(args) }
    });
    p.onLoad({ kind: 'course', id: 'c1' });
    await new Promise(done => setImmediate(done));
    assert.equal(p.data.localEdition, true);
    assert.equal(p.data.myRelatedCount, current.myCount);
    assert.equal(p.data.notesCountLoading, false);
    assert.equal(p.data.publicNotesError, false);
    assert.equal(p.data.myNotesError, false);
    p.openPublicNotes(); p.openMyNotes();
    if (current.user && current.user.isDemo) {
      assert.deepEqual(requests.map(request => request.scope), ['public', 'my']);
      assert.equal(p.data.publicRelatedCount, 7);
      assert.deepEqual(actions, [['public', 'course:c1'], ['my', 'course:c1']]);
    } else {
      assert.equal(requests.length, 0);
      assert.equal(p.data.publicRelatedCount, 0);
      assert.deepEqual(actions, [['featured', 'course:c1'], ['my', 'course:c1']]);
    }
    p.onUnload();
  });
});

test('home previews four official notes and opens all public content or a playable module', () => {
  const actions = [];
  const { instance: p, changes } = page('index', { navigation: {
    push: url => actions.push(['push', url]), openNotes: scope => actions.push(['notes', scope]),
    openLibrary() {}, openDetail() {}, editNote() {} } });
  p.onShow(); assert.equal(p.data.courses.length, 9); assert.equal(p.data.editorial.length, 4); assert.equal(p.data.editorialTotal, 12);
  assert.equal(p.data.editorial[0].body, undefined);
  assert.equal(p.data.courses[0].chapters[0].body, undefined);
  changes.forEach(delta => assert.ok(Buffer.byteLength(JSON.stringify(delta)) < 32 * 1024));
  p.openOfficialNotes(); p.openPlay({ currentTarget: { dataset: { mode: 'match' } } });
  assert.deepEqual(actions, [['notes', 'featured'], ['push', '/pages/play/index?mode=match']]);
});
