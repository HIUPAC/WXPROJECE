const community = require('./services/community');

App({
  globalData: { notesScope: 'my', cloudReady: false, networkConnected: null },
  onLaunch() {
    this.globalData.cloudReady = community.initializeCloud().ok;
    if (typeof wx.getNetworkType === 'function') wx.getNetworkType({ success: result => {
      this.globalData.networkConnected = result.networkType !== 'none';
    } });
    if (typeof wx.onNetworkStatusChange === 'function') wx.onNetworkStatusChange(result => {
      this.globalData.networkConnected = result.isConnected;
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const page = pages[pages.length - 1];
      if (page && page.route === 'pages/index/index') page.setData({ offline: !result.isConnected });
    });
  }
});
