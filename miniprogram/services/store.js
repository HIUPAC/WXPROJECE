const { catalog, findItem } = require('../data/catalog');
const community = require('./community');

const STORAGE_KEY = 'herb-origin:journal:v1';
const STORAGE_ERROR = '保存失败，请检查设备存储空间后重试';
const courses = catalog.filter((item) => item.kind === 'course');

function emptyState() {
  return { schemaVersion: 1, favorites: [], learning: {}, notes: [] };
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function itemKey(itemOrKey) {
  if (typeof itemOrKey === 'string') {
    const parts = itemOrKey.split(':');
    return parts.length === 2 && findItem(parts[0], parts[1]) ? itemOrKey : '';
  }
  if (!isRecord(itemOrKey) || !findItem(itemOrKey.kind, itemOrKey.id)) return '';
  return itemOrKey.kind + ':' + itemOrKey.id;
}

function unique(values) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function normalizeNote(value) {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 120) return null;
  if (typeof value.title !== 'string' || typeof value.body !== 'string') return null;
  const title = value.title.trim();
  const body = value.body.trim();
  if (!title || title.length > 80 || !body || body.length > 10000) return null;
  if (!validDate(value.createdAt) || !validDate(value.updatedAt)) return null;
  const relatedKey = value.relatedKey ? itemKey(value.relatedKey) : '';
  return { id: value.id, title, body, relatedKey, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

function normalizeState(value) {
  const state = emptyState();
  if (!isRecord(value) || value.schemaVersion !== 1) return state;
  if (Array.isArray(value.favorites)) {
    state.favorites = unique(value.favorites.map(itemKey).filter(Boolean));
  }
  if (isRecord(value.learning)) {
    courses.forEach((course) => {
      if (!Array.isArray(value.learning[course.id])) return;
      const validIds = course.chapters.map((chapter) => chapter.id);
      const completed = unique(value.learning[course.id].filter((id) => validIds.indexOf(id) !== -1));
      if (completed.length) state.learning[course.id] = completed;
    });
  }
  if (Array.isArray(value.notes)) {
    value.notes.forEach((valueNote) => {
      const note = normalizeNote(valueNote);
      if (note && !state.notes.some((saved) => saved.id === note.id)) state.notes.push(note);
    });
  }
  return state;
}

function storageKey() {
  const user = community.getUser();
  return user && user.id ? STORAGE_KEY + ':user:' + encodeURIComponent(user.id) : STORAGE_KEY;
}

function readState(key) {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return { ok: false, state: emptyState() };
    const resolvedKey = key || storageKey();
    return { ok: true, key: resolvedKey, state: normalizeState(wx.getStorageSync(resolvedKey)) };
  } catch (error) {
    return { ok: false, state: emptyState() };
  }
}

function getState() {
  return readState().state;
}

function getGuestState() {
  return readState(STORAGE_KEY).state;
}

function getGuestNote(id) {
  return getGuestState().notes.find((note) => note.id === id) || null;
}

function writeState(state, key) {
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return { ok: false, error: STORAGE_ERROR };
    wx.setStorageSync(key || storageKey(), copy(state));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: STORAGE_ERROR };
  }
}

function isFavorite(itemOrKey) {
  const key = itemKey(itemOrKey);
  return Boolean(key && getState().favorites.indexOf(key) !== -1);
}

function toggleFavorite(itemOrKey) {
  const key = itemKey(itemOrKey);
  if (!key) return { ok: false, error: '找不到这条内容' };
  const read = readState();
  if (!read.ok) return { ok: false, error: STORAGE_ERROR };
  const state = read.state;
  const index = state.favorites.indexOf(key);
  const favorite = index === -1;
  if (favorite) state.favorites.push(key);
  else state.favorites.splice(index, 1);
  const saved = writeState(state, read.key);
  return saved.ok ? { ok: true, key, favorite } : saved;
}

