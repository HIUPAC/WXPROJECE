const { findItem } = require('../../data/catalog');
const store = require('../../services/store');
const community = require('../../services/community');
const config = require('../../config');
const DRAFT_KEY = 'herb-origin:note-draft';
function owner() { return (community.getUser() || {}).id || 'guest'; }
function snapshot(form) { return JSON.stringify([form.title || '', form.body || '', form.relatedKey || '', form.visibility || 'private']); }
Page({
  data: { id: '', source: 'local', title: '', body: '', relatedKey: '', relatedTitle: '', visibility: 'private',
    dirty: false, draftSaved: false, saving: false, loading: false, loadError: '', user: null,
    accountChanged: false, importing: false, demoMode: false, titleCount: 0, bodyCount: 0, saveError: '', localEdition: config.serviceMode === 'local',
    bodyPlaceholder: '今天读到了什么？\n观察到了怎样的草木？\n慢慢写，让想法在这里生根。' },
  async onLoad(options = {}) {
    this.openOptions = options;
    this.restoreConfirmed = options.restoreDraft === true;
    this.creationKey = 'create-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    this.ownerId = owner();
    this.draftKey = DRAFT_KEY + (this.ownerId === 'guest' ? '' : ':' + this.ownerId);
    const id = String(options.id || '');
    const user = community.getUser();
    const accountLocal = Boolean(user && (options.source === 'account-local' || this.data.localEdition && !user.isDemo && !id));
    const source = accountLocal ? 'account-local' : options.source === 'local' || !user ? 'local' : 'cloud';
    this.setData({ user, demoMode: Boolean(user && user.isDemo), source, loading: Boolean(id), loadError: '', accountChanged: false });
    let note = null;
    if (id) {
      if (source === 'local') note = store.getGuestNote(id);
      else if (source === 'account-local') note = store.getState().notes.find(note => note.id === id);
      else {
        let result;
        try { result = await community.getNote(id, { view: false }); }
        catch (error) { result = { ok: false, error: '云端笔记暂时无法加载，请重试。已有草稿保留在本机。' }; }
        if (this.unloaded) return;
        if (this.ownerId !== owner()) {
          this.setData({ loading: false, accountChanged: true, user: community.getUser(), loadError: result.error || '请重新登录后编辑笔记' });
          return;
        }
        if (!result.ok) { this.setData({ loading: false, loadError: result.error || '笔记加载失败' }); return; }
        note = result.note;
        if (note && !note.mine) { this.setData({ loading: false, loadError: '只有作者可以编辑这篇笔记' }); return; }
      }
      if (!note) { this.setData({ loading: false, loadError: '找不到这篇笔记，可能已被删除' }); return; }
    }
    const importing = Boolean(user && source === 'local' && note);
    let form = note || { title: '', body: '', relatedKey: options.relatedKey || '', visibility: 'private' };
    const pending = getApp().globalData || {};
    const seed = pending.noteSeed;
    let seedApplied = false;
    if (!id && options.seed && seed && seed.key === options.seed) {
      delete pending.noteSeed;
      if (seed.ownerId === this.ownerId && seed.expiresAt > Date.now() && seed.relatedKey === form.relatedKey) {
        form = { ...form, title: seed.title, body: seed.body };
        seedApplied = true;
      }
    }
    this.original = snapshot(form);
    this.setData({ id: importing ? '' : id, source: source === 'account-local' ? source : user ? 'cloud' : 'local', importing, loading: false, ...this.formData(form) });
    this.seedApplied = seedApplied;
    if (seedApplied) { this.original = snapshot({ relatedKey: form.relatedKey }); this.updateDirty(); }
    const restoring = this.restoreDraft();
    if (seedApplied && !restoring) this.saveDraft();
  },
  onShow() {
    if (!this.ownerId) return;
    const current = owner();
    if (current === this.ownerId) {
      const user = community.getUser();
      this.setData({ user, demoMode: Boolean(user && user.isDemo), accountChanged: false });
      if (this.data.loadError && this.original === undefined) return this.onLoad(this.openOptions);
      if (this.original !== undefined) this.updateDirty();
      return;
    }
    if (this.ownerId === 'guest' && this.loginForUpload && current !== 'guest') {
      this.clearOwnedDraft();
      this.ownerId = current;
      this.draftKey = DRAFT_KEY + ':' + current;
      this.loginForUpload = false;
      const user = community.getUser();
      this.setData({ id: '', source: 'cloud', user, demoMode: Boolean(user && user.isDemo), importing: true, accountChanged: false });
      this.updateDirty(); this.saveDraft();
    } else this.setData({ loading: false, accountChanged: true, user: community.getUser() });
  },
  restoreDraft() {
    let draft;
    try { draft = wx.getStorageSync(this.draftKey); } catch (error) { return false; }
    if (!draft || typeof draft.noteId !== 'string' || (!this.seedApplied && (draft.noteId !== this.data.id || (draft.relatedKey || '') !== this.data.relatedKey)) ||
      typeof draft.title !== 'string' || typeof draft.body !== 'string' || snapshot(draft) === this.original) return;
    this.restoringDraft = true;
    const apply = () => {
      this.restoringDraft = false;
      if (typeof draft.creationKey === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(draft.creationKey)) this.creationKey = draft.creationKey;
      this.setData({ ...this.formData(draft), draftSaved: true }); this.updateDirty();
    };
    if (this.restoreConfirmed) { this.restoreConfirmed = false; apply(); return true; }
    wx.showModal({ title: '继续上次的草稿？', content: '这台设备上有一篇尚未保存的笔记草稿。', confirmText: '继续编辑', cancelText: '重新开始',
      success: answer => {
        if (this.unloaded || this.ownerId !== owner()) return;
        if (answer.confirm) {
          const draftSource = ['local', 'account-local', 'cloud'].includes(draft.source) ? draft.source : (community.getUser() ? 'cloud' : 'local');
          if (draft.noteId !== this.data.id || draftSource !== this.data.source) {
            return this.onLoad({ id: draft.noteId, relatedKey: draft.relatedKey,
              source: draftSource, restoreDraft: true });
          }
          apply();
        }
        else if (answer.cancel) { this.restoringDraft = false; this.clearOwnedDraft(); if (this.seedApplied) this.saveDraft(); }
      }, fail: () => { this.setData({ loadError: '草稿选择暂时无法打开，请返回后重试' }); } });
    return true;
  },
  formData(form) {
    const title = String(form.title || '').slice(0, 80);
    const body = String(form.body || '').slice(0, 10000);
    let relatedKey = typeof form.relatedKey === 'string' ? form.relatedKey : '';
    const parts = relatedKey.split(':');
    const related = parts.length === 2 ? findItem(parts[0], parts[1]) : null;
    if (!related) relatedKey = '';
    return { title, body, relatedKey, relatedTitle: related ? related.title : '', titleCount: title.length,
      bodyCount: body.length, visibility: form.visibility === 'public' ? 'public' : 'private' };
  },
  onTitleInput(event) {
    const title = String(event.detail.value || '').slice(0, 80);
    this.setData({ title, titleCount: title.length, saveError: '' }); this.updateDirty(); this.saveDraft();
  },
  onBodyInput(event) {
    const body = String(event.detail.value || '').slice(0, 10000);
    this.setData({ body, bodyCount: body.length, saveError: '' }); this.updateDirty(); this.saveDraft();
  },
  chooseVisibility(event) {
    if (this.data.saving) return;
    const visibility = event.currentTarget.dataset.visibility;
    if (!['private', 'public'].includes(visibility)) return;
    if (visibility === 'public' && this.data.localEdition && !this.data.demoMode) { wx.showToast({ title: '本机学习版暂不开放云端分享', icon: 'none' }); return; }
    this.setData({ visibility }); this.updateDirty(); this.saveDraft();
  },
  updateDirty() {
    const dirty = snapshot(this.data) !== this.original;
    this.setData({ dirty });
    if (dirty && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '笔记尚未保存，离开后可从本机草稿继续编辑。' });
    else if (!dirty && wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  },
  clearOwnedDraft() {
    try {
      const draft = wx.getStorageSync(this.draftKey);
      if (draft && draft.noteId === this.data.id && (draft.relatedKey || '') === this.data.relatedKey) wx.removeStorageSync(this.draftKey);
    } catch (error) { /* Draft cleanup can be retried. */ }
  },
  saveDraft(updateStatus = true) {
    if (this.restoringDraft || this.ownerId !== owner()) return;
    if (!this.data.dirty) {
      if (updateStatus) this.setData({ draftSaved: false });
      this.clearOwnedDraft(); return;
    }
    try {
      wx.setStorageSync(this.draftKey, { noteId: this.data.id, source: this.data.source, title: this.data.title, body: this.data.body,
        relatedKey: this.data.relatedKey, visibility: this.data.visibility, creationKey: this.creationKey, updatedAt: Date.now() });
      if (updateStatus) this.setData({ draftSaved: true });
    } catch (error) {
      if (updateStatus) this.setData({ draftSaved: false });
      if (updateStatus && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '笔记尚未保存，离开后将丢失本次输入。' });
    }
  },
  login() {
    this.loginForUpload = true;
    this.saveDraft();
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
    wx.navigateTo({ url: '/pages/auth/index', fail: () => {
      this.loginForUpload = false; this.updateDirty();
      wx.showToast({ title: '登录页打开失败，请返回后重试', icon: 'none' });
    } });
  },
  uploadCopy() {
    if (this.data.saving || this.data.source !== 'account-local' || !community.getUser()) return;
    if (this.data.localEdition && !this.data.demoMode) return;
    this.clearOwnedDraft();
    this.setData({ id: '', source: 'cloud', importing: true, saveError: '' });
    this.updateDirty(); this.saveDraft();
  },
  async save() {
    if (this.data.saving || this.data.loading || this.data.loadError || this.data.accountChanged) return;
    if (this.ownerId !== owner()) { this.setData({ accountChanged: true }); return; }
    const title = this.data.title.trim(), body = this.data.body.trim();
    if (!title || !body) { wx.showToast({ title: !title ? '请为笔记写一个标题' : '请写下笔记内容', icon: 'none' }); return; }
    if (this.data.visibility === 'public' && !community.getUser()) { this.login(); return; }
    this.setData({ saving: true, saveError: '' });
    const localPublication = this.data.source === 'account-local' && this.data.visibility === 'public';
    const input = { id: localPublication ? undefined : this.data.id || undefined, title, body, relatedKey: this.data.relatedKey, visibility: this.data.visibility,
      creationKey: this.data.id && !localPublication ? undefined : this.creationKey };
    let result;
    try { result = this.data.source === 'cloud' || localPublication ? await community.saveNote(input) : store.saveNote(input); }
    catch (error) { result = { ok: false, error: '保存暂时失败，请稍后重试' }; }
    if (this.unloaded) return;
    if (this.ownerId !== owner()) { this.setData({ saving: false, accountChanged: true, user: community.getUser() }); return; }
    if (!result.ok) {
      this.saveDraft();
      this.setData({ saving: false, saveError: result.error || '保存失败，请重试' });
      wx.showToast({ title: result.error || '保存失败，请重试', icon: 'none' }); return;
    }
    this.saved = true;
    this.clearOwnedDraft();
    this.setData({ dirty: false, draftSaved: false, saving: false });
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
    wx.showToast({ title: this.data.source === 'account-local' && !localPublication ? '本机手记已保存' : this.data.demoMode ? '演示笔记已保存' : (this.data.visibility === 'public' ? '笔记已公开' : '笔记已保存'), icon: 'success' });
    getApp().globalData.notesScope = this.data.source === 'account-local' && !localPublication ? 'local' : 'my';
    getApp().globalData.notesRelatedKey = '';
    if (this.data.importing) wx.switchTab({ url: '/pages/notes/index' });
    else this.leave();
  },
  onBack() {
    if (this.data.saving) { wx.showToast({ title: '笔记正在保存，请稍候', icon: 'none' }); return; }
    if (!this.data.dirty) { this.leave(); return; }
    this.saveDraft();
    wx.showModal({ title: '离开编辑？', content: this.data.draftSaved ? '当前输入已保存在本机草稿中，下次打开可继续编辑。' : '当前输入未能保存为草稿，离开后将丢失本次修改。',
      confirmText: '离开', cancelText: '继续编辑', success: answer => {
        if (!answer.confirm) return;
        if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
        this.leave();
      } });
  },
  retryLoad() { return this.onLoad(this.openOptions); },
  leave() { wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/notes/index' }) }); },
  onHide() { if (!this.saved && this.data.dirty) this.saveDraft(false); },
  onUnload() {
    this.unloaded = true;
    if (!this.saved && this.data.dirty) this.saveDraft(false);
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  }
});
