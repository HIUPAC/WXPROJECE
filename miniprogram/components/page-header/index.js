const motion = require('../../services/motion');

Component({
  properties: { title: { type: String, value: '百草源' }, subtitle: { type: String, value: '' }, back: { type: Boolean, value: false }, preventBack: { type: Boolean, value: false } },
  data: { statusHeight: 24, navigationHeight: 44, rightSpace: 104 },
  pageLifetimes: {
    show() {
      const pages = getCurrentPages();
      this._motionPage = pages[pages.length - 1];
      motion.enter(this._motionPage);
    },
    hide() { motion.stop(this._motionPage); },
  },
  lifetimes: {
    attached() {
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const capsule = wx.getMenuButtonBoundingClientRect();
        const statusHeight = info.statusBarHeight || 24;
        this.setData({ statusHeight, navigationHeight: capsule.height && capsule.top >= statusHeight ? (capsule.top - statusHeight) * 2 + capsule.height : 44, rightSpace: capsule.left ? info.windowWidth - capsule.left + 12 : 104 });
      } catch (error) { /* Older simulators can use the safe defaults. */ }
    },
    detached() { motion.stop(this._motionPage); this._motionPage = null; },
  },
  methods: {
    onBack() {
      this.triggerEvent('back');
      if (!this.properties.preventBack && !this._goingBack) {
        this._goingBack = true;
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }), complete: () => { this._goingBack = false; } });
      }
    },
  },
});
