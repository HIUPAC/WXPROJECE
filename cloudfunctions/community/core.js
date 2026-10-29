const crypto = require('node:crypto');
const { diagnostic } = require('./diagnostics');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const COLLECTIONS = {
  users: 'community_users', identities: 'community_identities', sessions: 'community_sessions',
  notes: 'community_notes', views: 'community_views', rates: 'community_rates', uploads: 'community_uploads', reports: 'community_reports'
};
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const INTERACTION_LIMIT = 1000;

class CommunityError extends Error {
  constructor(message, code = 'INVALID_INPUT') { super(message); this.code = code; }
}
function fail(message, code) { throw new CommunityError(message, code); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function randomId(prefix) { return prefix + crypto.randomBytes(16).toString('hex'); }
function text(value, max, label, required = true) {
  if (typeof value !== 'string') fail('请填写' + label);
  const result = value.trim();
  if ((required && !result) || Array.from(result).length > max) fail(label + (required ? '不能为空且' : '') + '最多 ' + max + ' 个字');
  return result;
}
function avatarText(username) {
  const character = Array.from(username || '').find((item) => /[\u3400-\u9fffA-Za-z]/.test(item));
  return (character || Array.from(username || '')[0] || '友').toUpperCase();
}
function publicUser(user, full = false) {
  const result = {
    id: user.id, username: user.username, tags: user.tags || [], bio: user.bio || '',
    avatarUrl: user.avatarUrl || '', avatarText: avatarText(user.username)
  };
  if (full) { result.studentId = user.studentId; result.phone = user.phone; }
  return result;
}
function emptyStats() { return { notes: 0, publicNotes: 0, privateNotes: 0, views: 0, likes: 0, favorites: 0 }; }
function viewDay(timestamp) { return Math.floor((timestamp + 8 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000)); }
function todayViews(record, day) { return record.viewDay === day ? record.todayViewCount || 0 : 0; }
function addStats(user, changes) {
  user.stats = Object.assign(emptyStats(), user.stats);
  Object.keys(changes).forEach((key) => { user.stats[key] = Math.max(0, user.stats[key] + changes[key]); });
}
function visible(note, user) { return Boolean(note && (note.visibility === 'public' || (user && note.authorId === user.id))); }
function requireNote(note, user, own = false) {
  if (!visible(note, user)) fail('这条笔记不存在或已设为私密', 'NOTE_UNAVAILABLE');
  if (own && note.authorId !== user.id) fail('只能修改自己的笔记', 'FORBIDDEN');
}
function serializeNote(note, user, author, timestamp) {
  return {
    id: note.id, title: note.title, body: note.body, relatedKey: note.relatedKey,
    visibility: note.visibility, createdAt: note.createdAt, updatedAt: note.updatedAt,
    author: publicUser(author || { id: note.authorId, username: '用户' }),
    mine: Boolean(user && user.id === note.authorId),
    liked: Boolean(user && (user.likedIds || []).includes(note.id)),
    favorite: Boolean(user && (user.savedIds || []).includes(note.id)),
    viewCount: note.viewCount || 0, todayViewCount: todayViews(note, viewDay(timestamp)), viewDay: viewDay(timestamp),
    likeCount: note.likeCount || 0, favoriteCount: note.favoriteCount || 0
  };
}
async function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const result = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt, hash: result.toString('hex'), algorithm: 'scrypt-v1' };
}
async function passwordMatches(password, saved) {
  const safeSaved = saved && saved.algorithm === 'scrypt-v1' ? saved : {
    salt: '00000000000000000000000000000000', hash: '0'.repeat(128)
  };
  const result = await passwordHash(password, safeSaved.salt);
  const expected = Buffer.from(safeSaved.hash, 'hex');
  const actual = Buffer.from(result.hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) && Boolean(saved);
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 64) fail('密码需要 8–64 位字符');
  return password;
}
function normalizedAccount(value) { return text(value, 32, '学号或手机号').toUpperCase(); }
function validateProfile(input) {
  const username = text(input.username, 20, '用户名');
  const bio = text(input.bio === undefined ? '' : input.bio, 200, '个人简介', false);
  if (!Array.isArray(input.tags) || input.tags.length > 6) fail('个性标签最多 6 个');
  const tags = [...new Set(input.tags.map((tag) => text(tag, 12, '标签')))];
  return { username, tags, bio };
}
function validateNote(input) {
  const title = text(input.title, 80, '笔记标题');
  const body = text(input.body, 10000, '笔记内容');
  const relatedKey = text(input.relatedKey === undefined ? '' : input.relatedKey, 80, '关联内容', false);
  if (relatedKey && !/^[a-z][a-z0-9_-]*:[A-Za-z0-9_-]+$/.test(relatedKey)) fail('关联内容格式不正确');
  if (!['private', 'public'].includes(input.visibility)) fail('请选择私密或公开');
  return { title, body, relatedKey, visibility: input.visibility };
}
function validId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail('笔记编号不正确');
  return value;
}

