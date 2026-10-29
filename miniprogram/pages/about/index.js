const { catalog, archiveStats } = require('../../data/catalog');
const navigation = require('../../services/navigation');
const config = require('../../config');
Page({
  data: { credits: require('../../data/assets'), archive: archiveStats, localEdition: config.serviceMode === 'local',
    courseCount: catalog.filter(item => item.kind === 'course').length,
    chapterCount: catalog.filter(item => item.kind === 'course').reduce((count, item) => count + item.chapters.length, 0),
    officialNoteCount: catalog.filter(item => item.kind === 'note').length,
    routeCount: catalog.filter(item => item.kind === 'route').length,
    publisherName: config.publisherName || '', contactEmail: config.contactEmail || '', contactDescription: config.contactDescription || '' },
  copyArchiveSource() { wx.setClipboardData({ data: this.data.archive.sourceUrl }); },
  copyArchiveLicense() { wx.setClipboardData({ data: this.data.archive.licenseUrl }); },
  copySource(event) {
    const item = this.data.credits[event.currentTarget.dataset.index];
    if (item) wx.setClipboardData({ data: event.currentTarget.dataset.type === 'license' ? item.licenseUrl : item.source });
  },
  openLibrary(event) { navigation.openLibrary(event.currentTarget.dataset.kind); },
  openPlay() { navigation.push('/pages/play/index'); },
  openNotes() { navigation.openNotes('my'); },
  openLegal(event) { navigation.push('/pages/legal/index?type=' + (event.currentTarget.dataset.type === 'terms' ? 'terms' : 'privacy')); },
  copyContact() { if (this.data.contactEmail) wx.setClipboardData({ data: this.data.contactEmail }); },
  openPrivacyContract() {
    if (typeof wx.openPrivacyContract !== 'function') { wx.showToast({ title: '请在新版微信中查看平台隐私保护指引', icon: 'none' }); return; }
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '平台隐私指引暂时无法打开，请稍后重试', icon: 'none' }) });
  },
});
