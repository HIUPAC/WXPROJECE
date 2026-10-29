const config = require('../config');
const demo = require('./demo');

const SESSION_KEY = 'herb-origin:community:session:v1';
const SERVICE_ERROR = '社区服务暂不可用，请稍后重试';
let cachedSession;
let cloudReady = false;
let authRevision = 0;

function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function safeUser(value) {
  if (!value || typeof value.id !== 'string' || !value.id || typeof value.username !== 'string') return null;
  return {
    id: value.id, studentId: typeof value.studentId === 'string' ? value.studentId : '',
    phone: typeof value.phone === 'string' ? value.phone : '', username: value.username,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag) => typeof tag === 'string') : [],
    bio: typeof value.bio === 'string' ? value.bio : '',
    avatarUrl: '',
    avatarText: typeof value.avatarText === 'string' ? value.avatarText : ''
  };
}
function clearSession() {
  cachedSession = null;
  try {
    if (typeof wx !== 'undefined' && typeof wx.removeStorageSync === 'function') wx.removeStorageSync(SESSION_KEY);
    else if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') wx.setStorageSync(SESSION_KEY, null);
  } catch (error) { /* The current in-memory session remains cleared. */ }
}
function session() {
  if (cachedSession === undefined) {
    try { cachedSession = typeof wx !== 'undefined' ? wx.getStorageSync(SESSION_KEY) || null : null; }
    catch (error) { cachedSession = null; }
  }
  if (cachedSession && cachedSession.mode !== 'demo' && (!cachedSession.user || !cachedSession.user.id ||
    !/^[a-f0-9]{64}$/.test(cachedSession.sessionToken || '') ||
    !Number.isFinite(cachedSession.expiresAt) || cachedSession.expiresAt <= Date.now())) clearSession();
  return cachedSession;
}
function isDemoMode() { const current = session(); return Boolean(current && current.mode === 'demo'); }
function getUser() { const current = session(); return current ? (current.mode === 'demo' ? demo.getUser() : copy(safeUser(current.user))) : null; }
function getStorageScope() { const user = getUser(); return user ? user.id : 'guest'; }
async function enterDemo() {
  const result = demo.initialize();
  if (!result.ok) return result;
  try {
    wx.setStorageSync(SESSION_KEY, { mode: 'demo' });
    cachedSession = { mode: 'demo' };
    authRevision += 1;
    return { ok: true, user: getUser() };
  } catch (error) { return { ok: false, error: '无法进入演示账号，请检查设备存储后重试' }; }
}
function initializeCloud() {
  if (config.serviceMode === 'local') return { ok: false, code: 'LOCAL_EDITION', error: '当前为本机学习版，可阅读精选内容和保存本机手记' };
  if (cloudReady) return { ok: true };
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.init !== 'function' || typeof wx.cloud.callFunction !== 'function') return { ok: false, error: SERVICE_ERROR };
  try {
    const options = { traceUser: true };
    if (config.cloudEnv) options.env = config.cloudEnv;
    wx.cloud.init(options);
    cloudReady = true;
    return { ok: true };
  } catch (error) { return { ok: false, error: SERVICE_ERROR }; }
}
function errorMessage(error) {
  const message = String(error && (error.errMsg || error.message) || '');
  if (/timeout|network|网络|超时/i.test(message)) return '网络连接失败，请稍后重试';
  return SERVICE_ERROR;
}
function reportFailure(action, error, fallback = 'CLOUD_CALL_FAILED') {
  const message = String(error && (error.errMsg || error.message) || '');
  const rawCode = String(error && (error.errCode || error.code) || fallback);
  let reason = fallback;
  if (/function.*(?:not exists|does not exist|not found)|FUNCTION_NOT_FOUND|ResourceNotFound.Function/i.test(rawCode + ' ' + message)) reason = 'FUNCTION_MISSING';
  else if (/Cannot find module|MODULE_NOT_FOUND/i.test(rawCode + ' ' + message)) reason = 'DEPENDENCY_MISSING';
  else if (/非法.*env|illegal.*env|invalid.*env|INVALID_ENV|environment.*(?:not exist|not found)/i.test(rawCode + ' ' + message)) reason = 'ENVIRONMENT_ERROR';
  else if (/timeout|network|网络|超时/i.test(rawCode + ' ' + message)) reason = 'NETWORK_ERROR';
  const requestId = String(error && (error.requestID || error.requestId || error.reqId) || '');
  try {
    if (typeof console !== 'undefined' && typeof console.error === 'function') console.error('[community] request failed', {
      action, reason, code: /^[A-Za-z0-9_.:-]{1,100}$/.test(rawCode) ? rawCode : fallback,
      functionName: config.communityFunction, environment: config.cloudEnv,
      requestId: /^[A-Za-z0-9_-]{1,100}$/.test(requestId) ? requestId : ''
    });
  } catch (loggingError) { /* Preserve the original request outcome. */ }
}
async function request(action, args = {}) {
  const current = session();
  const revision = authRevision;
  if (current && current.mode === 'demo' && !['register', 'login'].includes(action)) {
    try {
      const result = await demo.request(action, args);
      return revision === authRevision ? result : { ok: false, error: '账号已切换，请刷新后重试', code: 'ACCOUNT_CHANGED' };
    } catch (error) { return { ok: false, error: '演示数据读取失败，请稍后重试' }; }
  }
  const ready = initializeCloud();
  if (!ready.ok) return ready;
  const token = current && current.mode !== 'demo' ? current.sessionToken : '';
  try {
    const options = {
      name: config.communityFunction,
      data: Object.assign({}, args, { action, sessionToken: token })
    };
    if (config.cloudEnv) options.config = { env: config.cloudEnv };
    const response = await wx.cloud.callFunction(options);
    const result = response && response.result;
    if (!result || typeof result.ok !== 'boolean') { reportFailure(action, response, 'INVALID_RESPONSE'); return { ok: false, error: SERVICE_ERROR }; }
    const live = session();
    if (revision !== authRevision || (live && live.mode !== 'demo' ? live.sessionToken : '') !== token) return { ok: false, error: '账号已切换，请刷新后重试', code: 'ACCOUNT_CHANGED' };
    if (result.code === 'AUTH_REQUIRED' && token) clearSession();
    if (result.code === 'SERVICE_UNAVAILABLE') reportFailure(action, { code: result.code, requestID: response.requestID });
    return result;
  } catch (error) { reportFailure(action, error); return { ok: false, error: errorMessage(error) }; }
}
function saveSession(result) {
  const user = safeUser(result.user);
  if (!user || !/^[a-f0-9]{64}$/.test(result.sessionToken || '') || !Number.isFinite(result.expiresAt)) return { ok: false, error: SERVICE_ERROR };
  const next = { user: copy(user), sessionToken: result.sessionToken, expiresAt: result.expiresAt };
  try {
    wx.setStorageSync(SESSION_KEY, next);
    cachedSession = next;
    return { ok: true, user: copy(next.user) };
  } catch (error) {
    return { ok: false, error: '无法保存登录信息，请检查设备存储空间后重试' };
  }
}
async function authenticate(action, input) {
  authRevision += 1;
  const result = await request(action, input);
  if (!result.ok) return result;
  return saveSession(result);
}
async function logout() {
  if (isDemoMode()) {
    try {
      wx.setStorageSync(SESSION_KEY, null);
      cachedSession = null;
      authRevision += 1;
      return { ok: true };
    } catch (error) { return { ok: false, error: '退出演示失败，请检查设备存储后重试' }; }
  }
  // Revoke on the server when reachable and always end the current device session.
  const revision = authRevision;
  const result = session() ? await request('logout') : { ok: true };
  if (revision !== authRevision) return { ok: false, error: '账号已切换，请刷新后重试', code: 'ACCOUNT_CHANGED' };
  authRevision += 1;
  clearSession();
  return result.ok ? { ok: true } : { ok: true, warning: '已退出当前设备，网络恢复后旧会话会在有效期结束时失效' };
}
async function updateProfile(input) {
  const result = await request('updateProfile', input);
  if (!result.ok) return result;
  if (result.user && result.user.isDemo) return result;
  const current = session();
  if (!current) return { ok: false, error: '请重新登录' };
  const user = safeUser(result.user);
  if (!user) return { ok: false, error: SERVICE_ERROR };
  const next = Object.assign({}, current, { user: copy(user) });
  try { wx.setStorageSync(SESSION_KEY, next); } catch (error) { /* Server save succeeded; keep the live cache accurate. */ }
  cachedSession = next;
  return { ok: true, user: copy(user) };
}
async function refreshUser() {
  const result = await request('whoami');
  if (!result.ok) return result;
  if (result.user && result.user.isDemo) return result;
  const user = safeUser(result.user);
  if (!user) return { ok: false, error: SERVICE_ERROR };
  const current = session();
  if (current) {
    cachedSession = Object.assign({}, current, { user: copy(user) });
    try { wx.setStorageSync(SESSION_KEY, cachedSession); } catch (error) { /* Cache still updated. */ }
  }
  return { ok: true, user: copy(user) };
}
async function uploadAvatar(filePath) {
  if (!getUser()) return { ok: false, error: '请先登录' };
  if (isDemoMode()) {
    const revision = authRevision;
    const result = await demo.uploadAvatar(filePath);
    return revision === authRevision ? result : { ok: false, error: '账号已切换，请重新选择头像', code: 'ACCOUNT_CHANGED' };
  }
  return { ok: false, error: '当前使用文字头像，图片头像暂未开放', code: 'AVATAR_UNAVAILABLE' };
}