// All repositories expose document operations and automatic conflict-retrying transactions.
function createCommunity({ repo, now = Date.now, verifyAvatar = async () => false, allowAvatarUploads = true, verifyText = null, onServiceError = () => {} }) {
  const get = (repository, kind, id) => repository.get(COLLECTIONS[kind], id);
  const put = (repository, kind, id, value) => repository.put(COLLECTIONS[kind], id, value);
  const remove = (repository, kind, id) => repository.remove(COLLECTIONS[kind], id);

  async function checkText(content, context, scene) {
    // Production supplies the platform checker. Domain tests can inject a checker.
    if (!verifyText) return;
    let result;
    try { result = await verifyText(content, context, scene); } catch (error) { result = null; }
    if (!result || result.status === 'unavailable') fail('内容检查暂不可用，请保留草稿后重试', 'MODERATION_UNAVAILABLE');
    if (result.status !== 'pass') fail('内容未通过检查，请调整后重试', 'CONTENT_REJECTED');
  }

  async function authenticate(repository, event, context, optional = false) {
    if (!event.sessionToken) {
      if (optional) return null;
      fail('请先登录', 'AUTH_REQUIRED');
    }
    if (typeof event.sessionToken !== 'string' || !/^[a-f0-9]{64}$/.test(event.sessionToken)) fail('登录已失效，请重新登录', 'AUTH_REQUIRED');
    const session = await get(repository, 'sessions', hash(event.sessionToken));
    if (!session || session.openid !== context.openid || session.expiresAt <= now()) fail('登录已失效，请重新登录', 'AUTH_REQUIRED');
    const user = await get(repository, 'users', session.userId);
    if (!user) fail('登录已失效，请重新登录', 'AUTH_REQUIRED');
    return user;
  }
  async function rateLimit(context, type, maximum, duration, account = '') {
    const timestamp = now();
    const key = hash(type + ':' + (account || context.openid) + ':' + Math.floor(timestamp / duration));
    return repo.transaction(async (tx) => {
      const record = await get(tx, 'rates', key);
      if (record && record.count >= maximum) fail('操作过于频繁，请稍后再试', 'RATE_LIMITED');
      await put(tx, 'rates', key, { count: (record ? record.count : 0) + 1, expiresAt: timestamp + duration });
    });
  }
  function newSession(userId, context) {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = now() + SESSION_MS;
    return { sessionToken, expiresAt, record: { userId, openid: context.openid, expiresAt, createdAt: now() } };
  }
  async function register(event, context) {
    const studentId = normalizedAccount(event.studentId);
    if (!/^[A-Z0-9]{4,32}$/.test(studentId)) fail('学号需要 4–32 位字母或数字');
    const phone = text(event.phone, 11, '手机号');
    if (!/^1[3-9]\d{9}$/.test(phone)) fail('请输入正确的 11 位手机号');
    const username = text(event.username, 20, '用户名');
    const password = validatePassword(event.password);
    await rateLimit(context, 'register', 5, 60 * 60 * 1000);
    await checkText(username, context, 1);
    const passwordData = await passwordHash(password);
    const user = {
      id: randomId('u_'), studentId, phone, username, password: passwordData,
      tags: [], bio: '', avatarUrl: '', likedIds: [], savedIds: [], stats: emptyStats(), createdAt: now()
    };
    const session = newSession(user.id, context);
    const identityIds = [...new Set([studentId, phone].map(hash))];
    await repo.transaction(async (tx) => {
      for (const identityId of identityIds) {
        if (await get(tx, 'identities', identityId)) fail('学号或手机号已被注册', 'ACCOUNT_EXISTS');
      }
      for (const identityId of identityIds) await put(tx, 'identities', identityId, { userId: user.id });
      await put(tx, 'users', user.id, user);
      await put(tx, 'sessions', hash(session.sessionToken), session.record);
    });
    return { ok: true, user: publicUser(user, true), sessionToken: session.sessionToken, expiresAt: session.expiresAt };
  }
  async function login(event, context) {
    const account = normalizedAccount(event.account);
    const password = validatePassword(event.password);
    await rateLimit(context, 'login-openid', 20, 15 * 60 * 1000);
    await rateLimit(context, 'login-account', 10, 15 * 60 * 1000, account);
    const identity = await get(repo, 'identities', hash(account));
    const user = identity ? await get(repo, 'users', identity.userId) : null;
    if (!await passwordMatches(password, user && user.password)) fail('学号、手机号或密码不正确', 'LOGIN_FAILED');
    const session = newSession(user.id, context);
    await put(repo, 'sessions', hash(session.sessionToken), session.record);
    return { ok: true, user: publicUser(user, true), sessionToken: session.sessionToken, expiresAt: session.expiresAt };
  }
  async function whoami(event, context) {
    return { ok: true, user: publicUser(await authenticate(repo, event, context), true) };
  }
  async function logout(event, context) {
    // Revoke only a session belonging to this WeChat user; never trust caller user IDs.
    await repo.transaction(async (tx) => {
      await authenticate(tx, event, context);
      await remove(tx, 'sessions', hash(event.sessionToken));
    });
    return { ok: true };
  }
  async function updateProfile(event, context) {
    const profile = validateProfile(event);
    const avatarUrl = text(event.avatarUrl === undefined ? '' : event.avatarUrl, 500, '头像地址', false);
    await authenticate(repo, event, context);
    await rateLimit(context, 'profile', 30, 60 * 60 * 1000);
    await checkText([profile.username, ...profile.tags, profile.bio].join('\n'), context, 1);
    return repo.transaction(async (tx) => {
      const user = await authenticate(tx, event, context);
      if (avatarUrl && avatarUrl !== user.avatarUrl) {
        const uploaded = await get(tx, 'uploads', hash(avatarUrl));
        if (!uploaded || uploaded.userId !== user.id || uploaded.fileId !== avatarUrl || !uploaded.verified) fail('请重新上传自己的头像');
      }
      Object.assign(user, profile, { avatarUrl });
      await put(tx, 'users', user.id, user);
      return { ok: true, user: publicUser(user, true) };
    });
  }
  async function prepareAvatar(event, context) {
    const user = await authenticate(repo, event, context);
    if (!allowAvatarUploads) fail('当前使用文字头像，图片头像暂未开放', 'AVATAR_UNAVAILABLE');
    await rateLimit(context, 'avatar', 20, 60 * 60 * 1000);
    const extension = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(event.extension) ? event.extension : 'png';
    const ticket = randomId('a_');
    const cloudPath = 'avatars/' + context.openid + '/' + ticket + '.' + extension;
    await put(repo, 'uploads', ticket, { userId: user.id, openid: context.openid, cloudPath, expiresAt: now() + 15 * 60 * 1000 });
    return { ok: true, ticket, cloudPath };
  }
  async function finishAvatar(event, context) {
    const user = await authenticate(repo, event, context);
    if (!allowAvatarUploads) fail('当前使用文字头像，图片头像暂未开放', 'AVATAR_UNAVAILABLE');
    const ticket = validId(event.ticket);
    const uploaded = await get(repo, 'uploads', ticket);
    if (!uploaded || uploaded.userId !== user.id || uploaded.openid !== context.openid || uploaded.expiresAt <= now()) fail('头像上传已失效，请重试');
    if (typeof event.fileId !== 'string' || !event.fileId.startsWith('cloud://') || !event.fileId.endsWith('/' + uploaded.cloudPath)) fail('头像文件地址无效');
    if (!await verifyAvatar(event.fileId, context)) fail('头像仅支持不超过 2 MB 的 PNG、JPG、GIF 或 WebP 图片');
    await repo.transaction(async (tx) => {
      const current = await authenticate(tx, event, context);
      const pending = await get(tx, 'uploads', ticket);
      if (!pending || pending.userId !== current.id || pending.expiresAt <= now()) fail('头像上传已失效，请重试');
      await put(tx, 'uploads', hash(event.fileId), { userId: user.id, fileId: event.fileId, verified: true, createdAt: now() });
      await remove(tx, 'uploads', ticket);
    });
    return { ok: true, avatarUrl: event.fileId };
  }
  async function render(note, user, repository = repo) {
    return serializeNote(note, user, await get(repository, 'users', note.authorId), now());
  }
  function listFilter(event, user) {
    const scope = event.scope || 'public';
    if (!['public', 'my', 'favorites', 'liked'].includes(scope)) fail('笔记范围不正确');
    if (scope !== 'public' && !user) fail('请先登录', 'AUTH_REQUIRED');
    const filter = { scope, userId: user ? user.id : '', relatedKey: '', query: '' };
    if (scope === 'liked' || scope === 'favorites') filter.ids = scope === 'liked' ? (user.likedIds || []) : (user.savedIds || []);
    if (event.relatedKey) filter.relatedKey = text(event.relatedKey, 80, '关联内容');
    if (event.query) filter.query = text(event.query, 100, '搜索内容');
    return filter;
  }
  async function listNotes(event, context) {
    const user = await authenticate(repo, event, context, true);
    const filter = listFilter(event, user);
    const offset = Number.isInteger(event.offset) && event.offset >= 0 ? Math.min(event.offset, 100000) : 0;
    const limit = Number.isInteger(event.limit) ? Math.max(1, Math.min(event.limit, 50)) : 20;
    if (filter.ids && !filter.ids.length) return { ok: true, notes: [], total: 0, hasMore: false };
    const [notes, total] = await Promise.all([
      repo.listNotes(COLLECTIONS.notes, filter, { offset, limit }), repo.countNotes(COLLECTIONS.notes, filter)
    ]);
    // Recheck visibility in the serializer as defense in depth against adapter bugs.
    const visibleNotes = notes.filter((note) => visible(note, user));
    return { ok: true, notes: await Promise.all(visibleNotes.map((note) => render(note, user))), total, hasMore: offset + notes.length < total };
  }
  async function getNote(event, context) {
    const id = validId(event.id);
    if (event.view) {
      const viewKey = text(event.viewKey, 100, '阅读标识');
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(viewKey)) fail('阅读标识不正确');
      return repo.transaction(async (tx) => {
        // Conflict retries must use the day when the transaction actually runs.
        const timestamp = now();
        const day = viewDay(timestamp);
        const user = await authenticate(tx, event, context, true);
        const note = await get(tx, 'notes', id);
        requireNote(note, user);
        const author = await get(tx, 'users', note.authorId);
        if (user && user.id === note.authorId) {
          return { ok: true, note: serializeNote(note, user, author, timestamp), view: { counted: false, reason: 'AUTHOR', day } };
        }
        // Each opening is idempotent; cap one counted reading per viewer/note/day.
        // The stable viewer binds retries across logout/login and different accounts.
        const viewer = hash(context.openid);
        const viewId = hash(id + ':' + viewer + ':key:' + viewKey);
        const dailyId = hash(id + ':' + viewer + ':day:' + day);
        const receipt = await get(tx, 'views', viewId);
        const daily = await get(tx, 'views', dailyId);
        const reason = receipt ? 'REQUEST_REPLAY' : daily ? 'ALREADY_VIEWED_TODAY' : 'COUNTED';
        if (reason === 'COUNTED') {
          note.viewCount = (note.viewCount || 0) + 1;
          note.todayViewCount = todayViews(note, day) + 1;
          note.viewDay = day;
          addStats(author, { views: 1 });
          author.todayViewCount = todayViews(author, day) + 1;
          author.viewDay = day;
          await put(tx, 'views', dailyId, { noteId: id, viewer, day, createdAt: timestamp });
          await put(tx, 'notes', id, note);
          await put(tx, 'users', author.id, author);
        }
        if (!receipt) await put(tx, 'views', viewId, { noteId: id, viewer, viewKey: hash(viewKey), day, createdAt: timestamp });
        return { ok: true, note: serializeNote(note, user, author, timestamp), view: { counted: reason === 'COUNTED', reason, day } };
      });
    }
    const user = await authenticate(repo, event, context, true);
    const note = await get(repo, 'notes', id);
    requireNote(note, user);
    return { ok: true, note: await render(note, user) };
  }
  async function saveNote(event, context) {
    const values = validateNote(event);
    const suppliedId = event.id ? validId(event.id) : '';
    const creationKey = event.creationKey === undefined ? '' : text(event.creationKey, 100, '新建标识');
    if (creationKey && !/^[A-Za-z0-9_-]{8,100}$/.test(creationKey)) fail('新建标识不正确');
    await authenticate(repo, event, context);
    if (values.visibility === 'public') {
      await rateLimit(context, 'publish', 30, 60 * 60 * 1000);
      await checkText(values.title + '\n' + values.body, context, 4);
    }
    const fallbackId = randomId('n_');
    return repo.transaction(async (tx) => {
      const user = await authenticate(tx, event, context);
      const id = suppliedId || (creationKey ? 'n_' + hash(user.id + ':' + creationKey).slice(0, 32) : fallbackId);
      const old = await get(tx, 'notes', id);
      if (suppliedId || old) requireNote(old, user, true);
      const timestamp = new Date(now()).toISOString();
      const note = Object.assign(old ? Object.assign({}, old) : {
        id, authorId: user.id, createdAt: timestamp, viewCount: 0, likeCount: 0, favoriteCount: 0
      }, values, { updatedAt: timestamp });
      if (!old) addStats(user, { notes: 1, [values.visibility === 'public' ? 'publicNotes' : 'privateNotes']: 1 });
      else if (old.visibility !== values.visibility) {
        addStats(user, { [old.visibility === 'public' ? 'publicNotes' : 'privateNotes']: -1, [values.visibility === 'public' ? 'publicNotes' : 'privateNotes']: 1 });
      }
      await put(tx, 'notes', id, note);
      await put(tx, 'users', user.id, user);
      return { ok: true, note: serializeNote(note, user, user, now()) };
    });
  }
  async function deleteNote(event, context) {
    const id = validId(event.id);
    return repo.transaction(async (tx) => {
      const user = await authenticate(tx, event, context);
      const note = await get(tx, 'notes', id);
      requireNote(note, user, true);
      addStats(user, {
        notes: -1, [note.visibility === 'public' ? 'publicNotes' : 'privateNotes']: -1,
        views: -(note.viewCount || 0), likes: -(note.likeCount || 0), favorites: -(note.favoriteCount || 0)
      });
      if (user.viewDay === viewDay(now())) user.todayViewCount = Math.max(0, (user.todayViewCount || 0) - todayViews(note, user.viewDay));
      // Stale references in other accounts are permission-filtered on every read.
      user.likedIds = (user.likedIds || []).filter((noteId) => noteId !== id);
      user.savedIds = (user.savedIds || []).filter((noteId) => noteId !== id);
      await remove(tx, 'notes', id);
      await put(tx, 'users', user.id, user);
      return { ok: true };
    });
  }
  async function toggle(event, context, kind) {
    const id = validId(event.id);
    if (event.active !== undefined && typeof event.active !== 'boolean') fail('互动状态不正确');
    return repo.transaction(async (tx) => {
      const user = await authenticate(tx, event, context);
      const note = await get(tx, 'notes', id);
      requireNote(note, user);
      const author = user.id === note.authorId ? user : await get(tx, 'users', note.authorId);
      const field = kind === 'like' ? 'likedIds' : 'savedIds';
      const counter = kind === 'like' ? 'likeCount' : 'favoriteCount';
      const stat = kind === 'like' ? 'likes' : 'favorites';
      const ids = user[field] || [];
      const active = ids.includes(id);
      // Explicit desired states make retries and concurrent duplicate taps idempotent.
      const nextActive = event.active === undefined ? !active : event.active;
      if (nextActive === active) return { ok: true, note: serializeNote(note, user, author, now()) };
      if (nextActive && ids.length >= INTERACTION_LIMIT) fail('每类最多收藏或点赞 1000 条笔记，请先取消部分记录');
      user[field] = nextActive ? ids.concat(id) : ids.filter((noteId) => noteId !== id);
      note[counter] = Math.max(0, (note[counter] || 0) + (nextActive ? 1 : -1));
      addStats(author, { [stat]: nextActive ? 1 : -1 });
      await put(tx, 'notes', id, note);
      await put(tx, 'users', user.id, user);
      if (author.id !== user.id) await put(tx, 'users', author.id, author);
      return { ok: true, note: serializeNote(note, user, author, now()) };
    });
  }
  async function getStats(event, context) {
    const user = await authenticate(repo, event, context);
    const countVisible = (ids) => ids && ids.length ? repo.countNotes(COLLECTIONS.notes, {
      scope: 'favorites', userId: user.id, ids
    }) : Promise.resolve(0);
    const [likedNotes, savedNotes] = await Promise.all([countVisible(user.likedIds), countVisible(user.savedIds)]);
    return { ok: true, stats: Object.assign(emptyStats(), user.stats, { todayViews: todayViews(user, viewDay(now())), likedNotes, savedNotes }) };
  }
  async function reportNote(event, context) {
    const id = validId(event.id);
    const reason = event.reason;
    if (!['infringement', 'privacy', 'content', 'other'].includes(reason)) fail('请选择举报原因');
    const detail = text(event.detail === undefined ? '' : event.detail, 300, '举报说明', false);
    await rateLimit(context, 'report', 10, 60 * 60 * 1000);
    const reportId = hash(context.openid + ':' + id + ':' + viewDay(now()));
    return repo.transaction(async tx => {
      const user = await authenticate(tx, event, context, true);
      const note = await get(tx, 'notes', id);
      requireNote(note, user);
      if (note.visibility !== 'public') fail('仅可举报公开笔记', 'NOTE_NOT_PUBLIC');
      const existing = await get(tx, 'reports', reportId);
      if (existing) return { ok: true, duplicate: true };
      await put(tx, 'reports', reportId, { id: reportId, noteId: id, reason, detail,
        reporterOpenid: context.openid, reporterId: user ? user.id : '',
        authorId: note.authorId, status: 'pending', createdAt: new Date(now()).toISOString() });
      return { ok: true, duplicate: false };
    });
  }
  const actions = {
    register, login, logout, whoami, updateProfile, prepareAvatar, finishAvatar,
    listNotes, getNote, saveNote, deleteNote, getStats, reportNote,
    toggleLike: (event, context) => toggle(event, context, 'like'),
    toggleNoteFavorite: (event, context) => toggle(event, context, 'favorite')
  };
  return async function handle(event, context) {
    try {
      if (!context || !context.openid) fail('请在微信小程序中使用此功能', 'INVALID_CONTEXT');
      if (!event || typeof event.action !== 'string' || !Object.prototype.hasOwnProperty.call(actions, event.action)) fail('不支持的操作');
      const result = await actions[event.action](event, context);
      if (!allowAvatarUploads && result.ok) {
        if (result.user) result.user.avatarUrl = '';
        if (result.note && result.note.author) result.note.author.avatarUrl = '';
        if (Array.isArray(result.notes)) result.notes.forEach(note => { if (note.author) note.author.avatarUrl = ''; });
      }
      return result;
    } catch (error) {
      if (error instanceof CommunityError) return { ok: false, error: error.message, code: error.code };
      // Credentials and private note bodies must never be printed in logs.
      try { onServiceError(diagnostic(error, event && event.action)); } catch (loggingError) { /* Logging cannot replace the failure response. */ }
      return { ok: false, error: '社区服务暂不可用，请稍后重试', code: 'SERVICE_UNAVAILABLE' };
    }
  };
}

module.exports = { createCommunity, COLLECTIONS, avatarText, CommunityError, passwordHash, passwordMatches, visible };
