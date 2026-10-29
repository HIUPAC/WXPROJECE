const { catalog, findItem } = require('../../data/catalog');
const store = require('../../services/store');
const navigation = require('../../services/navigation');
const play = require('../../services/play');
const reading = require('../../services/reading');
const config = require('../../config');
function cardSummary(item) {
  return { id: item.id, kind: item.kind, title: item.title, subtitle: item.subtitle, category: item.category,
    minutes: item.minutes, image: item.image, description: item.description,
    chapters: (item.chapters || []).map(chapter => ({ id: chapter.id, title: chapter.title })) };
}
Page({
  data: {
    hero: findItem('herb', 'h1'), heroFailed: false, courses: [], editorial: catalog.filter(item => item.kind === 'note').slice(0, 4).map(cardSummary),
    editorialTotal: catalog.filter(item => item.kind === 'note').length, playSummary: null,
    activities: [{ mode: 'quiz', title: '知识闯关', icon: 'book', description: '五题一轮 · 答后看解析' },
      { mode: 'match', title: '术语翻牌', icon: 'leaf', description: '六组配对 · 记住草木词汇' },
      { mode: 'observe', title: '七日观察', icon: 'pen', description: '每天一记 · 完成真实任务' },
      { mode: 'daily', title: '每日灵感卡', icon: 'compass', description: '今日提示 · 开启一次创作' }],
    stats: { favorites: 0, notes: 0, learning: 0, completed: 0 }, searchQuery: '', recent: [], resume: null, offline: false, localEdition: config.serviceMode === 'local',
    entries: [
      { kind: 'herb', title: '本草档案', description: '名称与原文', icon: 'leaf', number: '01' },
      { kind: 'course', title: '免费课程', description: '学习与练习', icon: 'book', number: '02' },
      { kind: 'my', title: '我的笔记', description: '记录与整理', icon: 'pen', number: '03' },
      { kind: 'route', title: '观察路线', description: '身边的草木', icon: 'compass', number: '04' },
    ],
  },
  onShow() { this.refresh(); },
  refresh() {
    const courses = catalog.filter(item => item.kind === 'course').map(item => Object.assign({}, cardSummary(item), {
      favorite: store.isFavorite(item), progress: store.getProgress(item)
    }));
    const recent = reading.getRecent();
    const inProgress = courses.find(item => item.progress.started && !item.progress.finished);
    const latest = recent.find(item => item.kind === 'course' && courses.some(course => course.id === item.id && course.progress.started && !course.progress.finished));
    const resumeCourse = latest ? courses.find(course => course.id === latest.id) : inProgress;
    const resume = resumeCourse ? { kind: resumeCourse.kind, id: resumeCourse.id, title: resumeCourse.title,
      label: '继续学习', caption: '已完成 ' + resumeCourse.progress.count + ' / ' + resumeCourse.progress.total + ' 节' } :
      recent.length ? { ...recent[0], label: '继续阅读', caption: recent[0].category } : null;
    this.setData({
      courses, recent, resume, offline: Boolean(getApp().globalData && getApp().globalData.networkConnected === false),
      stats: store.getStats(),
      playSummary: (({ quizBest, observationCount, badgeCount, error }) => ({ quizBest, observationCount, badgeCount, error }))(play.getSummary())
    });
  },
  explore(event) {
    const kind = event.currentTarget.dataset.kind || 'all';
    if (kind === 'my') { navigation.openNotes('my'); return; }
    navigation.openLibrary(kind);
  },
  onSearchInput(event) { this.setData({ searchQuery: event.detail.value }); },
  search() { navigation.openLibrary('all', this.data.searchQuery.trim()); },
  continueReading(event) {
    const item = event && event.currentTarget && event.currentTarget.dataset.kind ? event.currentTarget.dataset : this.data.resume;
    if (item) navigation.openDetail(item.kind, item.id, { resume: item.kind === 'course' });
  },
  clearHistory() {
    const scope = reading.getScope();
    wx.showModal({ title: '清除最近阅读？', content: '只清除当前身份的阅读历史，收藏与课程进度会保留。', success: result => {
      if (!result.confirm) return;
      const saved = reading.clear(scope);
      if (saved.ok) this.refresh();
      else wx.showToast({ title: saved.error, icon: 'none' });
    } });
  },
  openItem(event) {
    const item = catalog.find(entry => entry.id === event.currentTarget.dataset.id);
    if (item) navigation.openDetail(item.kind, item.id);
  },
  onFavorite(event) {
    const result = store.toggleFavorite(event.detail.item);
    wx.showToast({ title: result.ok ? result.favorite ? '已加入收藏' : '已取消收藏' : result.error, icon: 'none' });
    this.refresh();
  },
  writeNote() { navigation.editNote(); },
  openPublicNotes() { navigation.openNotes(this.data.localEdition ? 'featured' : 'public'); },
  openOfficialNotes() { navigation.openNotes('featured'); },
  openPlay(event) {
    const mode = event.currentTarget.dataset.mode;
    navigation.push('/pages/play/index' + (['quiz', 'match', 'observe', 'daily'].includes(mode) ? '?mode=' + mode : ''));
  },
  openMyNotes() { navigation.openNotes('my'); },
  heroError() { this.setData({ heroFailed: true }); },
  onShareAppMessage() { return { title: '百草源｜探索本草，记录身边的自然', path: '/pages/index/index' }; },
  onShareTimeline() { return { title: '百草源 · 探索本草，记录自然' }; },
});
