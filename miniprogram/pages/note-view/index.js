const { findItem } = require('../../data/catalog');
const store = require('../../services/store');
const community = require('../../services/community');
const navigation = require('../../services/navigation');
function account() { return (community.getUser() || {}).id || 'guest'; }
function viewDay() { return Math.floor((Date.now() + 8 * 60 * 60 * 1000) / 86400000); }
function viewKey() { return 'read-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }

Page({
  data: { id: '', source: 'cloud', note: null, paragraphs: [], relatedTitle: '', loading: false, error: '', busy: false, user: null, demoMode: false,
    viewRecording: false, viewError: '', viewFeedback: '', reactionAction: '', reactionError: '', reporting: false, reportError: '' },
  onLoad(options = {}) {
    this.requestToken = (this.requestToken || 0) + 1;
    this.viewKey = viewKey();
    this.viewCycle = '';
    this.loadedOwner = null;
    this.localOwner = options.source === 'account-local' ? account() : null;
    this.setData({ id: String(options.id || ''), source: ['local', 'account-local'].includes(options.source) ? options.source : 'cloud',
      note: null, paragraphs: [], relatedTitle: '', busy: false, reactionAction: '', reactionError: '' });
  },
  onShow() {
    this.hidden = false;
    const user = community.getUser();
    this.setData({ user, demoMode: Boolean(user && user.isDemo), busy: false, reactionAction: '', reactionError: '', reporting: false, reportError: '' });
    return this.load();
  },
  onHide() { this.hidden = true; this.requestToken = (this.requestToken || 0) + 1; },
  onUnload() { this.onHide(); },
  async load() {
    const token = this.requestToken = (this.requestToken || 0) + 1;
    const owner = account();
    if (!this.ensureLocalOwner()) return;
    this.setData({ loading: true, error: '', note: null, paragraphs: [], relatedTitle: '', busy: false, reactionAction: '', reactionError: '',
      viewRecording: false, viewError: '', viewFeedback: '', reporting: false, reportError: '' });
    let result;
    try {
      result = this.data.source === 'local' ? { ok: true, note: store.getGuestNote(this.data.id) }
        : this.data.source === 'account-local' ? { ok: true, note: store.getState().notes.find(note => note.id === this.data.id) }
          : await community.getNote(this.data.id, { view: false });
    } catch (error) { result = { ok: false, error: '暂时无法连接云端，请重试或查看本机手记' }; }
    if (token !== this.requestToken || this.hidden) return;
    if (owner !== account()) {
      this.clearReader(result.error || '账号已改变，请重新打开笔记');
      return;
    }
    if (!result.ok || !result.note) {
      this.setData({ loading: false, error: result.error || '这篇笔记不存在或已设为私密' });
      if (wx.hideShareMenu) wx.hideShareMenu(); return;
    }
    this.loadedOwner = owner;
    this.renderNote(result.note);
    return this.recordView();
  },
  async recordView() {
    if (this.hidden || this.data.source !== 'cloud' || !this.data.note || this.data.loading || this.data.error) return;
    const owner = account();
    const cycle = this.data.id + ':' + owner + ':' + viewDay();
    if (this.viewCycle !== cycle) {
      if (this.viewCycle) this.viewKey = viewKey();
      this.viewCycle = cycle;
      this.viewed = false;
      this.lastViewFeedback = '';
    }
    if (this.data.note.mine) {
      this.setData({ viewFeedback: '作者本人浏览不计入次数', viewRecording: false, viewError: '' });
      return;
    }
    if (this.viewed) { this.setData({ viewFeedback: this.lastViewFeedback || '浏览统计已更新' }); return; }
    const token = this.requestToken;
    if (this.recordJob && this.recordJob.cycle === cycle && this.recordJob.token === token) return;
    const job = this.recordJob = { cycle, token };
    const isCurrent = () => this.recordJob === job && token === this.requestToken && !this.hidden && owner === account();
    try {
      // Wait for the rendered content; hidden or superseded pages must not submit a view.
      if (typeof wx.nextTick === 'function') await new Promise(resolve => wx.nextTick(resolve));
      else await Promise.resolve();
      if (!isCurrent()) return;
      this.setData({ viewRecording: true, viewError: '', viewFeedback: '' });
      const result = await community.recordNoteView(this.data.id, { viewKey: this.viewKey });
      if (this.recordJob !== job || token !== this.requestToken || this.hidden) return;
      if (owner !== account() || (!result.ok && ['NOTE_UNAVAILABLE', 'AUTH_REQUIRED'].includes(result.code))) {
        this.clearReader(result.error || '账号已改变，请重新打开笔记');
        return;
      }
      if (!result.ok) { this.setData({ viewError: result.error || '浏览统计更新失败，请重试' }); return; }
      const view = result.view;
      const current = this.data.note;
      if (!current || !view || !Number.isSafeInteger(view.viewCount) || view.viewCount < 0) {
        this.setData({ viewError: '浏览统计更新失败，请重试' }); return;
      }
      const note = { ...current, viewCount: Math.max(count(current.viewCount), view.viewCount) };
      if (Number.isSafeInteger(view.todayViewCount) && view.todayViewCount >= 0) {
        if (!Number.isInteger(current.viewDay) || !Number.isInteger(view.day) || current.viewDay <= view.day) {
          note.todayViewCount = current.viewDay === view.day ? Math.max(count(current.todayViewCount), view.todayViewCount) : view.todayViewCount;
          note.viewDay = view.day;
        }
      }
      this.viewed = true;
      this.lastViewFeedback = view.reason === 'AUTHOR' ? '作者本人浏览不计入次数' :
        view.reason === 'COUNTED' ? '本次浏览已记录' :
          view.reason === 'ALREADY_VIEWED_TODAY' ? '今天已浏览，次数不重复增加' : '浏览统计已更新';
      this.setData({ note, viewFeedback: this.lastViewFeedback, viewError: '' });
    } catch (error) {
      if (isCurrent()) this.setData({ viewError: '浏览统计更新失败，请重试' });
    } finally {
      if (isCurrent()) this.setData({ viewRecording: false });
      if (this.recordJob === job) this.recordJob = null;
    }
  },
  retryView() { return this.recordView(); },
  onPullDownRefresh() {
    return this.load().finally(() => { if (wx.stopPullDownRefresh) wx.stopPullDownRefresh(); });
  },
  renderNote(note) {
    const parts = (note.relatedKey || '').split(':');
    const related = parts.length === 2 ? findItem(parts[0], parts[1]) : null;
    const previous = this.data.note && this.data.note.id === note.id ? this.data.note : null;
    const normalized = { ...note, visibility: note.visibility || 'private',
      author: note.author || { username: '本机手记', avatarText: '记', tags: [], bio: '' },
      dateLabel: String(note.updatedAt || '').slice(0, 10),
      viewCount: Math.max(previous ? count(previous.viewCount) : 0, count(note.viewCount)),
      todayViewCount: Number.isSafeInteger(note.todayViewCount) && note.todayViewCount >= 0 ? note.todayViewCount : null,
      likeCount: count(note.likeCount), favoriteCount: count(note.favoriteCount), liked: note.liked === true, favorite: note.favorite === true };
    if (previous && previous.viewDay === note.viewDay && previous.todayViewCount !== null) {
      normalized.todayViewCount = Math.max(previous.todayViewCount, normalized.todayViewCount || 0);
    } else if (previous && Number.isInteger(previous.viewDay) && (!Number.isInteger(note.viewDay) || previous.viewDay > note.viewDay)) {
      normalized.viewDay = previous.viewDay;
      normalized.todayViewCount = previous.todayViewCount;
    }
    this.setData({ note: normalized, loading: false, error: '', relatedTitle: related ? related.title : '',
      paragraphs: note.body.split(/\n+/).map(line => line.trim()).filter(Boolean) });
    if (this.data.source === 'cloud' && note.visibility === 'public' && !this.data.demoMode && !note.isDemo) {
      if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
    } else if (wx.hideShareMenu) wx.hideShareMenu();
  },
  avatarError() { this.setData({ 'note.author.avatarUrl': '' }); },
  retry() { return this.load(); },
  login() { navigation.openAuth(); },
  clearReader(error) {
    this.requestToken = (this.requestToken || 0) + 1;
    this.recordJob = null;
    this.loadedOwner = null;
    this.setData({ loading: false, busy: false, reactionAction: '', reactionError: '', note: null, paragraphs: [], relatedTitle: '',
      viewRecording: false, viewError: '', viewFeedback: '', reporting: false, reportError: '', user: community.getUser(), error });
    if (wx.hideShareMenu) wx.hideShareMenu();
  },
  ensureLocalOwner() {
    if (this.data.source !== 'account-local') return true;
    const current = account();
    if (current !== 'guest' && this.localOwner === current) return true;
    this.clearReader('账号已改变，请从本机手记列表重新打开');
    return false;
  },
  async react(event) {
    if (this.hidden || !this.data.note || this.data.busy || this.data.loading || this.data.source !== 'cloud') return;
    if (this.loadedOwner !== account()) { this.clearReader('账号已改变，请重新打开笔记'); return; }
    if (!community.getUser()) { this.login(); return; }
    const action = event.currentTarget.dataset.action;
    if (!['like', 'favorite'].includes(action)) return;
    const owner = account();
    const id = this.data.id;
    const flag = action === 'like' ? 'liked' : 'favorite';
    const active = !this.data.note[flag];
    const token = this.requestToken;
    this.setData({ busy: true, reactionAction: action, reactionError: '' });
    let result;
    try { result = action === 'like' ? await community.toggleLike(id, { active }) : await community.toggleNoteFavorite(id, { active }); }
    catch (error) { result = { ok: false, error: '互动暂时无法保存，请重试' }; }
    if (token !== this.requestToken || this.hidden) return;
    if (owner !== account() || (!result.ok && ['NOTE_UNAVAILABLE', 'AUTH_REQUIRED'].includes(result.code))) {
      this.clearReader(result.error || '登录已失效，请重新登录');
      return;
    }
    this.setData({ busy: false, reactionAction: '' });
    const valid = result.ok && result.note && result.note.id === id && typeof result.note.title === 'string' &&
      typeof result.note.body === 'string' && typeof result.note[flag] === 'boolean' &&
      ['likeCount', 'favoriteCount'].every(field => Number.isSafeInteger(result.note[field]) && result.note[field] >= 0);
    if (valid) {
      this.renderNote(result.note);
      wx.showToast({ title: action === 'like' ? (result.note.liked ? '已点赞' : '已取消点赞') :
        (result.note.favorite ? '已加入笔记收藏' : '已取消笔记收藏'), icon: 'none' });
    } else {
      const error = result.error || '互动暂时无法保存，请重试';
      this.setData({ reactionError: error });
      wx.showToast({ title: error, icon: 'none' });
    }
  },
  edit() {
    if (!this.data.note) return;
    if (!this.ensureLocalOwner()) return;
    navigation.push('/pages/note-edit/index?id=' + encodeURIComponent(this.data.id) + '&source=' + this.data.source);
  },
  remove() {
    if (!this.data.note || this.data.busy) return;
    if (!this.ensureLocalOwner()) return;
    if (this.data.source === 'local' && community.getUser()) return;
    const id = this.data.id;
    const source = this.data.source;
    const account = (community.getUser() || {}).id || '';
    const token = this.requestToken;
    wx.showModal({ title: '删除这篇笔记？', content: '「' + this.data.note.title + '」删除后无法恢复。', confirmText: '删除', confirmColor: '#a44d46',
      success: async answer => {
        if (!answer.confirm || this.hidden || this.data.busy || token !== this.requestToken || id !== this.data.id || source !== this.data.source || !this.ensureLocalOwner() || account !== ((community.getUser() || {}).id || '')) return;
        this.setData({ busy: true });
        let result;
        try { result = source !== 'cloud' ? store.deleteNote(id) : await community.deleteNote(id); }
        catch (error) { result = { ok: false, error: '删除暂时失败，请重试' }; }
        if (this.hidden || account !== ((community.getUser() || {}).id || '')) return;
        this.setData({ busy: false });
        if (!result.ok) { wx.showToast({ title: result.error || '删除失败，请重试', icon: 'none' }); return; }
        wx.showToast({ title: '笔记已删除', icon: 'none' });
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/notes/index' }) });
      } });
  },
  openRelated() {
    const parts = (this.data.note.relatedKey || '').split(':');
    const related = findItem(parts[0], parts[1]);
    if (related) navigation.openDetail(related.kind, related.id);
  },
  backToNotes() { wx.switchTab({ url: '/pages/notes/index' }); },
  openLocalNotes() { navigation.openNotes('local'); },
  reportNote() {
    const note = this.data.note;
    if (!note || this.data.source !== 'cloud' || note.visibility !== 'public' || note.isDemo || this.data.demoMode || this.data.reporting) return;
    if (typeof wx.showActionSheet !== 'function') { wx.showToast({ title: '请在微信中提交内容举报', icon: 'none' }); return; }
    const context = { token: this.requestToken, id: this.data.id, owner: account() };
    wx.showActionSheet({ itemList: ['侵犯知识产权', '泄露个人隐私', '不当或有害内容', '其他问题'], success: result => {
      if (this.hidden || context.token !== this.requestToken || context.id !== this.data.id || context.owner !== account()) return;
      const reason = ['infringement', 'privacy', 'content', 'other'][result.tapIndex];
      if (reason) this.submitReport(reason, context);
    } });
  },
  async submitReport(reason, context) {
    const note = this.data.note;
    if (!note || this.data.reporting || !['infringement', 'privacy', 'content', 'other'].includes(reason) || this.data.source !== 'cloud' || this.data.demoMode || note.isDemo || note.visibility !== 'public') return;
    const token = this.requestToken;
    const id = this.data.id;
    const owner = account();
    if (context && (context.token !== token || context.id !== id || context.owner !== owner)) return;
    this.setData({ reporting: true, reportError: '' });
    let result;
    try { result = await community.reportNote(id, reason); }
    catch (error) { result = { ok: false, error: '举报提交失败，请稍后重试' }; }
    if (this.hidden || token !== this.requestToken) return;
    if (owner !== account() || id !== this.data.id) { this.setData({ reporting: false, reportError: '账号或笔记已变化，请重新打开后提交' }); return; }
    this.setData({ reporting: false, reportError: result.ok ? '' : result.error || '举报提交失败，请重试' });
    if (result.ok) wx.showToast({ title: '已提交，待运营者处理', icon: 'none' });
  },
  onShareAppMessage() {
    const note = this.data.note;
    if (this.data.demoMode || (note && note.isDemo) || (community.getUser() || {}).isDemo) {
      return { title: '百草源 · 无需注册体验官方演示', path: '/pages/auth/index' };
    }
    return note && note.visibility === 'public' && this.data.source === 'cloud'
      ? { title: '百草源 · ' + note.title, path: '/pages/note-view/index?id=' + encodeURIComponent(note.id) }
      : { title: '百草源 · 草木手记', path: '/pages/notes/index' };
  }
});
