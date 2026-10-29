const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const directory = require('../miniprogram/data/archive-index');
const catalog = require('../miniprogram/data/catalog');
const manifest = require('../docs/bencao-source-manifest.json');
const audit = require('../docs/bencao-extraction-audit.json');
function moduleWithLoader(load) {
  const filename = path.resolve(__dirname, '../miniprogram/data/archive-catalog.js');
  const local = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require(name) { return name === './archive-loaders' ? { load } : local(name); }
  }, { filename });
  return module.exports;
}
function shard(name) { return require('../miniprogram/' + name + '/data'); }

test('all 48 medicinal volumes and every split source page are bundled with immutable attribution', () => {
  assert.equal(directory.stats.departmentCount, 16);
  assert.equal(directory.stats.volumeCount, 48);
  assert.equal(directory.pages.length, manifest.pages.length);
  assert.equal(directory.pages.length, 60);
  assert.deepEqual([...new Set(directory.pages.map(page => page[1]))].sort((a, b) => a - b), Array.from({ length: 48 }, (_, i) => i + 5));
  directory.pages.forEach(([part, volume, revision, pack]) => {
    const source = manifest.pages.find(page => page.part === part);
    assert.equal(source.revisionId, revision);
    assert.equal(source.volume, volume);
    assert.ok(shard(pack)[part].includes('本草綱目') || shard(pack)[part].includes('夲草綱目'));
    assert.equal(createHash('sha256').update(shard(pack)[part], 'utf8').digest('hex'), source.normalizedTextSha256);
  });
  assert.equal(catalog.filterCatalog('herb').length, audit.entryCount);
  assert.equal(directory.rows.filter(row => row[7] === 'unapplied').length, 153);
  assert.ok(directory.rows.some(row => row[2] === '牛領藤'));
  assert.ok(directory.rows.some(row => row[2] === '石肺'));
  assert.ok(directory.rows.some(row => row[2] === '新雉木'));
});

test('all original body ranges fit JavaScript UTF-16 offsets; gaps remain visible records', () => {
  const pages = new Map(directory.pages.map(page => [page[0], page]));
  let gaps = 0;
  directory.rows.forEach(row => {
    const page = pages.get(row[4]);
    const text = shard(page[3])[row[4]];
    if (row[9] < 0) { gaps++; assert.notEqual(row[11], 'matched'); return; }
    const start = page[4] + row[9];
    const end = page[4] + row[10];
    assert.ok(start >= 0 && end > start && end <= text.length, row[2]);
    assert.ok(!/^[\uDC00-\uDFFF]/.test(text.slice(start, end)), row[2]);
  });
  assert.equal(gaps, audit.unmatched.length);
});

test('title search accepts original/simplified names, common aliases and department filters', () => {
  assert.ok(catalog.queryCatalog({ kind: 'herb', query: '黄芪' }).items.some(item => item.archive.originalTitle === '黄耆'));
  assert.ok(catalog.queryCatalog({ kind: 'herb', query: '黃芪' }).items.some(item => item.archive.originalTitle === '黄耆'));
  assert.equal(catalog.queryCatalog({ kind: 'herb', query: '陳皮' }).items[0].id, 'h2');
  assert.ok(catalog.queryCatalog({ kind: 'herb', query: '天麻' }).total > 0);
  assert.ok(catalog.queryCatalog({ kind: 'herb', query: '白芍' }).items.some(item => item.archive.originalTitle === '芍藥'));
  assert.ok(catalog.queryCatalog({ kind: 'herb', query: '蒼術' }).items.some(item => item.archive.originalTitle === '术'));
  const plants = catalog.queryCatalog({ kind: 'herb', botanicalOnly: true, limit: 100 });
  assert.ok(plants.total > 900);
  plants.items.forEach(item => assert.ok(['草部', '谷部', '菜部', '果部', '木部'].includes(item.archive.department)));
  assert.equal(catalog.queryCatalog({ kind: 'herb', botanicalOnly: true, department: '金石部' }).total, 0);
  const filters = catalog.getArchiveFilters('草部', true);
  assert.equal(filters.departments.length, 6);
  assert.ok(filters.categories.some(item => item.value === '芳草类'));
});

test('pagination returns lightweight disjoint batches and can traverse the complete directory', () => {
  const seen = new Set();
  for (let offset = 0; offset < directory.stats.entryCount; offset += 20) {
    const result = catalog.queryCatalog({ kind: 'herb', offset, limit: 20 });
    result.items.forEach(item => {
      assert.ok(!seen.has(item.id)); seen.add(item.id);
      assert.equal(item.body, undefined);
      assert.equal(item.archive.sections, undefined);
    });
    assert.ok(Buffer.byteLength(JSON.stringify(result.items)) < 32 * 1024);
  }
  assert.equal(seen.size, directory.stats.entryCount);
});

test('original entries load on demand, coalesce concurrent requests and retain old favorite IDs', async () => {
  const calls = [];
  const data = moduleWithLoader(name => { calls.push(name); return Promise.resolve(shard(name)); });
  const [first, same] = await Promise.all([data.getItem('herb', 'h1'), data.getItem('herb', 'h1')]);
  assert.equal(calls.length, 1);
  assert.equal(first.archive.sections[0].body.slice(0, 1), '菊');
  assert.equal(first.archive.sections[0].body, same.archive.sections[0].body);
  for (const id of ['h2', 'h3']) {
    const item = await data.getItem('herb', id);
    assert.ok(item.archive.sections.length > 2);
    item.archive.sections.forEach(section => assert.ok(Array.from(section.body).length <= 2600));
  }
  const course = await data.getItem('course', 'c1');
  assert.equal(course.chapters.length, 3);
  assert.equal(await data.getItem('herb', 'missing'), undefined);
  const split = await data.getVolume('卷12下');
  assert.ok(split.some(section => section.title.startsWith('卷12 ·')));
  assert.ok(split.some(section => section.title.startsWith('卷12上 ·')));
  assert.ok(split.some(section => section.title.startsWith('卷12下 ·')));
});

test('failed asynchronous loading can retry and documented source gaps are never fabricated', async () => {
  let failures = 1;
  const data = moduleWithLoader(name => failures-- > 0 ? Promise.reject(new Error('network failed')) : Promise.resolve(shard(name)));
  await assert.rejects(data.getItem('herb', 'h1'), /network failed/);
  assert.ok((await data.getItem('herb', 'h1')).archive.sections.length);
  const gap = directory.rows.find(row => row[11] === 'source-gap');
  assert.ok(gap);
  const item = await data.getItem('herb', gap[0]);
  assert.equal(item.archive.sections[0].title, '校录说明');
  assert.ok(item.archive.sections[0].body.includes('未补写'));
});

test('every matched archive opens nonempty text while metadata remains light', async () => {
  const data = moduleWithLoader(name => Promise.resolve(shard(name)));
  for (const row of directory.rows) {
    const item = await data.getItem('herb', row[0]);
    assert.ok(item.archive.sections.length, row[2]);
    assert.equal(data.findItem('herb', row[0]).archive.sections, undefined);
    assert.ok(item.archive.sections.every(section => section.body.length > 0));
  }
});
