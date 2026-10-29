const { kindLabels } = require('../../data/catalog');
const navigation = require('../../services/navigation');
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { item: { type: Object, value: null }, favorite: { type: Boolean, value: false } },
  data: { failed: false, kindLabel: '' },
  observers: { item(item) { this.setData({ failed: !item || !item.image, kindLabel: item ? kindLabels[item.kind] || '本草阅读' : '' }); } },
  methods: {
    open() { const item = this.properties.item; if (item) navigation.openDetail(item.kind, item.id, { resume: Boolean(item.progress && item.progress.started && !item.progress.finished) }); },
    favorite() { this.triggerEvent('favorite', { item: this.properties.item }); },
    onImageError() { this.setData({ failed: true }); },
  },
});
