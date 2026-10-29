const community = require('../../services/community');
const navigation = require('../../services/navigation');

function avatarText(username) {
  const name = String(username || '').trim();
  const letter = name.match(/[\u3400-\u9fffA-Za-z]/u);
  return (letter ? letter[0] : Array.from(name)[0] || '草').toUpperCase();
}

function masked(value, phone) {
  const text = String(value || '');
  if (!text) return '未填写';
  if (phone && text.length === 11) return text.slice(0, 3) + '****' + text.slice(-4);
  return text.length > 4 ? text.slice(0, 2) + '****' + text.slice(-2) : '****';
}

function tagsFromText(value) {
  return String(value || '').split(/[，,、;；\n]/).map(tag => tag.trim()).filter((tag, index, tags) => tag && tags.indexOf(tag) === index);
}

Page({
  data: {
    authenticated: false, username: '', tagsText: '', bio: '', avatarUrl: '', avatarText: '草',
    pendingAvatar: '', avatarFailed: false, maskedStudentId: '', maskedPhone: '',
    saving: false, dirty: false, error: '', sessionExpired: false, demoMode: false, cloudAvatarEnabled: false,
  },

  onLoad() {
    const user = community.getUser();
    if (!user) return;
    this.ownerId = user.id;
    const form = {
      username: user.username || '', tagsText: (user.tags || []).join('，'), bio: user.bio || '',
      avatarUrl: user.avatarUrl || '', pendingAvatar: '',
    };
    this.original = this.snapshot(form);
    this.setData({
      ...form, authenticated: true, avatarText: avatarText(user.username), demoMode: user.isDemo === true, cloudAvatarEnabled: user.isDemo === true,
      maskedStudentId: masked(user.studentId, false), maskedPhone: masked(user.phone, true),
    });
  },

  snapshot(form) {
    return JSON.stringify([form.username || '', tagsFromText(form.tagsText), form.bio || '', form.avatarUrl || '', form.pendingAvatar || '']);
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!['username', 'tagsText', 'bio'].includes(field) || this.data.saving) return;
    const updates = { [field]: event.detail.value, error: '' };
    if (field === 'username') updates.avatarText = avatarText(event.detail.value);
    this.setData(updates);
    this.updateDirty();
  },

  chooseAvatar(event) {
    if (this.data.saving || !this.data.cloudAvatarEnabled) return;
    const pendingAvatar = event.detail && event.detail.avatarUrl;
    if (!pendingAvatar) return;
    this.setData({ pendingAvatar, avatarFailed: false, error: '' });
    this.updateDirty();
  },

  resetAvatar() {
    if (this.data.saving) return;
    this.setData({ avatarUrl: '', pendingAvatar: '', avatarFailed: false, error: '' });
    this.updateDirty();
  },

  onAvatarError() {
    this.setData({ avatarFailed: true });
  },

  updateDirty() {
    const dirty = this.snapshot(this.data) !== this.original;
    this.setData({ dirty });
    if (dirty && typeof wx.enableAlertBeforeUnload === 'function') wx.enableAlertBeforeUnload({ message: '个人资料尚未保存，离开后会丢失本次修改。' });
    else if (!dirty && typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
  },

  checkAccount() {
    const user = community.getUser();
    if (user && user.id === this.ownerId) return true;
    this.setData({
      sessionExpired: !user,
      error: user ? '登录状态已变化，请重新打开个人资料' : '登录状态已变化，请重新登录后保存',
    });
    return false;
  },

  async save() {
    if (this.data.saving || !this.data.authenticated) return;
    if (!this.checkAccount()) return;
    const username = this.data.username.trim();
    const tags = tagsFromText(this.data.tagsText);
    const bio = this.data.bio.trim();
    if (!username || username.length > 20) {
      this.setData({ error: '用户名须为 1–20 字' }); return;
    }
    if (tags.length > 6 || tags.some(tag => tag.length > 12)) {
      this.setData({ error: '最多填写 6 个标签，每个最多 12 字' }); return;
    }
    if (bio.length > 200) {
      this.setData({ error: '个人简介最多 200 字' }); return;
    }
    this.setData({ saving: true, error: '' });
    try {
      let avatarUrl = this.data.avatarUrl;
      if (this.data.pendingAvatar) {
        const uploaded = await community.uploadAvatar(this.data.pendingAvatar);
        if (this.disposed) return;
        if (!uploaded.ok) {
          if (!this.checkAccount()) return;
          this.setData({ error: uploaded.error || '头像上传失败，请重试' }); return;
        }
        avatarUrl = uploaded.avatarUrl;
        this.setData({ avatarUrl, pendingAvatar: '' });
      }
      if (!this.checkAccount()) return;
      const result = await community.updateProfile({ username, tags, bio, avatarUrl });
      if (this.disposed) return;
      if (!result.ok) {
        if (!this.checkAccount()) return;
        this.setData({ error: result.error || '资料保存失败，请重试' }); return;
      }
      this.setData({ dirty: false });
      if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
      wx.showToast({ title: '资料已更新', icon: 'success' });
      this.leave();
    } catch (error) {
      if (!this.disposed) this.setData({ error: '网络暂时不可用，请稍后重试' });
    } finally {
      if (!this.disposed) this.setData({ saving: false });
    }
  },

  openAuth() {
    navigation.openAuth();
  },

  onShow() {
    const user = community.getUser();
    if (!this.data.authenticated && user) this.onLoad();
    else if (this.data.sessionExpired && user && user.id === this.ownerId) this.setData({ sessionExpired: false, error: '' });
  },

  onBack() {
    if (this.data.saving) return;
    if (!this.data.dirty) { this.leave(); return; }
    wx.showModal({ title: '离开编辑？', content: '个人资料尚未保存，离开后会丢失本次修改。', confirmText: '离开', cancelText: '继续编辑', success: result => {
      if (!result.confirm) return;
      if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
      this.leave();
    } });
  },

  leave() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/profile/index' }) });
  },

  onUnload() {
    this.disposed = true;
    if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
  },
});
