const { catalog, kindLabels, queryCatalog, getArchiveFilters, archiveStats, findItem } = require('../../data/catalog');
const store = require('../../services/store');
const navigation = require('../../services/navigation');

const filters = [
  { kind: 'all', label: '全部' },
  { kind: 'herb', label: '本草档案' },
  { kind: 'course', label: '免费课程' },
  { kind: 'note', label: '精选笔记' },
  { kind: 'route', label: '寻药文化' }
];

Page({
  data: {
    filters,
    kind: 'all',
    query: '',
    items: [],
    resultCount: catalog.length,
    resultLabel: '全部内容',
    hasFilter: false, hasArchiveFilter: false,
    archiveStats, departments: [], categories: [], departmentIndex: 0, categoryIndex: 0,
    department: 'all', category: 'all', botanicalOnly: false, hasMore: false
  },

  onLoad(options) {
    const kind = options && options.kind;
    const query = options && typeof options.query === 'string' ? options.query.slice(0, 100) : '';
    this.setData({ kind: this.validKind(kind), query });
    this.refreshResults();
  },

  onShow() {
    const app = getApp();
    const pending = app.globalData || {};
    const changes = {};
    if (typeof pending.libraryFilter === 'string') {
      changes.kind = this.validKind(pending.libraryFilter);
      delete pending.libraryFilter;
    }
    if (typeof pending.libraryQuery === 'string') {
      changes.query = pending.libraryQuery.slice(0, 100);
      delete pending.libraryQuery;
    }
    const reset = pending.libraryResetFilters === true;
    delete pending.libraryResetFilters;
    if (reset) Object.assign(changes, { department: 'all', category: 'all', botanicalOnly: false });
    const changed = Object.keys(changes).some(key => changes[key] !== this.data[key]);
    this.setData(changes);
    if (changed || reset || this.searchPending) this.refreshResults();
    else this.refreshFavorites();
  },

  validKind(kind) {
    return filters.some((filter) => filter.kind === kind) ? kind : 'all';
  },

  refreshResults() {
    clearTimeout(this.searchTimer);
    this.searchPending = false;
    this.updateFilters();
    this.loaded = 0;
    const result = this.fetchBatch();
    this.setData({
      items: result.items, hasMore: result.hasMore,
      resultCount: result.total,
      resultLabel: this.data.kind === 'all' ? '全部内容' : kindLabels[this.data.kind],
      hasFilter: this.data.kind !== 'all' || Boolean(this.data.query.trim()) ||
        (this.data.kind === 'herb' && (this.data.department !== 'all' || this.data.category !== 'all' || this.data.botanicalOnly)),
      hasArchiveFilter: this.data.kind === 'herb' &&
        (this.data.department !== 'all' || this.data.category !== 'all' || this.data.botanicalOnly)
    });
  },

  updateFilters() {
    const info = getArchiveFilters(this.data.department, this.data.botanicalOnly);
    const departmentIndex = Math.max(0, info.departments.findIndex(entry => entry.value === this.data.department));
    const categoryIndex = Math.max(0, info.categories.findIndex(entry => entry.value === this.data.category));
    this.setData({ ...info, departmentIndex, categoryIndex,
      department: info.departments[departmentIndex].value, category: info.categories[categoryIndex].value });
  },
  fetchBatch() {
    const { kind, query, department, category, botanicalOnly } = this.data;
    const result = queryCatalog({ kind, query, department: kind === 'herb' ? department : 'all',
      category: kind === 'herb' ? category : 'all', botanicalOnly: kind === 'herb' && botanicalOnly,
      offset: this.loaded || 0, limit: 20 });
    const favorites = new Set(store.getState().favorites);
    result.items = result.items.map(item => ({ ...item, favorite: favorites.has(item.kind + ':' + item.id),
      progress: item.kind === 'course' ? store.getProgress(item) : null,
      aliasLabel: item.archive ? item.archive.aliases.slice(0, 4).join(' · ') : '' }));
    this.loaded = (this.loaded || 0) + result.items.length;
    return result;
  },
  refreshFavorites() {
    const favorites = new Set(store.getState().favorites);
    const changes = {};
    this.data.items.forEach((item, i) => {
      const favorite = favorites.has(item.kind + ':' + item.id);
      if (favorite !== item.favorite) changes['items[' + i + '].favorite'] = favorite;
      if (item.kind === 'course') {
        const progress = store.getProgress(item);
        if (!item.progress || progress.count !== item.progress.count) changes['items[' + i + '].progress'] = progress;
      }
    });
    if (Object.keys(changes).length) this.setData(changes);
  },
  loadMore() {
    if (!this.data.hasMore || this.searchPending) return;
    const result = this.fetchBatch();
    const changes = { hasMore: result.hasMore };
    const start = this.data.items.length;
    result.items.forEach((item, i) => { changes['items[' + (start + i) + ']'] = item; });
    this.setData(changes);
  },
  onReachBottom() { this.loadMore(); },
  chooseDepartment(event) {
    const selected = this.data.departments[Number(event.detail.value)];
    if (!selected) return;
    this.setData({ department: selected.value, category: 'all' });
    this.refreshResults();
  },
  chooseCategory(event) {
    const selected = this.data.categories[Number(event.detail.value)];
    if (!selected) return;
    this.setData({ category: selected.value }); this.refreshResults();
  },
  toggleBotanical() {
    this.setData({ botanicalOnly: !this.data.botanicalOnly, department: 'all', category: 'all' });
    this.refreshResults();
  },
  clearArchiveFilters() {
    this.setData({ department: 'all', category: 'all', botanicalOnly: false });
    this.refreshResults();
  },
  openHerb(event) {
    const item = findItem('herb', event.currentTarget.dataset.id);
    if (item) navigation.openDetail(item.kind, item.id);
  },
  favoriteHerb(event) {
    this.toggleFavorite({ detail: { item: findItem('herb', event.currentTarget.dataset.id) } });
  },

  chooseFilter(event) {
    this.setData({ kind: this.validKind(event.currentTarget.dataset.kind) });
    clearTimeout(this.searchTimer);
    this.refreshResults();
  },
  openPublicNotes() { navigation.openNotes('public'); },
  openPlay() { navigation.push('/pages/play/index'); },

  searchInput(event) {
    const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({ query: value.slice(0, 100) });
    this.searchPending = true;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.refreshResults(), 180);
  },

  clearSearch() {
    clearTimeout(this.searchTimer);
    this.setData({ query: '' });
    this.refreshResults();
  },

  resetFilters() {
    clearTimeout(this.searchTimer);
    this.setData({ kind: 'all', query: '', department: 'all', category: 'all', botanicalOnly: false });
    this.refreshResults();
  },

  toggleFavorite(event) {
    const item = event.detail && event.detail.item;
    if (!item) return;
    const result = store.toggleFavorite(item);
    if (!result.ok) {
      wx.showToast({ title: result.error || '保存失败，请重试', icon: 'none' });
      return;
    }
    this.refreshFavorites();
    wx.showToast({ title: result.favorite ? '已加入收藏' : '已取消收藏', icon: 'none' });
  },
  onUnload() { clearTimeout(this.searchTimer); },

  onShareAppMessage() {
    return { title: '百草源 · 从一片叶子开始，认识本草', path: '/pages/library/index' };
  },

  onShareTimeline() {
    return { title: '百草源 · 探索本草' };
  }
});
