const { findItem, itemPath } = require('../data/catalog');

const libraryKinds = ['all', 'herb', 'course', 'note', 'route'];
const notesScopes = ['public', 'my', 'favorites', 'liked', 'local', 'featured'];
let pendingNavigation = null;

// Coalesce rapid taps while the native navigation is still in flight.
// No artificial delay: the first tap always opens the destination immediately.
function navigate(method, options) {
  const now = Date.now();
  if (pendingNavigation && pendingNavigation.api === wx && pendingNavigation.method === method && pendingNavigation.url === options.url && now - pendingNavigation.at < 800) return;
  const token = { api: wx, method, url: options.url, at: now };
  pendingNavigation = token;
  const release = () => { if (pendingNavigation === token) pendingNavigation = null; };
  wx[method]({ ...options, fail(error) { release(); if (options.fail) options.fail(error); }, complete: release });
}

function globalData() {
  const app = getApp();
  if (!app.globalData) app.globalData = {};
  return app.globalData;
}

function showFailure() {
  wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
}

function push(url) {
  navigate('navigateTo', { url, fail() {
    if (typeof wx.redirectTo === 'function') navigate('redirectTo', { url, fail: showFailure });
    else showFailure();
  } });
}

function openLibrary(kind = 'all', query = '') {
  const pending = globalData();
  pending.libraryFilter = libraryKinds.indexOf(kind) !== -1 ? kind : 'all';
  pending.libraryQuery = typeof query === 'string' ? query.slice(0, 100) : '';
  pending.libraryResetFilters = true;
  navigate('switchTab', { url: '/pages/library/index', fail: showFailure });
}

function openNotes(scope = 'public', relatedKey = '') {
  const pending = globalData();
  pending.notesScope = notesScopes.indexOf(scope) !== -1 ? scope : 'public';
  pending.notesRelatedKey = typeof relatedKey === 'string' ? relatedKey : '';
  navigate('switchTab', { url: '/pages/notes/index', fail: showFailure });
}

function openDetail(kind, id, options = {}) {
  const item = findItem(kind, id);
  if (!item) {
    wx.showToast({ title: '找不到这条内容', icon: 'none' });
    return false;
  }
  push(itemPath(item) + (item.kind === 'course' && options.resume ? '&resume=1' : ''));
  return true;
}

function editNote(id = '', relatedKey = '', seed = null) {
  const query = [];
  if (typeof id === 'string' && id) query.push('id=' + encodeURIComponent(id));
  if (typeof relatedKey === 'string' && relatedKey) query.push('relatedKey=' + encodeURIComponent(relatedKey));
  if (!id && seed && typeof seed.title === 'string' && typeof seed.body === 'string' && typeof seed.ownerId === 'string') {
    const key = 'seed-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    globalData().noteSeed = { key, ownerId: seed.ownerId, title: seed.title.slice(0, 80), body: seed.body.slice(0, 10000), relatedKey, expiresAt: Date.now() + 5 * 60000 };
    query.push('seed=' + encodeURIComponent(key));
  }
  push('/pages/note-edit/index' + (query.length ? '?' + query.join('&') : ''));
}

function openAuth(mode = 'login') {
  push('/pages/auth/index' + (mode === 'register' ? '?mode=register' : ''));
}

module.exports = { push, openLibrary, openNotes, openDetail, editNote, openAuth };
