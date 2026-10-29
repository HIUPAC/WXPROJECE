const { catalog, findItem, kindLabels, itemPath, getItem, getVolume } = require('../../data/catalog');
const store = require('../../services/store');
const community = require('../../services/community');
const navigation = require('../../services/navigation');
const reading = require('../../services/reading');
const config = require('../../config');

function paragraphs(body) {
  return typeof body === 'string' ? body.split(/\n+/).map((line) => line.trim()).filter(Boolean) : [];
}

Page({
  data: {
    item: null,
    kindLabel: '',
    imageSrc: '',
    imageFailed: false,
    bodyParagraphs: [],
    favorite: false,
    chapters: [],
    progress: { completed: [], count: 0, total: 0, percent: 0, started: false, finished: false },
    activeChapterId: '',
    activeChapter: null,
    activeChapterNumber: 0,
    activeParagraphs: [],
    activeCompleted: false,
    learningButton: '开始免费学习',
    completionButton: '完成这一节',
    nextButton: '继续下一节',
    relatedKey: '', archiveLoading: false, archiveError: '', sectionTitles: [], sectionIndex: 0,
    sectionTitle: '', sectionParagraphs: [], archiveWholeVolume: false, aliasLabel: '',
    publicRelatedCount: 0, myRelatedCount: 0, notesCountLoading: false,
    publicNotesError: false, myNotesError: false, relatedItems: [],
    localEdition: config.serviceMode === 'local',
  },

  onLoad(options) {
    const kind = options && typeof options.kind === 'string' ? options.kind : '';
    const id = options && typeof options.id === 'string' ? options.id : '';
    const item = findItem(kind, id);
    if (!item) return;
    this.setData({
      item,
      kindLabel: kindLabels[item.kind] || '',
      imageSrc: item.image || '',
      imageFailed: !item.image,
      bodyParagraphs: paragraphs(item.body),
      relatedKey: item.kind + ':' + item.id,
      relatedItems: (item.relatedKeys ? item.relatedKeys.map(key => { const parts = key.split(':'); return findItem(parts[0], parts[1]); }) :
        catalog.filter(entry => entry.kind === 'note' && (entry.relatedKeys || []).includes(item.kind + ':' + item.id)))
        .filter(Boolean).slice(0, 4).map(entry => ({ id: entry.id, kind: entry.kind, title: entry.title, category: entry.category }))
    });
    this.refreshState(true);
    if (item.kind === 'course' && options && options.resume === '1') this.startLearning();
    if (item.archive) this.loadArchive(false);
    else if (item.kind !== 'course' && this.data.bodyParagraphs.length) this.rememberReading();
  },
  onHide() { this.hidden = true; this.notesToken = (this.notesToken || 0) + 1; },
  onUnload() {
    this.hidden = true;
    this.loadToken = (this.loadToken || 0) + 1;
    this.notesToken = (this.notesToken || 0) + 1;
  },
  loadArchive(wholeVolume) {
    const item = this.data.item;
    if (!item || !item.archive) return;
    const token = this.loadToken = (this.loadToken || 0) + 1;
    const readingScope = (community.getUser() || {}).id || 'guest';
    this.setData({ archiveLoading: true, archiveError: '', archiveWholeVolume: wholeVolume });
    const pending = wholeVolume ? getVolume(item.archive.part) : getItem(item.kind, item.id).then(detail => detail.archive.sections);
    pending.then(sections => {
      if (token !== this.loadToken) return;
      this.archiveSections = sections;
      this.setData({ archiveLoading: false, sectionTitles: sections.map((section, i) => (i + 1) + '. ' + section.title), aliasLabel: item.archive.aliases.join(' · ') });
      this.showSection(0, false, readingScope);
      if (wholeVolume) this.scrollToReader('#archive-reader');
    }).catch(() => {
      if (token === this.loadToken) this.setData({ archiveLoading: false, archiveError: '原文资料暂未加载，请重试或返回档案目录。' });
    });
  },
  retryArchive() { this.loadArchive(this.data.archiveWholeVolume); },
  readVolume() { this.loadArchive(true); },
  readEntry() { this.loadArchive(false); },
  chooseSection(event) { this.showSection(Number(event.detail.value), true); },
  previousSection() { this.showSection(this.data.sectionIndex - 1, true); },
  nextSection() { this.showSection(this.data.sectionIndex + 1, true); },
  showSection(index, scroll, readingScope) {
    const section = this.archiveSections && this.archiveSections[index];
    if (!section) return;
    this.setData({ sectionIndex: index, sectionTitle: section.title, sectionParagraphs: paragraphs(section.body) });
    if (this.data.sectionParagraphs.length) this.rememberReading(readingScope);
    if (scroll) this.scrollToReader('#archive-reader');
  },
  copyArchiveSource() {
    if (this.data.item && this.data.item.archive) wx.setClipboardData({ data: this.data.item.archive.sourceUrl });
  },

  onShow() {
    this.hidden = false;
    this.refreshState(true);
    const item = this.data.item;
    if (item && item.kind !== 'course' && (item.archive ?
      !this.data.archiveLoading && !this.data.archiveError && this.data.sectionParagraphs.length : this.data.bodyParagraphs.length)) {
      this.rememberReading();
    }
  },

  refreshState(includeRelated = false) {
    const item = this.data.item;
    if (!item) return;
    const changes = { favorite: store.isFavorite(item) };
    if (item.kind === 'course') {
      const progress = store.getProgress(item);
      changes.progress = progress;
      changes.chapters = (item.chapters || []).map((chapter, index) => Object.assign({}, chapter, {
        number: index + 1,
        numberLabel: String(index + 1).padStart(2, '0'),
        completed: progress.completed.indexOf(chapter.id) !== -1
      }));
      changes.learningButton = progress.finished ? '重新阅读课程' : progress.started ? '继续免费学习' : '开始免费学习';
    }
    this.setData(changes);
    if (this.data.activeChapterId) this.updateActiveChapter(this.data.activeChapterId);
    if (includeRelated) this.refreshRelatedNotes();
  },

  refreshRelatedNotes() {
    const relatedKey = this.data.relatedKey;
    if (!relatedKey) return;
    const token = this.notesToken = (this.notesToken || 0) + 1;
    const user = community.getUser();
    const userId = user ? user.id : '';
    if (this.data.localEdition && !(user && user.isDemo)) {
      const localCount = store.getState().notes.filter(note => note.relatedKey === relatedKey).length;
      this.setData({ demoMode: false, myRelatedCount: localCount, publicRelatedCount: 0, notesCountLoading: false, publicNotesError: false, myNotesError: false });
      return Promise.resolve();
    }
    const localCount = user ? 0 : store.getState().notes.filter(note => note.relatedKey === relatedKey).length;
    this.setData({ demoMode: Boolean(user && user.isDemo), myRelatedCount: localCount, publicRelatedCount: 0, notesCountLoading: true, publicNotesError: false, myNotesError: false });
    const isCurrent = () => {
      if (token !== this.notesToken || relatedKey !== this.data.relatedKey) return false;
      const current = community.getUser();
      if ((current ? current.id : '') !== userId) {
        this.refreshState(true);
        return false;
      }
      return true;
    };
    const publicNotes = community.listNotes({ scope: 'public', relatedKey, offset: 0, limit: 1 });
    const myNotes = user ? community.listNotes({ scope: 'my', relatedKey, offset: 0, limit: 1 }) : Promise.resolve({ ok: true, total: 0 });
    return Promise.all([publicNotes, myNotes]).then(results => {
      if (!isCurrent()) return;
      const publicResult = results[0];
      const myResult = results[1];
      this.setData({
        publicRelatedCount: publicResult.ok ? publicResult.total : 0,
        myRelatedCount: localCount + (myResult.ok ? myResult.total : 0),
        notesCountLoading: false, publicNotesError: !publicResult.ok, myNotesError: !myResult.ok
      });
    }).catch(() => {
      if (isCurrent()) this.setData({ notesCountLoading: false, publicNotesError: true, myNotesError: Boolean(user) });
    });
  },

  openPublicNotes() { navigation.openNotes(this.data.localEdition && !this.data.demoMode ? 'featured' : 'public', this.data.relatedKey); },
  openMyNotes() { navigation.openNotes('my', this.data.relatedKey); },

  imageError() {
    this.setData({ imageFailed: true });
  },
  rememberReading(expectedScope) {
    if (this.hidden) return;
    const user = community.getUser();
    const ownerId = user ? user.id : 'guest';
    if (expectedScope && expectedScope !== ownerId) return;
    if (this.readingRememberedFor === ownerId || !this.data.item) return;
    try {
      const result = reading.remember(this.data.item, ownerId);
      if (result && result.ok) this.readingRememberedFor = ownerId;
    } catch (_) {
      // Reading remains available when local history cannot be saved.
    }
  },

  toggleFavorite() {
    if (!this.data.item) return;
    const result = store.toggleFavorite(this.data.item);
    if (!result.ok) {
      wx.showToast({ title: result.error || '保存失败，请重试', icon: 'none' });
      return;
    }
    this.refreshState();
    wx.showToast({ title: result.favorite ? '已加入收藏' : '已取消收藏', icon: 'none' });
  },

  startLearning() {
    const chapters = this.data.chapters;
    if (!chapters.length) return;
    const next = chapters.find((chapter) => !chapter.completed) || chapters[0];
    this.updateActiveChapter(next.id);
    this.scrollToReader();
  },

  chooseChapter(event) {
    this.updateActiveChapter(event.currentTarget.dataset.id);
    this.scrollToReader();
  },

  updateActiveChapter(id) {
    const chapter = this.data.chapters.find((entry) => entry.id === id);
    if (!chapter) return;
    const progress = this.data.progress;
    const isLastIncomplete = !chapter.completed && progress.count === progress.total - 1;
    const structured = new Set([
      chapter.goal ? '本节目标：' + chapter.goal : '',
      chapter.practice ? '动手练习：' + chapter.practice : '',
      chapter.checklist && chapter.checklist.length ? '完成自检：' + chapter.checklist.join('；') + '。' : ''
    ].filter(Boolean));
    this.setData({
      activeChapterId: chapter.id,
      activeChapter: chapter,
      activeChapterNumber: chapter.number,
      activeParagraphs: paragraphs(chapter.body).filter(line => !structured.has(line)),
      activeCompleted: chapter.completed,
      completionButton: isLastIncomplete ? '完成本课' : '完成这一节',
      nextButton: progress.finished ? (chapter.number === progress.total ? '重新阅读第一节' : '阅读下一节') : '继续未完成章节'
    });
    if (this.data.activeParagraphs.length) this.rememberReading();
  },

  completeActiveChapter() {
    const item = this.data.item;
    const chapter = this.data.activeChapter;
    if (!item || !chapter || chapter.completed) return;
    const result = store.completeChapter(item.id, chapter.id);
    if (!result.ok) {
      wx.showToast({ title: result.error || '进度保存失败，请重试', icon: 'none' });
      return;
    }
    this.refreshState();
    const next = this.data.chapters.find((entry) => !entry.completed);
    if (next) {
      this.updateActiveChapter(next.id);
      this.scrollToReader();
    }
    wx.showToast({ title: this.data.progress.finished ? '课程已完成' : '已完成这一节', icon: 'success' });
  },

  nextChapter() {
    const chapters = this.data.chapters;
    if (!chapters.length) return;
    const next = chapters.find((chapter) => !chapter.completed) || chapters[this.data.activeChapterNumber % chapters.length];
    this.updateActiveChapter(next.id);
    this.scrollToReader();
  },

  scrollToReader(selector = '#chapter-reader') {
    wx.nextTick(() => {
      if (!wx.createSelectorQuery) {
        wx.pageScrollTo({ selector, duration: 220 });
        return;
      }
      wx.createSelectorQuery()
        .select('page-header').boundingClientRect()
        .select(selector).boundingClientRect()
        .selectViewport().scrollOffset()
        .exec((rects) => {
          const header = rects[0];
          const reader = rects[1];
          const viewport = rects[2];
          if (!reader || !viewport) return;
          wx.pageScrollTo({
            scrollTop: Math.max(0, viewport.scrollTop + reader.top - (header ? header.height : 68) - 16),
            duration: 220
          });
        });
    });
  },

  writeNote() {
    if (!this.data.item) return;
    navigation.editNote('', this.data.relatedKey);
  },
  practiceNote() {
    const item = this.data.item, chapter = this.data.activeChapter;
    if (!item || !chapter) return;
    navigation.editNote('', this.data.relatedKey, { ownerId: (community.getUser() || {}).id || 'guest',
      title: chapter.title + ' · 练习记录', body: '练习任务：' + chapter.practice + '\n\n日期与对象：\n实际发现或作品过程：\n待确认问题：\n自查与下一步：' });
  },
  useTemplate() {
    const item = this.data.item;
    if (!item || !item.noteTemplate) return;
    navigation.editNote('', this.data.relatedKey, { ownerId: (community.getUser() || {}).id || 'guest',
      title: item.title + ' · 我的记录', body: item.noteTemplate });
  },
  openQuiz() {
    const item = this.data.item;
    if (item && item.kind === 'course') navigation.push('/pages/play/index?mode=quiz&topic=' + encodeURIComponent(item.topic || 'all'));
  },
  openRelatedItem(event) {
    const { kind, id } = event.currentTarget.dataset;
    if (findItem(kind, id)) navigation.openDetail(kind, id);
  },
  copyReference(event) {
    const references = (this.data.item || {}).references || [];
    const source = references[Number(event.currentTarget.dataset.index)];
    if (source && /^https:\/\//.test(source.url)) wx.setClipboardData({ data: source.url });
  },

  backToLibrary() {
    navigation.openLibrary(this.data.item ? this.data.item.kind : 'all');
  },

  onShareAppMessage() {
    const item = this.data.item;
    return item
      ? { title: '百草源 · ' + item.title, path: itemPath(item), imageUrl: item.image }
      : { title: '百草源 · 探索本草', path: '/pages/library/index' };
  },

  onShareTimeline() {
    const item = this.data.item;
    return item
      ? { title: '百草源 · ' + item.title, query: 'kind=' + encodeURIComponent(item.kind) + '&id=' + encodeURIComponent(item.id), imageUrl: item.image }
      : { title: '百草源 · 探索本草' };
  }
});
