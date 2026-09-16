const api = require("../../utils/api");

Page({
  data: {
    emailLoginStep: false,
    email: "",
    password: "",
    emailLoading: false,
    error: "",
    errorDetail: "",
    serviceState: "ok",
    serviceMessage: "",
    wechatLoading: false
  },

  onLoad() {
    if (wx.getStorageSync("familyEduToken")) {
      const family = wx.getStorageSync("familyEduFamily");
      if (family && family.id) wx.switchTab({ url: "/pages/home/home" });
      else wx.redirectTo({ url: "/pages/onboarding/onboarding" });
      return;
    }
    this.checkService();
  },

  async checkService() {
    try {
      await api.health();
      this.setData({ serviceState: "ok", serviceMessage: "" });
    } catch (error) {
      this.setData({
        serviceState: "unstable",
        serviceMessage: "当前网络没有连上服务，请稍后重试"
      });
    }
  },

  retryService() {
    this.checkService();
  },

  wechatLogin() {
    if (this.data.wechatLoading) return;
    this.setData({
      wechatLoading: true,
      error: "",
      errorDetail: "",
    });
    wx.login({
      success: async (res) => {
        if (!res.code) {
          this.setData({
            wechatLoading: false,
            serviceState: "unstable",
            serviceMessage: "当前微信运行环境没有返回登录凭证，请重新打开小程序后再试",
            error: "微信登录没有成功",
            errorDetail: "没有获取到微信登录凭证"
          });
          return;
        }
        try {
          const data = await api.wechatLogin({ code: res.code });
          this.setData({ serviceState: "ok", serviceMessage: "" });
          if (data.needs_family_setup) {
            this.saveSession(data);
            wx.setStorageSync("pendingOnboarding", { kind: "app" });
            wx.redirectTo({ url: "/pages/onboarding/onboarding" });
            return;
          }
          this.saveSession(data);
          wx.switchTab({ url: "/pages/home/home" });
        } catch (error) {
          this.setData({
            wechatLoading: false,
            serviceState: "unstable",
            serviceMessage: "当前网络请求可能被中断，可以再试一次",
            error: "微信登录没有成功",
            errorDetail: error.message
          });
        }
      },
      fail: () => this.setData({
        wechatLoading: false,
        serviceState: "unstable",
        serviceMessage: "当前微信运行环境没有返回登录凭证，请重新打开小程序后再试",
        error: "微信登录没有成功",
        errorDetail: "无法获取微信登录凭证"
      })
    });
  },

  openEmailLogin() {
    this.setData({ emailLoginStep: true, error: "", errorDetail: "" });
  },

  closeEmailLogin() {
    this.setData({ emailLoginStep: false, error: "", errorDetail: "", email: "", password: "" });
  },

  onEmailField(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, error: "", errorDetail: "" });
  },

  async submitEmailLogin() {
    if (this.data.emailLoading) return;
    const email = String(this.data.email || "").trim();
    const password = String(this.data.password || "");
    if (!email || !password) {
      this.setData({ error: "请填写邮箱和密码", errorDetail: "" });
      return;
    }
    this.setData({ emailLoading: true, error: "", errorDetail: "" });
    try {
      const data = await api.login({ email, password });
      this.saveSession(data);
      wx.switchTab({ url: "/pages/home/home" });
    } catch (error) {
      this.setData({ emailLoading: false, error: "邮箱登录没有成功", errorDetail: error.message });
    }
  },

  saveSession(data) {
    wx.setStorageSync("familyEduToken", data.token);
    wx.setStorageSync("familyEduUser", data.user || {});
    wx.setStorageSync("familyEduFamily", data.family || {});
    getApp().globalData.user = data.user || null;
    getApp().globalData.family = data.family || null;
  }
});
