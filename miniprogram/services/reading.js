const { findItem } = require('../data/catalog');
const community = require('./community');

const PREFIX = 'herb-origin:reading:v1:';
const LIMIT = 6;
const ERROR = '阅读记录保存失败，请检查设备存储后重试';
function key(scope) { return PREFIX + encodeURIComponent(scope); }
function load(scope) {
  try {
    const value = wx.getStorageSync(key(scope));
    if (!value) return { ok: true, items: [] };
    if (value.schemaVersion !== 1 || !Array.isArray(value.items)) return { ok: false, items: [], error: '阅读记录无法读取' };
    const seen = new Set();
    const items = value.items.filter(record => {
      if (!record || typeof record.kind !== 'string' || typeof record.id !== 'string' || !Number.isFinite(Date.parse(record.readAt))) return false;
      const item = findItem(record.kind, record.id);
      const identity = item && item.kind + ':' + item.id;
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }).slice(0, LIMIT).map(record => ({ kind: record.kind, id: record.id, readAt: record.readAt }));
    return { ok: true, items };
  } catch (error) { return { ok: false, items: [], error: '阅读记录无法读取' }; }
}
function getRecent() {
  const scope = community.getStorageScope();
  const state = load(scope);
  if (scope !== community.getStorageScope()) return [];
  return state.items.map(record => {
    const item = findItem(record.kind, record.id);
    return { ...record, title: item.title, category: item.category };
  });
}
function remember(value, expectedScope) {
  const item = value && findItem(value.kind, value.id);
  if (!item) return { ok: false, error: '找不到阅读内容' };
  const scope = community.getStorageScope();
  if (expectedScope && expectedScope !== scope) return { ok: false, error: '账号已变化，阅读记录未保存' };
  const state = load(scope);
  if (!state.ok) return state;
  const next = [{ kind: item.kind, id: item.id, readAt: new Date().toISOString() },
    ...state.items.filter(record => record.kind !== item.kind || record.id !== item.id)].slice(0, LIMIT);
  if (scope !== community.getStorageScope()) return { ok: false, error: '账号已变化，阅读记录未保存' };
  try { wx.setStorageSync(key(scope), { schemaVersion: 1, items: next }); return { ok: true }; }
  catch (error) { return { ok: false, error: ERROR }; }
}
function clear(expectedScope) {
  const scope = community.getStorageScope();
  if (expectedScope && expectedScope !== scope) return { ok: false, error: '账号已变化，请重新清除记录' };
  if (scope !== community.getStorageScope()) return { ok: false, error: '账号已变化，请重新清除记录' };
  try { wx.setStorageSync(key(scope), { schemaVersion: 1, items: [] }); return { ok: true }; }
  catch (error) { return { ok: false, error: ERROR }; }
}
module.exports = { remember, getRecent, clear, getScope: () => community.getStorageScope() };