async function recordNoteView(id, options = {}) {
  const result = await request('getNote', Object.assign({}, options, { id, view: true }));
  if (!result.ok) return result;
  if (!result.note || !Number.isSafeInteger(result.note.viewCount) || result.note.viewCount < 0) return { ok: false, error: SERVICE_ERROR };
  return { ok: true, view: {
    ...(result.view || { reason: 'PROCESSED' }),
    viewCount: result.note.viewCount,
    todayViewCount: Number.isSafeInteger(result.note.todayViewCount) && result.note.todayViewCount >= 0 ? result.note.todayViewCount : null,
    day: Number.isInteger(result.note.viewDay) ? result.note.viewDay : null,
  } };
}

module.exports = {
  getUser, getStorageScope, initializeCloud, request, refreshUser, enterDemo, isDemoMode, recordNoteView,
  getDemoNotes: () => isDemoMode() ? demo.ownNotes() : [],
  register: (input) => authenticate('register', input), login: (input) => authenticate('login', input),
  logout, updateProfile, uploadAvatar,
  listNotes: (options = {}) => request('listNotes', options),
  getNote: (id, options = {}) => request('getNote', Object.assign({}, options, { id })),
  saveNote: (input) => request('saveNote', input),
  deleteNote: (id) => request('deleteNote', { id }),
  reportNote: (id, reason, detail = '') => isDemoMode() ? Promise.resolve({ ok: false, error: '本机体验笔记不会提交云端举报' }) : request('reportNote', { id, reason, detail }),
  toggleLike: (id, options = {}) => request('toggleLike', Object.assign({}, options, { id })),
  toggleNoteFavorite: (id, options = {}) => request('toggleNoteFavorite', Object.assign({}, options, { id })),
  getStats: () => request('getStats')
};