function resolveCourse(courseOrId) {
  const id = typeof courseOrId === 'string' ? courseOrId : courseOrId && courseOrId.id;
  return findItem('course', id);
}

function progressFromState(course, state) {
  const completed = course ? (state.learning[course.id] || []).slice() : [];
  const total = course ? course.chapters.length : 0;
  const count = completed.length;
  return { completed, count, total, percent: total ? Math.round(count / total * 100) : 0, started: count > 0, finished: total > 0 && count === total };
}

function getProgress(courseOrId) {
  return progressFromState(resolveCourse(courseOrId), getState());
}

function completeChapter(courseId, chapterId) {
  const course = resolveCourse(courseId);
  if (!course || !course.chapters.some((chapter) => chapter.id === chapterId)) {
    return { ok: false, error: '找不到这个课程章节' };
  }
  const read = readState();
  if (!read.ok) return { ok: false, error: STORAGE_ERROR };
  const state = read.state;
  const completed = state.learning[course.id] || [];
  if (completed.indexOf(chapterId) !== -1) return { ok: true, progress: progressFromState(course, state) };
  state.learning[course.id] = completed.concat(chapterId);
  const saved = writeState(state, read.key);
  return saved.ok ? { ok: true, progress: progressFromState(course, state) } : saved;
}

function saveNote(input) {
  if (!isRecord(input) || typeof input.title !== 'string' || typeof input.body !== 'string') return { ok: false, error: '请填写笔记标题与正文' };
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) return { ok: false, error: '请填写笔记标题与正文' };
  if (title.length > 80) return { ok: false, error: '标题最多 80 字' };
  if (body.length > 10000) return { ok: false, error: '正文最多 10000 字' };
  if (input.id !== undefined && (typeof input.id !== 'string' || !input.id)) return { ok: false, error: '笔记编号无效' };
  if (input.relatedKey !== undefined && typeof input.relatedKey !== 'string') return { ok: false, error: '关联内容无效' };
  if (input.relatedKey && !itemKey(input.relatedKey)) return { ok: false, error: '关联内容无效' };
  const read = readState();
  if (!read.ok) return { ok: false, error: STORAGE_ERROR };
  const state = read.state;
  const existing = input.id ? state.notes.find((note) => note.id === input.id) : null;
  if (input.id && !existing) return { ok: false, error: '找不到这篇笔记，可能已被删除' };
  const now = new Date().toISOString();
  let id = existing ? existing.id : 'note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  while (!existing && state.notes.some((note) => note.id === id)) id += 'x';
  const relatedKey = input.relatedKey === undefined ? (existing ? existing.relatedKey : '') : input.relatedKey;
  const note = { id, title, body, relatedKey, createdAt: existing ? existing.createdAt : now, updatedAt: now };
  if (existing) state.notes[state.notes.findIndex((saved) => saved.id === existing.id)] = note;
  else state.notes.unshift(note);
  const saved = writeState(state, read.key);
  return saved.ok ? { ok: true, note: copy(note) } : saved;
}

function deleteNote(id) {
  if (typeof id !== 'string' || !id) return { ok: false, error: '笔记编号无效' };
  const read = readState();
  if (!read.ok) return { ok: false, error: STORAGE_ERROR };
  const state = read.state;
  const index = state.notes.findIndex((note) => note.id === id);
  if (index === -1) return { ok: false, error: '找不到这篇笔记，可能已被删除' };
  state.notes.splice(index, 1);
  return writeState(state, read.key);
}

function getNote(id) {
  return getState().notes.find((note) => note.id === id) || null;
}

function getStats() {
  const state = getState();
  const progress = courses.map((course) => progressFromState(course, state));
  return { favorites: state.favorites.length, notes: state.notes.length, learning: progress.filter((item) => item.started && !item.finished).length, completed: progress.filter((item) => item.finished).length };
}

module.exports = { getState, getGuestState, getGuestNote, isFavorite, toggleFavorite, getProgress, completeChapter, saveNote, deleteNote, getNote, getStats };
