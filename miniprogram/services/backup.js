const community = require('./community');
const demo = require('./demo');
const { catalog, findItem } = require('../data/catalog');
const playContent = require('../data/play-content');

const FORMAT = 'baicaoyuan-local-backup';
const MAX_BYTES = 1024 * 1024;
const MAX_NOTES = 1000;
const JOURNAL_KEY = 'herb-origin:journal:v1';
const PLAY_KEY = 'herb-origin:play:v1';
const DEMO_KEY = 'herb-origin:official-demo:v1';
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const RUN_ID = /^[A-Za-z0-9_-]{8,100}$/;
const courses = catalog.filter(item => item.kind === 'course');
const clone = value => JSON.parse(JSON.stringify(value));
const unique = values => [...new Set(values)];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(error, code = 'INVALID_BACKUP') { return { ok: false, error, code }; }
function reject(message) { throw new Error(message); }
function bytes(value) {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) count += 1;
    else if (code < 0x800) count += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { count += 4; i += 1; }
    else count += 3;
  }
  return count;
}
// Check descriptors before serializing object input: accessors/toJSON must not run.
function plainData(value, seen = new Set(), depth = 0, budget = { count: 0 }) {
  if (++budget.count > 50000 || depth > 12) reject('备份结构过大或嵌套过深');
  if (typeof value === 'string' && value.length > MAX_BYTES) reject('备份字段过大');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) reject('备份必须是普通 JSON 数据');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) reject('备份必须是普通 JSON 数据');
  if (Object.getOwnPropertySymbols(value).length) reject('备份包含不支持的字段');
  if (Array.isArray(value)) {
    if (value.length > 50000 || Object.keys(value).length !== value.length || Object.keys(value).some(key => !/^\d+$/.test(key) || Number(key) >= value.length)) reject('备份数组不完整或过大');
  }
  seen.add(value);
  Object.getOwnPropertyNames(value).forEach(key => {
    if (Array.isArray(value) && key === 'length') return;
    if (['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key)) reject('备份包含不安全的字段');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) reject('备份包含不支持的字段');
    plainData(descriptor.value, seen, depth + 1, budget);
  });
  seen.delete(value);
}
function fields(value, allowed, required = allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.prototype.hasOwnProperty.call(value, key))) reject('备份字段不完整或包含不支持的数据');
}
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function text(value, max, min = 1) { return typeof value === 'string' && value.trim().length >= min && value.length <= max; }
function itemKey(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 2 && Boolean(findItem(parts[0], parts[1]));
}
function note(value, extra = []) {
  const base = ['id', 'title', 'body', 'relatedKey', 'createdAt', 'updatedAt'];
  fields(value, base.concat(extra), base);
  if (typeof value.id !== 'string' || !ID.test(value.id) || ['__proto__', 'prototype', 'constructor'].includes(value.id) ||
    !text(value.title, 80) || !text(value.body, 10000) || value.title !== value.title.trim() || value.body !== value.body.trim() || typeof value.relatedKey !== 'string' ||
    (value.relatedKey && !itemKey(value.relatedKey)) || !date(value.createdAt) || !date(value.updatedAt) || value.updatedAt < value.createdAt) reject('笔记编号、正文、关联内容或日期无效');
  if (value.visibility !== undefined && !['private', 'public'].includes(value.visibility)) reject('笔记可见范围无效');
  if (value.source !== undefined && !['local', 'demo'].includes(value.source)) reject('笔记来源无效');
  return Object.fromEntries(base.map(key => [key, value[key]]));
}
function journal(value) {
  fields(value, ['schemaVersion', 'favorites', 'learning', 'notes']);
  if (value.schemaVersion !== 1 || !Array.isArray(value.favorites) || value.favorites.length > catalog.length * 2 || value.favorites.some(key => !itemKey(key)) || !record(value.learning) || !Array.isArray(value.notes) || value.notes.length > MAX_NOTES) reject('本机学习记录的版本、收藏或笔记数量无效');
  const learning = {};
  Object.keys(value.learning).forEach(id => {
    const course = courses.find(item => item.id === id);
    const completed = value.learning[id];
    if (!course || !Array.isArray(completed) || completed.length > course.chapters.length * 2 || completed.some(chapter => !course.chapters.some(row => row.id === chapter))) reject('备份包含未知课程或章节');
    if (completed.length) learning[id] = unique(completed);
  });
  const notes = value.notes.map(valueNote => note(valueNote));
  if (new Set(notes.map(row => row.id)).size !== notes.length) reject('备份包含重复笔记编号，请先核对原文件');
  return { schemaVersion: 1, favorites: unique(value.favorites), learning, notes };
}
function emptyJournal() { return { schemaVersion: 1, favorites: [], learning: {}, notes: [] }; }
function emptyPlay() { return { schemaVersion: 1, quiz: { runs: 0, best: 0, last: null }, match: { runs: 0, bestMoves: 0, lastRunId: '' }, observations: [], openedDays: [] }; }
function integer(value, max, min = 0) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function play(value) {
  fields(value, ['schemaVersion', 'quiz', 'match', 'observations', 'openedDays']);
  fields(value.quiz, ['runs', 'best', 'last']); fields(value.match, ['runs', 'bestMoves', 'lastRunId']);
  if (value.schemaVersion !== 1 || !integer(value.quiz.runs, 1000000) || !integer(value.quiz.best, 5) ||
    !integer(value.match.runs, 1000000) || !integer(value.match.bestMoves, 1000) || typeof value.match.lastRunId !== 'string' ||
    (value.match.lastRunId && !RUN_ID.test(value.match.lastRunId)) || (value.match.bestMoves && value.match.bestMoves < 6) ||
    (!value.quiz.runs && (value.quiz.best || value.quiz.last)) || (value.quiz.runs > 0 && !value.quiz.last) ||
    (!value.match.runs && (value.match.bestMoves || value.match.lastRunId)) || (value.match.runs > 0 && (!value.match.bestMoves || !value.match.lastRunId)) ||
    !Array.isArray(value.observations) || value.observations.length > 7 || !Array.isArray(value.openedDays) || value.openedDays.length > 366) reject('游学记录格式或成绩范围无效');
  const today = Math.floor((Date.now() + 8 * 3600000) / 86400000);
  const validDay = day => integer(day, today);
  const result = clone(value);
  if (value.quiz.last !== null) {
    const last = value.quiz.last;
    fields(last, ['runId', 'ids', 'answers', 'score', 'date']);
    if (typeof last.runId !== 'string' || !RUN_ID.test(last.runId) || !Array.isArray(last.ids) || last.ids.length !== 5 || new Set(last.ids).size !== 5 || !Array.isArray(last.answers) || last.answers.length !== 5 || !date(last.date)) reject('答题记录无效');
    let score = 0;
    last.ids.forEach((id, index) => {
      const question = playContent.questions.find(row => row.id === id);
      if (!question || !integer(last.answers[index], question.options.length - 1)) reject('答题记录包含未知题目或答案');
      if (last.answers[index] === question.answer) score += 1;
    });
    if (last.score !== score || value.quiz.best < score) reject('答题分数与实际答案不一致');
  }
  value.observations.forEach(row => {
    fields(row, ['day', 'missionId', 'text', 'date']);
    if (!validDay(row.day) || !playContent.missions.some(mission => mission.id === row.missionId) || !text(row.text, 500, 20) || !date(row.date) || Math.floor((Date.parse(row.date) + 8 * 3600000) / 86400000) !== row.day) reject('观察任务、正文或日期无效');
  });
  if (new Set(value.observations.map(row => row.day)).size !== value.observations.length || new Set(value.observations.map(row => row.missionId)).size !== value.observations.length || value.openedDays.some(day => !validDay(day)) || new Set(value.openedDays).size !== value.openedDays.length) reject('观察任务或每日记录重复');
  return result;
}
function context() {
  const user = community.getUser();
  if (!user && typeof community.isDemoMode === 'function' && community.isDemoMode()) reject('演示账号记录无法读取，请检查本机存储后重试');
  const ownerId = user && user.id ? user.id : 'guest';
  return { mode: user && user.isDemo ? 'demo' : user ? 'account' : 'guest', ownerId,
    journalKey: user && user.id ? JOURNAL_KEY + ':user:' + encodeURIComponent(user.id) : JOURNAL_KEY,
    playKey: PLAY_KEY + ':' + encodeURIComponent(ownerId) };
}
function sameContext(target) { const live = context(); return live.ownerId === target.ownerId && live.mode === target.mode; }
function read(key, validate, empty) {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') reject('本机存储不可用');
  const value = wx.getStorageSync(key);
  if (value === undefined || value === null || value === '') return { raw: value, state: empty() };
  plainData(value);
  return { raw: clone(value), state: validate(value) };
}
function readDemo() {
  const saved = read(DEMO_KEY, value => {
    // Keep all original profile, avatar and editor records; restoration changes only own notes.
    if (!demo.validateBackupState(value)) reject('演示数据读取失败，请先检查本机存储');
    value.notes.filter(row => row.authorId === 'demo-official').forEach(row => note(Object.fromEntries(['id', 'title', 'body', 'relatedKey', 'createdAt', 'updatedAt', 'visibility'].map(key => [key, row[key]])), ['visibility']));
    return clone(value);
  }, () => null);
  if (!saved.state) reject('请先进入官方演示账号');
  return saved;
}
function decode(input) {
  let value = input;
  if (typeof input === 'string') {
    if (!input.trim()) reject('请提供完整的 JSON 备份');
    if (bytes(input) > MAX_BYTES) reject('备份文件不能超过 1 MB');
    try { value = JSON.parse(input); } catch (error) { reject('备份不是有效 JSON，请使用完整导出的文件或文本'); }
  }
  plainData(value);
  if (bytes(JSON.stringify(value)) > MAX_BYTES) reject('备份文件不能超过 1 MB');
  fields(value, ['app', 'format', 'version', 'exportedAt', 'mode', 'ownerId', 'state'], ['app', 'format', 'version', 'exportedAt', 'state']);
  if (value.app !== '百草源' || value.format !== FORMAT || value.version !== 1 || !date(value.exportedAt)) reject('仅支持百草源 v1 本机备份');
  if (value.mode !== undefined && (!['guest', 'account', 'demo'].includes(value.mode) || typeof value.ownerId !== 'string' || !value.ownerId || value.ownerId.length > 200)) reject('备份账号范围无效');
  if (value.mode === undefined && value.ownerId !== undefined) reject('备份账号范围不完整');
  fields(value.state, ['schemaVersion', 'favorites', 'learning', 'notes', 'play'], ['schemaVersion', 'favorites', 'learning', 'notes']);
  if (!Array.isArray(value.state.notes) || value.state.notes.length > MAX_NOTES) reject('备份笔记数量无效');
  const localNotes = [], demoNotes = [];
  value.state.notes.forEach(row => {
    const parsed = note(row, ['visibility', 'source']);
    const isDemo = row.source === 'demo' || (!row.source && /^demo-/.test(row.id));
    if (isDemo) {
      if (!/^demo-(?:my-|n-|restored-)[A-Za-z0-9_-]+$/.test(row.id) || !['private', 'public'].includes(row.visibility)) reject('只能恢复自己的演示笔记，不能导入官方编辑或其他作者内容');
      demoNotes.push({ ...parsed, visibility: row.visibility });
    } else {
      if (/^demo-/.test(row.id)) reject('本机笔记不能使用演示内容编号');
      localNotes.push(parsed);
    }
  });
  if (new Set(value.state.notes.map(row => row.id)).size !== value.state.notes.length) reject('备份包含重复笔记编号');
  return { meta: value, journal: journal({ schemaVersion: value.state.schemaVersion, favorites: value.state.favorites, learning: value.state.learning, notes: localNotes }),
    play: value.state.play === undefined ? null : play(value.state.play), demoNotes };
}
function createBackup() {
  try {
    const target = context();
    const saved = read(target.journalKey, journal, emptyJournal);
    const savedPlay = read(target.playKey, play, emptyPlay);
    let notes = saved.state.notes.map(row => ({ ...row, source: 'local' }));
    if (target.mode === 'demo') notes = notes.concat(readDemo().state.notes.filter(row => row.authorId === 'demo-official').map(row => ({ ...note(Object.fromEntries(['id', 'title', 'body', 'relatedKey', 'createdAt', 'updatedAt', 'visibility'].map(key => [key, row[key]])), ['visibility']), visibility: row.visibility, source: 'demo' })));
    if (!sameContext(target)) return fail('账号已切换，请重新导出备份', 'ACCOUNT_CHANGED');
    const backup = { app: '百草源', format: FORMAT, version: 1, exportedAt: new Date().toISOString(), mode: target.mode, ownerId: target.ownerId,
      state: { ...saved.state, play: savedPlay.state, notes } };
    if (notes.length > MAX_NOTES || bytes(JSON.stringify(backup, null, 2)) > MAX_BYTES) return fail('本机记录超过单份备份限制（1 MB 或 1000 篇笔记），请先另存重要笔记再整理记录', 'BACKUP_TOO_LARGE');
    return { ok: true, backup };
  } catch (error) { return fail('备份读取失败：' + (error.message || '请检查设备存储后重试'), 'STORAGE_READ_FAILED'); }
}
function hash(value) {
  let a = 2166136261, b = 3339675911;
  for (let i = 0; i < value.length; i += 1) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b ^ value.charCodeAt(i), 2246822519); }
  return (a >>> 0).toString(36) + '-' + (b >>> 0).toString(36);
}
function equalNote(left, right) { return ['title', 'body', 'relatedKey', 'createdAt', 'visibility'].every(key => left[key] === right[key]); }
function mergeNotes(existing, imported, make = row => row) {
  let added = 0, conflicts = 0;
  imported.forEach(row => {
    const old = existing.find(saved => saved.id === row.id);
    if (old && equalNote(old, row)) return;
    let id = row.id;
    if (old) {
      const base = row.id.slice(0, 80) + '-restored-' + hash(JSON.stringify(row));
      id = base;
      let suffix = 0;
      while (existing.some(saved => saved.id === id && !equalNote(saved, row))) id = base + '-' + (++suffix);
      if (existing.some(saved => saved.id === id)) return;
      conflicts += 1;
    }
    existing.push(make({ ...row, id })); added += 1;
  });
  return { added, conflicts };
}
function observationNote(row) {
  const mission = playContent.missions.find(item => item.id === row.missionId);
  return { id: 'observation-restored-' + hash(JSON.stringify(row)), title: '恢复的观察 · ' + (mission.title || row.missionId),
    body: '备份观察日期（北京时间）：' + new Date(row.day * 86400000).toISOString().slice(0, 10) + '\n保存时间（UTC）：' + row.date + '\n任务：' + row.missionId + ' · ' + (mission.title || row.missionId) + '\n\n' + row.text,
    relatedKey: mission.relatedKey || '', createdAt: row.date, updatedAt: row.date };
}
function planPlay(existing, imported, exportedAt) {
  const next = clone(existing), copies = [], gameCopies = [];
  if (!imported) return { next, copies, gameCopies, added: 0 };
  next.quiz.runs = Math.max(next.quiz.runs, imported.quiz.runs); next.quiz.best = Math.max(next.quiz.best, imported.quiz.best);
  // A summary stores only one last attempt. Keep the current attempt when it exists.
  if (!next.quiz.last) next.quiz.last = imported.quiz.last;
  else if (imported.quiz.last && JSON.stringify(next.quiz.last) !== JSON.stringify(imported.quiz.last)) {
    const last = imported.quiz.last;
    gameCopies.push({ id: 'play-restored-quiz-' + hash(JSON.stringify(last)), title: '恢复的知识闯关记录',
      body: '当前最近一轮保持不变。这是备份中的答题记录，保留供查阅；不重复增加答题次数。\n\n' + JSON.stringify(last, null, 2),
      relatedKey: '', createdAt: last.date, updatedAt: last.date });
  }
  next.match.runs = Math.max(next.match.runs, imported.match.runs);
  next.match.bestMoves = next.match.bestMoves && imported.match.bestMoves ? Math.min(next.match.bestMoves, imported.match.bestMoves) : next.match.bestMoves || imported.match.bestMoves;
  if (!next.match.lastRunId) next.match.lastRunId = imported.match.lastRunId;
  else if (imported.match.lastRunId && next.match.lastRunId !== imported.match.lastRunId) {
    gameCopies.push({ id: 'play-restored-match-' + hash(JSON.stringify(imported.match)), title: '恢复的术语配对汇总',
      body: '当前最近一轮保持不变。这是备份中的配对汇总，保留供查阅；不重复增加完成次数。\n备份导出时间（不是游戏时间）：' + exportedAt + '\n\n' + JSON.stringify(imported.match, null, 2),
      relatedKey: '', createdAt: exportedAt, updatedAt: exportedAt });
  }
  let added = 0;
  imported.observations.forEach(row => {
    const conflict = next.observations.find(saved => saved.day === row.day || saved.missionId === row.missionId);
    if (!conflict) { next.observations.push(clone(row)); added += 1; }
    else if (conflict.day !== row.day || conflict.missionId !== row.missionId || conflict.text !== row.text) copies.push(observationNote(row));
  });
  next.openedDays = unique(next.openedDays.concat(imported.openedDays)).sort((a, b) => a - b);
  if (next.openedDays.length > 366) reject('合并后的灵感日期超过 366 天；为保留全部数据，本次恢复未执行，请保留原备份');
  return { next, copies, gameCopies, added };
}
function importBackup(input) {
  let imported;
  try { imported = decode(input); } catch (error) { return fail(error.message || '备份数据无效'); }
  let target;
  try { target = context(); } catch (error) { return fail('无法读取当前账号，请刷新后重试', 'STORAGE_READ_FAILED'); }
  if (imported.meta.mode !== undefined && (imported.meta.mode !== target.mode || imported.meta.ownerId !== target.ownerId)) return fail('这份备份属于其他账号范围，请先自行切换到原账号再恢复。恢复不会切换账号', 'BACKUP_OWNER_MISMATCH');
  if (imported.demoNotes.length && target.mode !== 'demo') return fail('备份含演示笔记，请先进入官方演示账号再恢复', 'DEMO_REQUIRED');
  const summary = { favoritesAdded: 0, chaptersAdded: 0, notesAdded: 0, demoNotesAdded: 0, observationsAdded: 0, observationCopies: 0, gameCopies: 0, noteConflicts: 0 };
  const restored = [], plans = [];
  try {
    const saved = read(target.journalKey, journal, emptyJournal);
    const savedPlay = read(target.playKey, play, emptyPlay);
    const savedDemo = target.mode === 'demo' && imported.demoNotes.length ? readDemo() : null;
    const next = clone(saved.state);
    next.favorites = unique(next.favorites.concat(imported.journal.favorites));
    summary.favoritesAdded = next.favorites.length - saved.state.favorites.length;
    Object.keys(imported.journal.learning).forEach(id => {
      const before = next.learning[id] || [];
      next.learning[id] = unique(before.concat(imported.journal.learning[id]));
      summary.chaptersAdded += next.learning[id].length - before.length;
    });
    const played = planPlay(savedPlay.state, imported.play, imported.meta.exportedAt);
    const notes = mergeNotes(next.notes, imported.journal.notes.concat(played.copies, played.gameCopies));
    summary.notesAdded = notes.added; summary.noteConflicts = notes.conflicts;
    summary.observationsAdded = played.added; summary.observationCopies = played.copies.length;
    summary.gameCopies = played.gameCopies.length;
    if (next.notes.length > MAX_NOTES || bytes(JSON.stringify(next)) > MAX_BYTES) reject('合并后的本机笔记超过存储保护限制，本次恢复未执行，请保留原备份');
    plans.push({ name: '收藏、课程与本机笔记', key: target.journalKey, before: saved.raw, next });
    if (imported.play) plans.push({ name: '游学记录', key: target.playKey, before: savedPlay.raw, next: played.next });
    if (savedDemo) {
      const restoredDemo = clone(savedDemo.state);
      const merged = mergeNotes(restoredDemo.notes, imported.demoNotes, row => ({ ...row, authorId: 'demo-official', viewCount: 0, likeCount: 0, favoriteCount: 0, liked: false, favorite: false, lastViewDay: '', viewKeys: [] }));
      summary.demoNotesAdded = merged.added; summary.noteConflicts += merged.conflicts;
      if (restoredDemo.notes.length > MAX_NOTES || bytes(JSON.stringify(restoredDemo)) > MAX_BYTES) reject('合并后的演示笔记超过存储保护限制，本次恢复未执行，请保留原备份');
      plans.push({ name: '自己的演示笔记', key: DEMO_KEY, before: savedDemo.raw, next: restoredDemo });
    }
  } catch (error) { return { ...fail('恢复准备失败：' + (error.message || '本机数据读取失败'), 'RESTORE_PREPARE_FAILED'), summary, restored, partial: false }; }
  for (const plan of plans) {
    let savedWithoutVerification = false;
    try {
      if (!sameContext(target)) reject('账号已切换，请刷新后重试');
      const current = wx.getStorageSync(plan.key);
      if (JSON.stringify(current) !== JSON.stringify(plan.before)) reject('本机记录已变化，请重新恢复以合并最新内容');
      if (JSON.stringify(current) !== JSON.stringify(plan.next)) {
        wx.setStorageSync(plan.key, clone(plan.next));
        savedWithoutVerification = true;
        // Read-back distinguishes a persisted write from a storage adapter which silently fails.
        if (JSON.stringify(wx.getStorageSync(plan.key)) !== JSON.stringify(plan.next)) reject('保存后校验失败，请检查设备存储并重试');
      }
      if (plan.key === DEMO_KEY) demo.refreshBackupCache();
      restored.push(plan.name);
    } catch (error) {
      const prefix = restored.length ? '部分记录已恢复（' + restored.join('、') + '）。' : '恢复未完成。';
      const uncertain = savedWithoutVerification ? '该模块可能已保存，但未能确认读取结果。' : '';
      return { ...fail(prefix + plan.name + '恢复失败：' + (error.message || '请检查设备存储') + '。' + uncertain + '请保留备份；已合并内容可安全重试，不会重复新增', 'STORAGE_WRITE_FAILED'), summary, restored, partial: restored.length > 0 || savedWithoutVerification, uncertain: savedWithoutVerification ? plan.name : '' };
    }
  }
  const details = '新增 ' + summary.favoritesAdded + ' 项收藏、' + summary.chaptersAdded + ' 节进度、' + (summary.notesAdded + summary.demoNotesAdded) + ' 篇笔记、' + summary.observationsAdded + ' 条观察。';
  const conflicts = summary.observationCopies ? '观察任务或日期冲突的 ' + summary.observationCopies + ' 条正文已保留为本机笔记。' : '';
  const noteConflicts = summary.noteConflicts ? '同编号不同内容的笔记保留为独立副本。' : '';
  const gameCopies = summary.gameCopies ? '备份中不同的最近一轮记录已保留为本机笔记。' : '';
  const legacy = imported.meta.mode === undefined ? '旧版备份未标记账号，内容已合并至当前本机范围。' : '';
  return { ok: true, message: '本机恢复完成。' + details + conflicts + noteConflicts + gameCopies + '重复内容已去重；游学次数取较大值，保留当前最近一轮。' + legacy + '恢复不会上传或修改云端笔记。', summary, restored, partial: false };
}

module.exports = { createBackup, importBackup, MAX_BYTES };
