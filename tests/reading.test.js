const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const catalog = require('../miniprogram/data/catalog');

function fixture() {
  let scope = 'guest';
  let failRead = false;
  let failWrite = false;
  let afterScopeRead = null;
  let afterStorageRead = null;
  const data = new Map();
  const context = { module: { exports: {} }, require(name) {
    if (name === '../data/catalog') return catalog;
    if (name === './community') return { getStorageScope() {
      const captured = scope;
      const callback = afterScopeRead; afterScopeRead = null;
      if (callback) callback();
      return captured;
    } };
    throw new Error(name);
  }, wx: {
    getStorageSync(key) {
      if (failRead) throw new Error('read');
      const value = data.get(key);
      const callback = afterStorageRead; afterStorageRead = null;
      if (callback) callback();
      return value;
    },
    setStorageSync(key, value) { if (failWrite) throw new Error('write'); data.set(key, JSON.parse(JSON.stringify(value))); }
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/services/reading.js'), 'utf8'), context);
  return { reading: context.module.exports, data, scope(value) { scope = value; }, failRead(value) { failRead = value; }, failWrite(value) { failWrite = value; },
    changeAfterScopeRead(value) { afterScopeRead = () => { scope = value; }; },
    changeAfterStorageRead(value) { afterStorageRead = () => { scope = value; }; } };
}

test('recent reading resolves valid catalogue entries, deduplicates, caps at six and isolates identities', () => {
  const f = fixture();
  const items = catalog.catalog.filter(item => !item.archive).slice(0, 8);
  items.forEach(item => assert.equal(f.reading.remember(item).ok, true));
  assert.equal(f.reading.getRecent().length, 6);
  const first = items[3];
  f.reading.remember(first);
  assert.equal(f.reading.getRecent()[0].id, first.id);
  assert.equal(f.reading.getRecent().filter(item => item.id === first.id).length, 1);
  assert.equal(f.reading.remember({ kind: 'herb', id: 'unknown' }).ok, false);
  f.scope('demo-official');
  assert.equal(f.reading.getRecent().length, 0);
  f.reading.remember(items[0]);
  f.scope('user-A');
  assert.equal(f.reading.getRecent().length, 0);
  assert.equal(f.reading.clear('guest').ok, false);
  f.scope('guest');
  assert.equal(f.reading.getRecent().length, 6);
  assert.equal(f.reading.clear().ok, true);
  assert.equal(f.reading.getRecent().length, 0);
  f.scope('demo-official');
  assert.equal(f.reading.getRecent().length, 1);
});

test('failed reads or writes preserve reading history and never fabricate a successful clear', () => {
  const f = fixture();
  f.reading.remember(catalog.findItem('course', 'c1'));
  const original = JSON.stringify([...f.data]);
  f.failRead(true);
  assert.equal(f.reading.remember(catalog.findItem('course', 'c2')).ok, false);
  f.failRead(false);
  f.failWrite(true);
  assert.equal(f.reading.remember(catalog.findItem('course', 'c2')).ok, false);
  assert.equal(f.reading.clear().ok, false);
  assert.equal(JSON.stringify([...f.data]), original);
  f.failWrite(false);
  const history = f.reading.getRecent();
  history[0].title = 'changed';
  assert.notEqual(f.reading.getRecent()[0].title, 'changed');
});

test('remember rejects an account change after capturing its storage scope without writing either history', () => {
  const f = fixture();
  f.scope('user-A');
  assert.equal(f.reading.remember(catalog.findItem('course', 'c1')).ok, true);
  const original = JSON.stringify([...f.data]);
  f.changeAfterStorageRead('user-B');
  assert.equal(f.reading.remember(catalog.findItem('course', 'c2'), 'user-A').ok, false);
  assert.equal(JSON.stringify([...f.data]), original);
  assert.equal(f.reading.getRecent().length, 0);
  f.scope('user-A');
  assert.deepEqual(Array.from(f.reading.getRecent(), item => item.id), ['c1']);
});

test('clear rejects an account change after capturing its storage scope and retains both histories', () => {
  const f = fixture();
  f.scope('user-A');
  f.reading.remember(catalog.findItem('course', 'c1'));
  f.scope('user-B');
  f.reading.remember(catalog.findItem('course', 'c2'));
  f.scope('user-A');
  const original = JSON.stringify([...f.data]);
  f.changeAfterScopeRead('user-B');
  assert.equal(f.reading.clear('user-A').ok, false);
  assert.equal(JSON.stringify([...f.data]), original);
  assert.deepEqual(Array.from(f.reading.getRecent(), item => item.id), ['c2']);
  f.scope('user-A');
  assert.deepEqual(Array.from(f.reading.getRecent(), item => item.id), ['c1']);
});

test('a history read which changes account never exposes the captured identity records', () => {
  const f = fixture();
  f.scope('user-A');
  f.reading.remember(catalog.findItem('course', 'c1'));
  f.changeAfterStorageRead('user-B');
  assert.equal(f.reading.getRecent().length, 0);
  f.scope('user-A');
  assert.deepEqual(Array.from(f.reading.getRecent(), item => item.id), ['c1']);
});

test('homepage search forwards the entered query and learning card uses actual unfinished progress', () => {
  let config;
  const actions = [];
  const context = { Page(value) { config = value; }, getApp: () => ({ globalData: { networkConnected: false } }),
    require(name) {
      if (name === '../../config') return { serviceMode: 'community' };
      if (name === '../../data/catalog') return catalog;
      if (name === '../../services/store') return { isFavorite: () => false, getStats: () => ({ learning: 1 }),
        getProgress: item => ({ started: item.id === 'c1', finished: false, count: item.id === 'c1' ? 1 : 0, total: item.chapters.length }) };
      if (name === '../../services/navigation') return { openLibrary: (...args) => actions.push(args), openDetail: (...args) => actions.push(args) };
      if (name === '../../services/play') return { getSummary: () => ({ quizBest: 0, observationCount: 0, badgeCount: 0 }) };
      if (name === '../../services/reading') return { getRecent: () => [{ kind: 'note', id: 'n1', title: '最近笔记' }] };
      throw new Error(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/index/index.js'), 'utf8'), context);
  const page = { ...config, data: JSON.parse(JSON.stringify(config.data)), setData(value) { Object.assign(this.data, value); } };
  page.refresh();
  assert.equal(page.data.resume.id, 'c1');
  assert.equal(page.data.resume.caption, '已完成 1 / ' + catalog.findItem('course', 'c1').chapters.length + ' 节');
  assert.equal(page.data.offline, true);
  page.onSearchInput({ detail: { value: '  菊花  ' } });
  page.search();
  assert.deepEqual(actions[0], ['all', '菊花']);
  page.continueReading();
  assert.deepEqual(JSON.parse(JSON.stringify(actions[1])), ['course', 'c1', { resume: true }]);
});
