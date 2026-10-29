const { catalog, findItem } = require('../../data/catalog');
const store = require('../../services/store');
const community = require('../../services/community');
const navigation = require('../../services/navigation');
const config = require('../../config');
const scopes = ['my', 'public', 'favorites', 'liked', 'local', 'featured'];
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function owner() { return (community.getUser() || {}).id || ''; }
function preserveViews(note, previous) {
  if (!previous) return note;
  note = { ...note, viewCount: Math.max(note.viewCount, previous.viewCount) };
  if (Number.isInteger(previous.viewDay) && previous.viewDay === note.viewDay && previous.todayViewCount !== null) {
    note.todayViewCount = Math.max(previous.todayViewCount, note.todayViewCount || 0);
  } else if (Number.isInteger(previous.viewDay) && (!Number.isInteger(note.viewDay) || previous.viewDay > note.viewDay)) {
    note.viewDay = previous.viewDay;
    note.todayViewCount = previous.todayViewCount;
  }
  return note;
}
function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return date.getFullYear() + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + String(date.getDate()).padStart(2, '0');
}
function row(note, local, source = 'local') {
  return { id: note.id, listKey: (local ? source : 'cloud') + ':' + note.id, title: note.title, visibility: note.visibility || 'private',
    preview: (note.body || '').replace(/\s+/g, ' ').slice(0, 108), dateLabel: dateLabel(note.updatedAt),
    author: note.author || { username: source === 'account-local' ? '账号本机手记' : '游客手记', avatarText: '记' }, source: local ? source : 'cloud',
    mine: local || note.mine, viewCount: local ? 0 : count(note.viewCount), likeCount: local ? 0 : count(note.likeCount),
    todayViewCount: !local && Number.isSafeInteger(note.todayViewCount) && note.todayViewCount >= 0 ? note.todayViewCount : null,
    viewDay: !local && Number.isInteger(note.viewDay) ? note.viewDay : null,
    favoriteCount: local ? 0 : count(note.favoriteCount), liked: !local && Boolean(note.liked), favorite: !local && Boolean(note.favorite),
    actionLoading: '', relatedKey: note.relatedKey || '' };
}
Page({
  data: { scope: 'my', user: null, notes: [], featured: [], officialPreview: [], officialTotal: 0, total: 0, loading: false, error: '',
    hasMore: false, relatedKey: '', relatedTitle: '', query: '', needsLogin: false, searchPending: false, localEdition: config.serviceMode === 'local' },
  onLoad(options = {}) {
    if (scopes.includes(options.scope)) {
      getApp().globalData.notesScope = options.scope;
      getApp().globalData.notesRelatedKey = typeof options.relatedKey === 'string' ? options.relatedKey : '';
    }
  },
  onShow() {
    this.hidden = false;
    const pending = getApp().globalData || {};
    const changes = { user: community.getUser() };
    if (scopes.includes(pending.notesScope)) changes.scope = pending.notesScope;
    if (this.data.localEdition && !(changes.user || {}).isDemo && ['public', 'favorites', 'liked'].includes(changes.scope || this.data.scope)) changes.scope = 'featured';
    if (typeof pending.notesRelatedKey === 'string') {
      const parts = pending.notesRelatedKey.split(':');
      const related = parts.length === 2 ? findItem(parts[0], parts[1]) : null;
      changes.relatedKey = related ? pending.notesRelatedKey : '';
      changes.relatedTitle = related ? related.title : '';
      changes.query = '';
    }
    delete pending.notesScope; delete pending.notesRelatedKey;
    this.setData(changes);
    return this.refresh();
  },
  onHide() {
    this.hidden = true;
    this.invalidateRequests();
    this.setData({ loading: false, searchPending: false, notes: this.data.notes.map(note => ({ ...note, actionLoading: '' })) });
  },
  onUnload() { this.onHide(); },
  invalidateRequests() {
    clearTimeout(this.searchTimer);
    this.requestToken = (this.requestToken || 0) + 1;
    this.feedVersion = (this.feedVersion || 0) + 1;
    this.actionJobs = Object.create(null);
  },
  accountChanged(error) {
    this.invalidateRequests();
    this.nextOffset = 0;
    const user = community.getUser();
    this.setData({ user, loading: false, searchPending: false, notes: [], total: 0, hasMore: false,
      error: error || '账号已改变，请刷新后重试', needsLogin: this.data.scope !== 'public' && !user });
  },
  async refresh() {
    this.invalidateRequests();
    this.nextOffset = 0;
    this.feedOwner = owner();
    this.noteUpdates = Object.create(null);
    this.noteRevision = 0;
    this.setData({ user: community.getUser(), notes: [], total: 0, hasMore: false, error: '', loading: false, needsLogin: false, searchPending: false });
    const query = this.data.query.trim().toLowerCase();
    const official = catalog.filter(item => item.kind === 'note' &&
      (!this.data.relatedKey || (item.relatedKeys || []).includes(this.data.relatedKey)) &&
      (!query || (item.title + ' ' + item.description + ' ' + item.body).toLowerCase().includes(query)))
      .map(item => ({ id: item.id, kind: item.kind, title: item.title, subtitle: item.subtitle, category: item.category,
        description: item.description, image: item.image, favorite: store.isFavorite(item) }));
    this.setData({ officialPreview: official.slice(0, 3), officialTotal: official.length });
    if (this.data.scope === 'featured') {
      this.setData({ featured: official }); return;
    }
    const local = this.data.scope === 'local' || (this.data.scope === 'my' && (!community.getUser() || this.data.localEdition && !community.getUser().isDemo));
    if (local) {
      const state = this.data.scope === 'local' ? store.getGuestState() : store.getState();
      const query = this.data.query.trim().toLowerCase();
      const entries = state.notes.map(note => ({ note, source: this.data.scope !== 'local' && community.getUser() ? 'account-local' : 'local' }));
      if (this.data.scope === 'local' && community.getUser()) {
        // Account-owned backups and offline notes remain separate from the guest notebook.
        const accountNotes = store.getState().notes;
        entries.unshift(...accountNotes.map(note => ({ note, source: 'account-local' })));
      }
      const notes = entries.filter(({ note }) => (!this.data.relatedKey || note.relatedKey === this.data.relatedKey) &&
        (!query || (note.title + ' ' + note.body).toLowerCase().includes(query)))
        .sort((a, b) => Date.parse(b.note.updatedAt) - Date.parse(a.note.updatedAt))
        .map(entry => row(entry.note, true, entry.source));
      this.setData({ notes, total: notes.length }); return;
    }
    if (['favorites', 'liked'].includes(this.data.scope) && !community.getUser()) {
      this.setData({ needsLogin: true }); return;
    }
    await this.fetchNotes(false);
  },
  async fetchNotes(append) {
    if (this.data.loading || this.data.searchPending || this.hidden) return;
    if (this.feedOwner !== undefined && this.feedOwner !== owner()) { this.accountChanged(); return; }
    const token = this.requestToken = (this.requestToken || 0) + 1;
    const userId = owner();
    const revision = this.noteRevision || 0;
    const offset = append ? (this.nextOffset === undefined ? this.data.notes.length : this.nextOffset) : 0;
    this.setData({ loading: true, error: '' });
    let result;
    try {
      result = await community.listNotes({ scope: this.data.scope, offset, limit: 20,
        relatedKey: this.data.relatedKey, query: this.data.query.trim() });
    } catch (error) { result = { ok: false, error: '云端暂时无法连接，可以阅读官方精选或查看本机手记' }; }
    if (token !== this.requestToken || this.hidden) return;
    if (userId !== owner() || result && ['AUTH_REQUIRED', 'ACCOUNT_CHANGED'].includes(result.code)) {
      this.accountChanged(result && result.error);
      return;
    }
    if (!result || !result.ok) { this.setData({ loading: false, error: result && result.error || '笔记加载失败，请重试' }); return; }
    const incoming = Array.isArray(result.notes) ? result.notes : [];
    const merged = new Map((append ? this.data.notes : []).map(note => [note.listKey, note]));
    incoming.forEach(note => {
      if (!note || typeof note.id !== 'string' || !note.id) return;
      let entry = row(note, false);
      const update = (this.noteUpdates || {})[entry.listKey];
      // A list request may have started before a successful quick action.
      if (update && update.revision > revision) entry = update.note;
      if (update && update.revision > revision && update.removed) return;
      const job = (this.actionJobs || {})[entry.listKey];
      merged.set(entry.listKey, { ...preserveViews(entry, merged.get(entry.listKey)), actionLoading: job ? job.action : '' });
    });
    const notes = [...merged.values()];
    this.nextOffset = offset + incoming.length;
    this.setData({ notes, total: Number.isSafeInteger(result.total) && result.total >= 0 ? result.total : notes.length,
      hasMore: Boolean(result.hasMore) && incoming.length > 0, loading: false });
  },
  switchTab(event) {
    const scope = event.currentTarget.dataset.scope;
    if (!scopes.includes(scope)) return;
    this.setData(scope === 'featured' ? { scope, relatedKey: '', relatedTitle: '', query: '' } : { scope }); this.refresh();
  },
  searchInput(event) {
    this.invalidateRequests();
    this.setData({ query: String(event.detail.value || '').slice(0, 100), loading: false, searchPending: true,
      notes: this.data.notes.map(note => ({ ...note, actionLoading: '' })) });
    this.searchTimer = setTimeout(() => this.refresh(), 200);
  },
  clearRelated() { this.setData({ relatedKey: '', relatedTitle: '' }); this.refresh(); },
  loadMore() { if (this.data.hasMore && !this.data.loading && !this.data.searchPending) return this.fetchNotes(true); },
  onReachBottom() { this.loadMore(); },
  retry() { this.refresh(); },
  onPullDownRefresh() {
    return this.refresh().finally(() => { if (wx.stopPullDownRefresh) wx.stopPullDownRefresh(); });
  },
  login() { navigation.openAuth(); },
  openLocalNotes() { this.switchTab({ currentTarget: { dataset: { scope: 'local' } } }); },
  openOfficialNotes() { this.switchTab({ currentTarget: { dataset: { scope: 'featured' } } }); },
  openPublicNotes() { this.switchTab({ currentTarget: { dataset: { scope: 'public' } } }); },
  createNote() {
    const options = [];
    const user = community.getUser();
    if (this.data.relatedKey) options.push('relatedKey=' + encodeURIComponent(this.data.relatedKey));
    if (user && (this.data.scope === 'local' || this.data.localEdition && !user.isDemo)) options.push('source=account-local');
    navigation.push('/pages/note-edit/index' + (options.length ? '?' + options.join('&') : ''));
  },
  openNote(event) {
    const { id, source } = event.currentTarget.dataset;
    if (['cloud', 'account-local'].includes(source) && this.feedOwner !== owner()) { this.accountChanged(); return; }
    navigation.push('/pages/note-view/index?id=' + encodeURIComponent(id) + '&source=' + source);
  },
  updateCloudRow(listKey, updated, removed) {
    this.noteRevision = (this.noteRevision || 0) + 1;
    if (!this.noteUpdates) this.noteUpdates = Object.create(null);
    this.noteUpdates[listKey] = { note: removed ? null : updated, revision: this.noteRevision, removed };
    const notes = removed ? this.data.notes.filter(entry => entry.listKey !== listKey)
      : this.data.notes.map(entry => entry.listKey === listKey ? updated : entry);
    const wasLoading = this.data.loading;
    const changes = { notes };
    if (removed) {
      this.nextOffset = Math.max(0, (this.nextOffset === undefined ? this.data.notes.length : this.nextOffset) - 1);
      changes.total = Math.max(0, this.data.total - 1);
      changes.hasMore = this.data.hasMore && changes.total > notes.length;
      // Removing an item shifts the server offset, so discard any older append request.
      if (wasLoading) { this.requestToken = (this.requestToken || 0) + 1; changes.loading = false; }
    }
    this.setData(changes);
    return removed && wasLoading && this.data.hasMore;
  },
  async react(event) {
    if (this.hidden || this.data.searchPending) return;
    const { action, listKey } = event.currentTarget.dataset;
    if (!['like', 'favorite'].includes(action)) return;
    const note = this.data.notes.find(entry => entry.listKey === listKey);
    if (!note || note.source !== 'cloud') return;
    const user = community.getUser();
    if (this.feedOwner !== owner()) { this.accountChanged(); if (!user) this.login(); return; }
    if (!user) { this.login(); return; }
    if (!this.actionJobs) this.actionJobs = Object.create(null);
    if (this.actionJobs[listKey]) return;
    const job = this.actionJobs[listKey] = { action, owner: user.id, version: this.feedVersion };
    this.setData({ notes: this.data.notes.map(entry => entry.listKey === listKey ? { ...entry, actionLoading: action } : entry) });
    let result;
    try {
      result = action === 'like' ? await community.toggleLike(note.id, { active: !note.liked })
        : await community.toggleNoteFavorite(note.id, { active: !note.favorite });
    } catch (error) { result = { ok: false, error: '互动暂时无法保存，请重试' }; }
    if (this.hidden || job.version !== this.feedVersion || this.actionJobs[listKey] !== job) return;
    delete this.actionJobs[listKey];
    if (job.owner !== owner() || result && ['AUTH_REQUIRED', 'ACCOUNT_CHANGED'].includes(result.code)) {
      this.accountChanged(result && result.error); return;
    }
    if (result && !result.ok && result.code === 'NOTE_UNAVAILABLE') {
      const reload = this.updateCloudRow(listKey, null, true);
      wx.showToast({ title: result.error || '这篇笔记不存在或已设为私密', icon: 'none' });
      if (reload) return this.fetchNotes(true);
      return;
    }
    if (!result || !result.ok || !result.note || result.note.id !== note.id ||
      typeof result.note.liked !== 'boolean' || typeof result.note.favorite !== 'boolean' ||
      !['viewCount', 'likeCount', 'favoriteCount'].every(field => Number.isSafeInteger(result.note[field]) && result.note[field] >= 0)) {
      this.setData({ notes: this.data.notes.map(entry => entry.listKey === listKey ? { ...entry, actionLoading: '' } : entry) });
      wx.showToast({ title: result && result.error || '互动暂时无法保存，请重试', icon: 'none' });
      return;
    }
    const updated = preserveViews(row(result.note, false), this.data.notes.find(entry => entry.listKey === listKey));
    const removed = this.data.scope === 'favorites' && !updated.favorite || this.data.scope === 'liked' && !updated.liked ||
      this.data.scope === 'public' && updated.visibility !== 'public';
    const reload = this.updateCloudRow(listKey, updated, removed);
    wx.showToast({ title: action === 'like' ? (updated.liked ? '已点赞' : '已取消点赞') : (updated.favorite ? '已收藏笔记' : '已取消收藏'), icon: 'none' });
    if (reload) return this.fetchNotes(true);
  },
  toggleFavorite(event) {
    let result;
    try { result = store.toggleFavorite(event.detail.item); }
    catch (error) { result = { ok: false, error: '收藏暂时无法保存，请重试' }; }
    wx.showToast({ title: result.ok ? (result.favorite ? '已加入收藏' : '已取消收藏') : result.error, icon: 'none' });
    if (result.ok) {
      const id = event.detail.item.id;
      const update = item => item.id === id ? { ...item, favorite: result.favorite } : item;
      this.setData({ featured: this.data.featured.map(update), officialPreview: this.data.officialPreview.map(update) });
    }
  },
  onShareAppMessage() { return { title: '百草源 · 草木手记', path: '/pages/notes/index?scope=public' }; }
});
