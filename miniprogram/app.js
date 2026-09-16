const config = require("./config");

App({
  globalData: {
    baseUrl: config.baseUrl,
    user: null,
    family: null
  },
  onLaunch() {
    const token = wx.getStorageSync("familyEduToken");
    if (!token) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }
    const family = wx.getStorageSync("familyEduFamily");
    if (!family || !family.id) {
      // Authenticated WeChat account that has not chosen a family yet.
      wx.reLaunch({ url: "/pages/onboarding/onboarding" });
      return;
    }
    wx.switchTab({ url: "/pages/home/home" });
    try {
      this.globalData.user = wx.getStorageSync("familyEduUser") || null;
      this.globalData.family = wx.getStorageSync("familyEduFamily") || null;
    } catch (_error) {
      // ignore storage read errors
    }
  }
});
