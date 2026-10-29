const { findItem } = require('../data/catalog');

const STORAGE_KEY = 'herb-origin:official-demo:v1';
const USER_ID = 'demo-official';
const EDITOR_ID = 'demo-editor';
const STORAGE_ERROR = '演示数据保存失败，请检查设备存储空间后重试';
let cachedState;

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function avatarText(name) {
  const first = String(name || '').match(/[\u3400-\u9fffA-Za-z]/);
  return (first ? first[0] : Array.from(name || '')[0] || '草').toUpperCase();
}
function seed() {
  const timestamp = new Date().toISOString();
  const note = (id, authorId, title, body, visibility, relatedKey) => ({
    id, authorId, title, body, visibility, relatedKey, createdAt: timestamp, updatedAt: timestamp,
    viewCount: 0, likeCount: 0, favoriteCount: 0, liked: false, favorite: false, lastViewDay: '', viewKeys: []
  });
  return {
    schemaVersion: 1,
    user: { id: USER_ID, isDemo: true, username: '百草源官方演示', studentId: '', phone: '',
      avatarUrl: '', avatarText: '百', tags: ['本草学习', '草木观察'], bio: '从一片叶子开始，慢慢认识草木。' },
    avatarFiles: [],
    notes: [
      note('demo-my-private', USER_ID, '我的第一篇草木手记',
        '这是官方演示账号的私密笔记。\n你可以修改标题和正文，选择私密或公共，体验笔记保存与统计。\n演示笔记和互动保存在当前设备，退出后再次进入仍可继续编辑。', 'private', 'course:c1'),
      note('demo-my-public', USER_ID, '校园菊花观察 · 演示笔记',
        '今天先观察花朵的颜色，再记录叶片的轮廓和叶缘。\n这是演示列表中的公共笔记，可试试点赞、收藏和切换可见范围。\n演示中的公开操作只影响本机演示列表。使用正式账号后，才可以向其他用户分享真实笔记。', 'public', 'herb:h1'),
      note('demo-editor-observation', EDITOR_ID, '怎样把一次观察写成笔记 · 官方示例',
        '先写下时间与地点，再记录颜色、形态和纹理，最后留下待确认的问题。\n将笔记关联到本草档案或课程，便于以后从阅读内容返回记录。\n这是官方示例文章。你可以浏览、点赞和收藏；浏览计数按每天一次记录。', 'public', 'course:c1')
    ]
  };
}
function validState(state) {
  if (!state || state.schemaVersion !== 1 || !state.user || state.user.id !== USER_ID ||
    typeof state.user.username !== 'string' || !state.user.username.trim() ||
    typeof state.user.bio !== 'string' || typeof state.user.avatarUrl !== 'string' ||
    !Array.isArray(state.user.tags) || state.user.tags.some(tag => typeof tag !== 'string') ||
    !Array.isArray(state.avatarFiles) || state.avatarFiles.some(file => typeof file !== 'string') || !Array.isArray(state.notes)) return false;
  const ids = new Set();
  return state.notes.every(note => {
    if (!note || typeof note.id !== 'string' || !note.id || ids.has(note.id) ||
      ![USER_ID, EDITOR_ID].includes(note.authorId) || !['private', 'public'].includes(note.visibility) ||
      typeof note.title !== 'string' || typeof note.body !== 'string' || typeof note.relatedKey !== 'string' ||
      !Number.isFinite(Date.parse(note.createdAt)) || !Number.isFinite(Date.parse(note.updatedAt)) ||
      !['viewCount', 'likeCount', 'favoriteCount'].every(field => Number.isSafeInteger(note[field]) && note[field] >= 0) ||
      typeof note.liked !== 'boolean' || typeof note.favorite !== 'boolean' || typeof note.lastViewDay !== 'string' ||
      !Array.isArray(note.viewKeys) || note.viewKeys.some(key => typeof key !== 'string')) return false;
    ids.add(note.id);
    return true;
  });
}
function read() {
  if (cachedState) return { ok: true, state: copy(cachedState) };
  try {
    const saved = wx.getStorageSync(STORAGE_KEY);
    if (!saved) return { ok: true, state: null };
    if (!validState(saved)) {
      return { ok: false, error: '演示数据读取失败，请检查本机存储' };
    }
    cachedState = copy(saved);
    return { ok: true, state: copy(cachedState) };
  } catch (error) { return { ok: false, error: '演示数据读取失败，请检查本机存储' }; }
}
function write(state) {
  try {
    wx.setStorageSync(STORAGE_KEY, copy(state));
    cachedState = copy(state);
    return { ok: true };
  } catch (error) { return { ok: false, error: STORAGE_ERROR }; }
}
function initialize() {
  const result = read();
  if (!result.ok) return result;
  if (!result.state) {
    const saved = write(seed());
    if (!saved.ok) return saved;
  }
  return { ok: true, user: getUser() };
}
function getUser() {
  const result = read();
  return result.ok && result.state ? { ...copy(result.state.user), isDemo: true } : null;
}
function visible(note) { return note && (note.visibility === 'public' || note.authorId === USER_ID); }
function viewDay() { return Math.floor((Date.now() + 8 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000)); }
function todayViews(note) { return note.lastViewDay === String(viewDay()) && note.viewCount > 0 ? 1 : 0; }
function author(state, id) {
  const user = id === USER_ID ? state.user : { id: EDITOR_ID, username: '百草源官方示例', avatarUrl: '', avatarText: '百', tags: ['官方示例'], bio: '用于演示笔记阅读与互动。' };
  return { id: user.id, username: user.username, avatarUrl: user.avatarUrl, avatarText: avatarText(user.username), tags: copy(user.tags), bio: user.bio };
}
function serialize(state, note) {
  const { authorId, lastViewDay, viewKeys, ...result } = note;
  return { ...result, author: author(state, authorId), mine: authorId === USER_ID, isDemo: true,
    todayViewCount: todayViews(note), viewDay: viewDay() };
}
function noteError() { return { ok: false, error: '这篇演示笔记不存在或无法查看', code: 'NOTE_UNAVAILABLE' }; }
function ownNotes() {
  const result = read();
  return result.ok && result.state ? result.state.notes.filter(note => note.authorId === USER_ID).map(note => serialize(result.state, note)) : [];
}
function request(action, input = {}) {
  const result = read();
  if (!result.ok) return result;
  if (!result.state) return { ok: false, error: '请先进入官方演示账号' };
  const state = result.state;
  if (action === 'whoami') return { ok: true, user: getUser() };
  if (action === 'getStats') {
    const own = state.notes.filter(note => note.authorId === USER_ID);
    const accessible = state.notes.filter(visible);
    return { ok: true, stats: { notes: own.length, publicNotes: own.filter(note => note.visibility === 'public').length,
      privateNotes: own.filter(note => note.visibility === 'private').length,
      views: own.reduce((sum, note) => sum + note.viewCount, 0), todayViews: own.reduce((sum, note) => sum + todayViews(note), 0),
      likes: own.reduce((sum, note) => sum + note.likeCount, 0),
      favorites: own.reduce((sum, note) => sum + note.favoriteCount, 0),
      likedNotes: accessible.filter(note => note.liked).length, savedNotes: accessible.filter(note => note.favorite).length } };
  }
  if (action === 'listNotes') {
    const scope = input.scope || 'public';
    if (!['public', 'my', 'favorites', 'liked'].includes(scope)) return { ok: false, error: '笔记范围不正确' };
    const query = String(input.query || '').trim().toLowerCase();
    const notes = state.notes.filter(note => visible(note) && (scope !== 'public' || note.visibility === 'public') &&
      (scope !== 'my' || note.authorId === USER_ID) && (scope !== 'favorites' || note.favorite) && (scope !== 'liked' || note.liked) &&
      (!input.relatedKey || note.relatedKey === input.relatedKey) && (!query || (note.title + ' ' + note.body).toLowerCase().includes(query)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    const offset = Number.isInteger(input.offset) ? Math.max(0, input.offset) : 0;
    const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(input.limit, 50)) : 20;
    return { ok: true, notes: notes.slice(offset, offset + limit).map(note => serialize(state, note)), total: notes.length, hasMore: offset + limit < notes.length };
  }
  if (action === 'updateProfile') {
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const bio = typeof input.bio === 'string' ? input.bio.trim() : '';
    if (!username || username.length > 20) return { ok: false, error: '用户名须为 1–20 字' };
    if (!Array.isArray(input.tags) || input.tags.length > 6 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 12)) return { ok: false, error: '最多 6 个标签，每个最多 12 字' };
    if (bio.length > 200) return { ok: false, error: '个人简介最多 200 字' };
    const avatarUrl = input.avatarUrl || '';
    if (avatarUrl && avatarUrl !== state.user.avatarUrl && !state.avatarFiles.includes(avatarUrl)) return { ok: false, error: '请重新选择演示头像' };
    Object.assign(state.user, { username, tags: [...new Set(input.tags.map(tag => tag.trim()))], bio, avatarUrl, avatarText: avatarText(username) });
    const saved = write(state);
    return saved.ok ? { ok: true, user: getUser() } : saved;
  }
  if (action === 'saveNote') {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!title || !body) return { ok: false, error: '请填写笔记标题与正文' };
    if (title.length > 80 || body.length > 10000) return { ok: false, error: '标题最多 80 字，正文最多 10000 字' };
    if (!['private', 'public'].includes(input.visibility)) return { ok: false, error: '请选择私密或公共' };
    const relatedKey = input.relatedKey || '';
    const parts = typeof relatedKey === 'string' ? relatedKey.split(':') : [];
    if (relatedKey && (parts.length !== 2 || !findItem(parts[0], parts[1]))) return { ok: false, error: '关联内容无效' };
    if (input.creationKey !== undefined && (typeof input.creationKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.creationKey))) return { ok: false, error: '新建标识无效' };
    const id = input.id || ('demo-n-' + (input.creationKey || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
    const old = state.notes.find(note => note.id === id);
    if (input.id && !old) return noteError();
    if (old && old.authorId !== USER_ID) return { ok: false, error: '只能修改自己的演示笔记', code: 'FORBIDDEN' };
    const timestamp = new Date().toISOString();
    const note = { ...(old || { id, authorId: USER_ID, createdAt: timestamp, viewCount: 0, likeCount: 0, favoriteCount: 0,
      liked: false, favorite: false, lastViewDay: '', viewKeys: [] }), title, body, visibility: input.visibility, relatedKey, updatedAt: timestamp };
    if (old) state.notes[state.notes.findIndex(entry => entry.id === id)] = note;
    else state.notes.unshift(note);
    const saved = write(state);
    return saved.ok ? { ok: true, note: serialize(state, note) } : saved;
  }
  const note = state.notes.find(entry => entry.id === input.id);
  if (!visible(note)) return noteError();
  if (action === 'getNote') {
    let view;
    if (input.view) {
      if (typeof input.viewKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.viewKey)) return { ok: false, error: '阅读标识无效' };
      const day = viewDay();
      const reason = note.authorId === USER_ID ? 'AUTHOR' : note.viewKeys.includes(input.viewKey) ? 'REQUEST_REPLAY' :
        note.lastViewDay === String(day) ? 'ALREADY_VIEWED_TODAY' : 'COUNTED';
      if (reason === 'COUNTED') { note.viewCount += 1; note.lastViewDay = String(day); }
      if (reason !== 'AUTHOR' && !note.viewKeys.includes(input.viewKey)) {
        note.viewKeys.push(input.viewKey);
        const saved = write(state);
        if (!saved.ok) return saved;
      }
      view = { counted: reason === 'COUNTED', reason, day };
    }
    return { ok: true, note: serialize(state, note), ...(view ? { view } : {}) };
  }
  if (action === 'deleteNote') {
    if (note.authorId !== USER_ID) return { ok: false, error: '只能删除自己的演示笔记', code: 'FORBIDDEN' };
    state.notes = state.notes.filter(entry => entry.id !== note.id);
    return write(state);
  }
  if (action === 'toggleLike' || action === 'toggleNoteFavorite') {
    if (input.active !== undefined && typeof input.active !== 'boolean') return { ok: false, error: '互动状态不正确', code: 'INVALID_INPUT' };
    const field = action === 'toggleLike' ? 'liked' : 'favorite';
    const counter = action === 'toggleLike' ? 'likeCount' : 'favoriteCount';
    const active = input.active === undefined ? !note[field] : input.active;
    if (active === note[field]) return { ok: true, note: serialize(state, note) };
    note[field] = active;
    note[counter] = Math.max(0, note[counter] + (active ? 1 : -1));
    const saved = write(state);
    return saved.ok ? { ok: true, note: serialize(state, note) } : saved;
  }
  return { ok: false, error: '不支持的演示操作' };
}
async function uploadAvatar(filePath) {
  if (typeof filePath !== 'string' || !filePath) return { ok: false, error: '请选择头像图片' };
  if (!wx.getFileSystemManager) return { ok: false, error: '当前环境无法保存头像，请在微信中重试' };
  try {
    const fs = wx.getFileSystemManager();
    const info = await new Promise((resolve, reject) => fs.stat({ path: filePath, success: resolve, fail: reject }));
    if (!info.stats || !Number.isFinite(info.stats.size) || info.stats.size > 2 * 1024 * 1024) return { ok: false, error: '头像图片不能超过 2 MB' };
    const file = await new Promise((resolve, reject) => fs.saveFile({ tempFilePath: filePath, success: resolve, fail: reject }));
    if (!file.savedFilePath) return { ok: false, error: '头像保存失败，请重新选择' };
    const result = read();
    if (!result.ok || !result.state) return { ok: false, error: STORAGE_ERROR };
    result.state.avatarFiles.push(file.savedFilePath);
    const saved = write(result.state);
    return saved.ok ? { ok: true, avatarUrl: file.savedFilePath } : saved;
  } catch (error) { return { ok: false, error: '头像保存失败，请检查设备存储后重试' }; }
}

// Backups never restore identity/profile/editor records. This validator and cache refresh
// let the backup service preserve their current storage snapshot while merging own notes.
function refreshBackupCache() { cachedState = undefined; }
module.exports = { initialize, getUser, request, ownNotes, uploadAvatar, validateBackupState: validState, refreshBackupCache };
