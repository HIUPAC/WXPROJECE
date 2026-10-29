const { catalog, findItem, itemPath } = require('../../data/catalog');
const store = require('../../services/store');
const community = require('../../services/community');
const navigation = require('../../services/navigation');
const play = require('../../services/play');
const backups = require('../../services/backup');
const config = require('../../config');
const FAVORITE_PAGE_SIZE = 24;

function emptyCloudStats() {
  return { notes: 0, publicNotes: 0, privateNotes: 0, views: 0, todayViews: null, likes: 0, favorites: 0, likedNotes: 0, savedNotes: 0 };
}

function profileUser(user) {
  if (!user) return null;
  const name = String(user.username || '').trim();
  const firstLetter = name.match(/[\u3400-\u9fffA-Za-z]/u);
  return {
    id: user.id, username: name, isDemo: user.isDemo === true, tags: Array.isArray(user.tags) ? user.tags : [], bio: user.bio || '',
    avatarUrl: user.avatarUrl || '', avatarText: user.avatarText || (firstLetter ? firstLetter[0] : Array.from(name)[0] || '草').toUpperCase(),
  };
}

function cardSummary(item) {
  const { body, chapters, archive, ...summary } = item;
  if (archive) summary.archive = { department: archive.department, category: archive.category, volume: archive.volume };
  if (chapters) summary.chapters = chapters.map((chapter) => ({ id: chapter.id, title: chapter.title }));
  return { ...summary, favorite: true };
}

