const original = require('./learning-catalog');
const index = require('./archive-index');
const loaders = require('./archive-loaders');
const archiveStats = index.stats;
const kindLabels = original.kindLabels;
const sourceTitle = index.stats.sourceTitle;
const pageMap = new Map(index.pages.map(row => [row[0], { part: row[0], volume: row[1], revisionId: row[2], shard: row[3], bodyOffset: row[4] || 0 }]));
const references = new Map();
const oldHerbs = new Map(original.catalog.filter(item => item.kind === 'herb').map(item => [item.id, item]));
const botanical = ['草部', '谷部', '菜部', '果部', '木部'];
function pageUrl(part, revisionId) {
  return 'https://zh.wikisource.org/w/index.php?title=' + encodeURIComponent(sourceTitle + '/' + part) + '&oldid=' + revisionId;
}
const herbs = index.rows.map(row => {
  const [id, title, originalTitle, volume, part, dept, cat, entryType, aliases, start, end, status] = row;
  const page = pageMap.get(part);
  references.set(id, { part, start, end });
  const archive = {
    originalTitle, book: '本草纲目（四库全书本）', volume, part,
    department: index.departments[dept], category: index.categories[cat],
    entryType, aliases, status, revisionId: page.revisionId,
    sourceUrl: pageUrl(part, page.revisionId), sourceLabel: '李时珍 · 维基文库校录', license: archiveStats.license
  };
  const old = oldHerbs.get(id);
  return { id, kind: 'herb', title, subtitle: '本草纲目 · 卷' + volume,
    category: archive.department + ' · ' + archive.category, image: old ? old.image : '',
    description: '原书部类与名称，附卷次、原文和出处。', body: '', archive };
});
// Stable public IDs preserve existing favorites and related notes.
const catalog = original.catalog.filter(item => item.kind !== 'herb').concat(herbs);
const itemMap = new Map(catalog.map(item => [item.kind + ':' + item.id, item]));
function findItem(kind, id) { return itemMap.get(kind + ':' + id); }
function itemPath(item) {
  if (!item || !findItem(item.kind, item.id)) return '';
  return '/pages/detail/index?kind=' + encodeURIComponent(item.kind) + '&id=' + encodeURIComponent(item.id);
}
function normalizeSearch(text) {
  return Array.from(text.toLowerCase()).map(char => index.searchMap[char] || char).join('');
}
const searchText = new Map(catalog.map(item => [item.kind + ':' + item.id,
  normalizeSearch([item.title, item.subtitle, item.category, item.description, item.body,
    item.archive ? item.archive.originalTitle + ' ' + item.archive.aliases.join(' ') : '',
    ...(item.chapters || []).map(chapter => chapter.title + ' ' + chapter.body)]
    .filter(Boolean).join(' '))]));
function matches(options) {
  const kind = options.kind || 'all';
  const query = typeof options.query === 'string' ? normalizeSearch(options.query.trim()) : '';
  return catalog.filter(item => {
    if (kind !== 'all' && item.kind !== kind) return false;
    if (options.botanicalOnly && (!item.archive || !botanical.includes(item.archive.department))) return false;
    if (options.department && options.department !== 'all' && (!item.archive || item.archive.department !== options.department)) return false;
    if (options.category && options.category !== 'all' && (!item.archive || item.archive.category !== options.category)) return false;
    return !query || searchText.get(item.kind + ':' + item.id).includes(query);
  });
}
function filterCatalog(kind = 'all', query = '') { return matches({ kind, query }); }
function summary(item) {
  const { body, chapters, ...light } = item;
  if (chapters) light.chapters = chapters.map(chapter => ({ id: chapter.id, title: chapter.title }));
  return light;
}
function queryCatalog(options = {}) {
  const filtered = matches(options);
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 20)));
  return { items: filtered.slice(offset, offset + limit).map(summary), total: filtered.length,
    offset, hasMore: offset + limit < filtered.length };
}
function getArchiveFilters(department = 'all', botanicalOnly = false) {
  const eligible = herbs.filter(item => !botanicalOnly || botanical.includes(item.archive.department));
  function counts(field, entries, label) {
    const result = [{ value: 'all', label, count: entries.length }];
    const values = new Map();
    entries.forEach(item => { const value = item.archive[field]; values.set(value, (values.get(value) || 0) + 1); });
    values.forEach((count, value) => result.push({ value, label: value, count }));
    return result;
  }
  return { departments: counts('department', eligible, '全部部类'),
    categories: counts('category', eligible.filter(item => department === 'all' || item.archive.department === department), '全部分类') };
}
const packageCache = new Map();
function loadPart(part) {
  const page = pageMap.get(part);
  if (!page) return Promise.reject(new Error('原文卷次不存在'));
  let pending = packageCache.get(page.shard);
  if (!pending) {
    pending = Promise.resolve().then(() => loaders.load(page.shard)).then(module => module.default || module);
    packageCache.set(page.shard, pending);
    pending.catch(() => { if (packageCache.get(page.shard) === pending) packageCache.delete(page.shard); });
  }
  return pending.then(texts => {
    if (typeof texts[part] !== 'string') throw new Error('原文资料不完整');
    return texts[part];
  });
}
function sections(body) {
  const result = [];
  let title = '原文';
  let lines = [];
  function flush() {
    const text = lines.join('\n').trim();
    if (!text) return;
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i += 2600) result.push({ title: title + (chars.length > 2600 ? ' · ' + (Math.floor(i / 2600) + 1) : ''), body: chars.slice(i, i + 2600).join('') });
    lines = [];
  }
  body.split('\n').forEach(line => {
    const head = /^(釋名|集解|集觧|正誤|辨疑|修治|脩治|氣味|主治|發明|附方|附[錄録])/.exec(line);
    if (head && lines.length) flush();
    if (head) title = head[1];
    lines.push(line);
  });
  flush();
  return result;
}
function getItem(kind, id) {
  const item = findItem(kind, id);
  if (!item || !item.archive) return Promise.resolve(item);
  const ref = references.get(id);
  if (ref.start < 0) {
    const body = item.archive.status === 'source-gap'
      ? '本条保留原书目录中的名称。所用校录本标有“缺”，未补写缺失正文。可阅读本卷原文核对。'
      : '本条保留原书目录中的名称。校录本中未能定位独立正文标题，未推测或补写内容。可阅读本卷完整原文核对。';
    return Promise.resolve({ ...item, archive: { ...item.archive, sections: [{ title: '校录说明', body }] } });
  }
  const base = pageMap.get(ref.part).bodyOffset;
  return loadPart(ref.part).then(text => ({ ...item, archive: { ...item.archive, sections: sections(text.slice(base + ref.start, base + ref.end)) } }));
}
function getVolume(part) {
  const base = part.slice(0, 3);
  const parts = pageMap.has(base + '上') ? [base, base + '上', base + '下'] : [base];
  return Promise.all(parts.map(current => loadPart(current).then(text => sections(text).map(section => ({ ...section, title: current + ' · ' + section.title }))))).then(groups => [].concat(...groups));
}
module.exports = { catalog, kindLabels, archiveStats, findItem, itemPath, filterCatalog, queryCatalog, getArchiveFilters, getItem, getVolume };
