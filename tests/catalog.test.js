const test = require('node:test');
const assert = require('node:assert/strict');
const { catalog, kindLabels, archiveStats, findItem, itemPath, filterCatalog } = require('../miniprogram/data/catalog');

test('public learning grows while preserving all eight original course chapter IDs', () => {
  assert.equal(catalog.length, archiveStats.entryCount + 25);
  assert.equal(new Set(catalog.map((item) => item.kind + ':' + item.id)).size, catalog.length);
  assert.deepEqual(Object.keys(kindLabels), ['course', 'herb', 'note', 'route']);
  const courses = catalog.filter((item) => item.kind === 'course');
  assert.equal(courses.length, 9);
  assert.equal(catalog.filter(item => item.kind === 'note').length, 12);
  assert.equal(catalog.filter(item => item.kind === 'route').length, 4);
  assert.equal(courses.reduce((count, course) => count + course.chapters.length, 0), 32);
  assert.deepEqual(courses.slice(0, 3).map((course) => course.chapters.map((chapter) => chapter.id)), [
    ['c1-1', 'c1-2', 'c1-3'], ['c2-1', 'c2-2', 'c2-3'], ['c3-1', 'c3-2']
  ]);
  courses.forEach((course) => course.chapters.forEach((chapter) => {
    assert.ok(chapter.title);
    assert.ok(chapter.body.length >= 220);
    assert.ok(chapter.goal && chapter.practice && chapter.checklist.length >= 2);
  }));
  courses.forEach(course => assert.ok(course.objectives.length >= 2 && course.materials.length >= 2 && course.noteTemplate));
  catalog.filter(item => ['course', 'note', 'route'].includes(item.kind)).forEach(item => {
    (item.relatedKeys || []).forEach(key => { const parts = key.split(':'); assert.ok(findItem(parts[0], parts[1]), key); });
  });
});

test('every card opens an existing unified detail item', () => {
  catalog.forEach((item) => {
    assert.equal(findItem(item.kind, item.id), item);
    assert.equal(itemPath(item), '/pages/detail/index?kind=' + item.kind + '&id=' + item.id);
    assert.ok(kindLabels[item.kind]);
    assert.ok(item.title && item.subtitle && item.category && item.description);
  });
  assert.equal(findItem('course', 'missing'), undefined);
  assert.equal(findItem('herb', 'c1'), undefined);
  assert.equal(itemPath(null), '');
  assert.equal(itemPath({ kind: 'course', id: 'missing' }), '');
});

test('search narrows by kind and matches titles, descriptions, and chapter text', () => {
  assert.equal(filterCatalog().length, catalog.length);
  ['h1', 'h2', 'h3'].forEach(id => assert.ok(findItem('herb', id)));
  assert.deepEqual(filterCatalog('herb', '  陈皮 ').map((item) => item.id), ['h2']);
  assert.deepEqual(filterCatalog('course', '藏针法').map((item) => item.id), ['c2']);
  assert.deepEqual(filterCatalog('herb', '不存在的关键词'), []);
  assert.deepEqual(filterCatalog('invalid'), []);
  assert.equal(filterCatalog('all', null).length, catalog.length);
  assert.equal(filterCatalog('all', '').length, catalog.length);
});

test('catalogue points to bundled images rather than remote URLs', () => {
  const allowed = ['/images/botanical/flowers.jpg', '/images/botanical/orange.jpg', '/images/botanical/berries.jpg', '/images/botanical/garden.jpg'];
  catalog.forEach((item) => assert.ok(item.image === '' || allowed.includes(item.image)));
});