Page({
  data: {
    activeSegment: 'favorites',
    user: null, avatarFailed: false, cloudStats: emptyCloudStats(), statsLoading: false, statsError: '', loggingOut: false,
    stats: { favorites: 0, notes: 0, learning: 0, completed: 0 },
    favoriteItems: [], favoriteCount: 0, favoriteHasMore: false, learningItems: [], completedItems: [],
    exporting: false, restoring: false, demoEntering: false, playSummary: null, localEdition: config.serviceMode === 'local',
  },

  onShow() {
    return this.refresh();
  },

  async refresh() {
    const user = community.getUser();
    const accountCloudEnabled = Boolean(user && (user.isDemo || !this.data.localEdition));
    const ownerId = user ? user.id : '';
    const changedAccount = this.ownerId !== ownerId;
    if (changedAccount) this.favoriteLimit = FAVORITE_PAGE_SIZE;
    this.ownerId = ownerId;
    const requestId = this.statsRequestId = (this.statsRequestId || 0) + 1;
    const state = store.getState();
    this.favoriteLimit = this.favoriteLimit || FAVORITE_PAGE_SIZE;
    this.favoriteEntries = state.favorites.map((key) => {
      const parts = key.split(':');
      return findItem(parts[0], parts[1]);
    }).filter(Boolean).reverse();
    const courses = catalog.filter((item) => item.kind === 'course').map((item) => ({
      ...cardSummary(item),
      progress: store.getProgress(item),
    }));
    const localStats = store.getStats();
    const cloudStats = changedAccount || !user ? emptyCloudStats() : this.data.cloudStats;
    const avatarChanged = (user ? user.avatarUrl || '' : '') !== (this.data.user ? this.data.user.avatarUrl || '' : '');
    this.setData({
      user: profileUser(user), avatarFailed: changedAccount || avatarChanged ? false : this.data.avatarFailed,
      cloudStats, statsLoading: accountCloudEnabled, statsError: '',
      stats: { ...localStats, notes: accountCloudEnabled ? cloudStats.notes : localStats.notes },
      favoriteItems: this.favoriteEntries.slice(0, this.favoriteLimit).map(cardSummary),
      favoriteCount: this.favoriteEntries.length,
      favoriteHasMore: this.favoriteEntries.length > this.favoriteLimit,
      learningItems: courses.filter((item) => item.progress.started && !item.progress.finished),
      completedItems: courses.filter((item) => item.progress.finished),
      playSummary: (({ quizBest, matchBest, observationCount, badgeCount, error }) => ({ quizBest, matchBest, observationCount, badgeCount, error }))(play.getSummary()),
    });
    if (!accountCloudEnabled) return;
    try {
      const result = await community.getStats();
      const currentUser = community.getUser();
      if (this.disposed || requestId !== this.statsRequestId) return;
      if (!currentUser || currentUser.id !== ownerId) {
        await this.refresh();
        return;
      }
      if (!result.ok) {
        this.setData({ statsError: result.error || '云端统计加载失败，请重试' });
        return;
      }
      const nextStats = { ...emptyCloudStats(), ...result.stats };
      this.setData({ cloudStats: nextStats, stats: { ...this.data.stats, notes: nextStats.notes } });
    } catch (error) {
      if (!this.disposed && requestId === this.statsRequestId) this.setData({ statsError: '网络暂时不可用，请重试' });
    } finally {
      if (!this.disposed && requestId === this.statsRequestId) this.setData({ statsLoading: false });
    }
  },

  onPullDownRefresh() {
    return this.refresh().finally(() => {
      if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh();
    });
  },

  onUnload() {
    this.disposed = true;
    this.statsRequestId = (this.statsRequestId || 0) + 1;
  },

  loadMoreFavorites() {
    if (!this.data.favoriteHasMore) return;
    this.favoriteLimit += FAVORITE_PAGE_SIZE;
    this.setData({
      favoriteItems: this.favoriteEntries.slice(0, this.favoriteLimit).map(cardSummary),
      favoriteHasMore: this.favoriteEntries.length > this.favoriteLimit,
    });
  },

  onReachBottom() {
    if (this.data.activeSegment === 'favorites') this.loadMoreFavorites();
  },

  selectSegment(event) {
    const activeSegment = event.currentTarget.dataset.segment;
    if (!['favorites', 'learning', 'completed'].includes(activeSegment)) return;
    this.setData({ activeSegment });
  },

  openNotes(event) {
    const requested = event && event.currentTarget && event.currentTarget.dataset.scope;
    const scope = ['my', 'public', 'favorites', 'liked', 'local', 'featured'].includes(requested) ? requested : 'my';
    if (['favorites', 'liked'].includes(scope) && !community.getUser()) {
      this.openAuth();
      return;
    }
    navigation.openNotes(scope);
  },

  openAuth(event) {
    const mode = event && event.currentTarget && event.currentTarget.dataset.mode;
    navigation.openAuth(mode === 'register' ? 'register' : 'login');
  },

  editProfile() {
    if (!community.getUser()) { this.openAuth(); return; }
    navigation.push('/pages/profile-edit/index');
  },

  async enterDemo() {
    if (this.data.demoEntering || this.data.loggingOut) return;
    this.setData({ demoEntering: true });
    try {
      const result = await community.enterDemo();
      if (this.disposed) return;
      if (!result.ok) { wx.showToast({ title: result.error || '暂时无法进入演示', icon: 'none' }); return; }
      wx.showToast({ title: '已进入官方演示', icon: 'success' });
      await this.refresh();
    } catch (error) {
      if (!this.disposed) wx.showToast({ title: '演示数据读取失败，请稍后重试', icon: 'none' });
    } finally { if (!this.disposed) this.setData({ demoEntering: false }); }
  },

  onAvatarError() {
    this.setData({ avatarFailed: true });
  },

  logout() {
    if (this.data.loggingOut) return;
    wx.showModal({
      title: this.data.user && this.data.user.isDemo ? '退出官方演示？' : '退出当前账号？',
      content: this.data.user && this.data.user.isDemo ? '演示笔记、资料和学习记录保留在当前设备，下次进入可以继续使用。' : '云端笔记已保存在账号中，本机收藏和学习记录保留在当前账号下。', confirmText: '退出', cancelText: '取消',
      success: async result => {
        if (!result.confirm || this.data.loggingOut) return;
        this.setData({ loggingOut: true });
        try {
          const response = await community.logout();
          if (response && !response.ok) {
            wx.showToast({ title: response.error || '退出失败，请重试', icon: 'none' }); return;
          }
          wx.showToast({ title: '已退出登录', icon: 'success' });
          await this.refresh();
        } catch (error) {
          wx.showToast({ title: '退出失败，请重试', icon: 'none' });
        } finally {
          if (!this.disposed) this.setData({ loggingOut: false });
        }
      },
    });
  },

  openLibrary(event) {
    const requested = event && event.currentTarget && event.currentTarget.dataset.kind;
    navigation.openLibrary(requested);
  },

  openCourse(event) {
    const item = findItem('course', event.currentTarget.dataset.id);
    if (item) navigation.openDetail('course', item.id, { resume: !store.getProgress(item).finished });
  },

  toggleFavorite(event) {
    const item = event.detail && event.detail.item;
    if (!item) return;
    const result = store.toggleFavorite(item);
    if (!result.ok) wx.showToast({ title: result.error || '收藏更新失败，请重试', icon: 'none' });
    this.refresh();
  },

  openAbout() {
    navigation.push('/pages/about/index');
  },
  openLegal(event) {
    const type = event && event.currentTarget && event.currentTarget.dataset.type;
    navigation.push('/pages/legal/index?type=' + (type === 'terms' ? 'terms' : 'privacy'));
  },
  openPlay() { navigation.push('/pages/play/index'); },

  exportBackup() {
    if (this.data.exporting || this.data.restoring) return;
    this.setData({ exporting: true });
    const result = backups.createBackup();
    if (!result.ok) {
      this.setData({ exporting: false });
      wx.showModal({ title: '未生成备份', content: result.error || '本机记录读取失败，请检查设备存储后重试', showCancel: false }); return;
    }
    const backup = JSON.stringify(result.backup, null, 2);
    if (typeof wx.getFileSystemManager !== 'function' || !wx.env || !wx.env.USER_DATA_PATH) {
      this.setData({ exporting: false });
      this.backupFallback(backup, '');
      return;
    }
    const date = new Date();
    const timestamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${date.getTime()}`;
    const fileName = `baicaoyuan-backup-${timestamp}.json`;
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: backup,
      encoding: 'utf8',
      success: () => {
        this.setData({ exporting: false });
        if (typeof wx.shareFileMessage === 'function') {
          wx.shareFileMessage({
            filePath,
            fileName,
            fail: (error) => {
              if (error && /cancel/i.test(error.errMsg || '')) return;
              this.backupFallback(backup, filePath);
            },
          });
        } else {
          this.backupFallback(backup, filePath);
        }
      },
      fail: () => {
        this.setData({ exporting: false });
        this.backupFallback(backup, '');
      },
    });
  },

  backupFallback(backup, filePath) {
    const demoMode = Boolean((community.getUser() || {}).isDemo);
    wx.showModal({
      title: filePath ? '备份文件已生成' : '复制备份内容',
      content: `${demoMode ? '备份包含当前设备的演示笔记、内容收藏、课程与游学记录。' : '备份包含当前账号在本机的内容收藏、课程、游学记录与本机笔记。云端笔记保存在账号中。'}可复制完整备份文本，保存为 JSON 文件。${filePath ? '\n\n本机文件：' + filePath : ''}`,
      confirmText: '复制备份',
      cancelText: '关闭',
      success: (result) => {
        if (!result.confirm) return;
        wx.setClipboardData({
          data: backup,
          success: () => wx.showToast({ title: '备份已复制', icon: 'none' }),
          fail: () => wx.showToast({ title: '复制失败，请重试导出', icon: 'none' }),
        });
      },
    });
  },

  restoreBackup() {
    if (this.data.exporting || this.data.restoring) return;
    if (typeof wx.showActionSheet !== 'function') { this.chooseBackupFile(); return; }
    wx.showActionSheet({ itemList: ['选择 JSON 备份文件', '从剪贴板恢复备份文本'], success: result => {
      if (result.tapIndex === 0) this.chooseBackupFile();
      else if (result.tapIndex === 1) this.restoreFromClipboard();
    } });
  },

  chooseBackupFile() {
    if (this.data.exporting || this.data.restoring) return;
    if (typeof wx.chooseMessageFile !== 'function' || typeof wx.getFileSystemManager !== 'function') {
      wx.showModal({ title: '当前环境不支持文件选择', content: '可在微信中选择聊天中的 JSON 备份，或复制完整备份后使用“从剪贴板恢复”。', showCancel: false }); return;
    }
    const owner = (community.getUser() || {}).id || 'guest';
    this.setData({ restoring: true });
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'], success: result => {
      const file = result.tempFiles && result.tempFiles[0];
      if (!file || !file.path || (file.size && file.size > 1024 * 1024)) {
        this.restoreFailed('请选择不超过 1 MB 的 JSON 备份文件'); return;
      }
      try {
        wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8', success: result => this.confirmRestore(result.data, owner),
          fail: () => this.restoreFailed('备份文件读取失败，请重新选择文件') });
      } catch (error) { this.restoreFailed('备份文件读取失败，请重新选择文件'); }
    }, fail: error => {
      if (error && /cancel/i.test(error.errMsg || '')) { this.setData({ restoring: false }); return; }
      this.restoreFailed('文件选择暂时不可用，可复制备份文本后从剪贴板恢复');
    } });
  },

  restoreFromClipboard() {
    if (this.data.exporting || this.data.restoring) return;
    if (typeof wx.getClipboardData !== 'function') { this.restoreFailed('当前环境不支持读取剪贴板，请选择 JSON 文件'); return; }
    const owner = (community.getUser() || {}).id || 'guest';
    this.setData({ restoring: true });
    wx.getClipboardData({ success: result => this.confirmRestore(result.data, owner), fail: () => this.restoreFailed('剪贴板读取失败，请重试或选择 JSON 文件') });
  },

  confirmRestore(input, owner) {
    if (this.disposed) return;
    const user = community.getUser();
    if (owner !== ((user || {}).id || 'guest')) { this.restoreFailed('账号已变化，请在当前账号下重新选择备份'); return; }
    if (typeof input !== 'string' || !input.trim()) { this.restoreFailed('备份内容为空，请复制完整的 JSON 备份'); return; }
    wx.showModal({ title: '恢复到本机记录？', content: `目标：${user ? (user.isDemo ? '本机体验账号' : user.username + '的本机记录') : '游客本机记录'}。恢复将合并收藏、课程、笔记和游学记录；重复内容会去重，同名冲突笔记保留两份。云端笔记不受影响，恢复内容不会自动公开。`, confirmText: '恢复备份', cancelText: '取消',
      success: result => {
        if (!result.confirm) { this.setData({ restoring: false }); return; }
        if (owner !== ((community.getUser() || {}).id || 'guest')) { this.restoreFailed('账号已变化，请重新选择备份'); return; }
        let restored;
        try { restored = backups.importBackup(input); }
        catch (error) { restored = { ok: false, error: '备份恢复失败，请检查设备存储后重试' }; }
        this.setData({ restoring: false });
        wx.showModal({ title: restored.ok ? '备份已恢复' : '备份恢复未完成', content: restored.ok ? restored.message : restored.error, showCancel: false });
        if (restored.ok || restored.partial) this.refresh();
      }, fail: () => this.restoreFailed('恢复确认暂时无法打开，请重试') });
  },

  restoreFailed(error) {
    if (this.disposed) return;
    this.setData({ restoring: false });
    wx.showModal({ title: '未恢复备份', content: error, showCancel: false });
  },
});
