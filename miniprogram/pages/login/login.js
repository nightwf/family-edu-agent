const api = require("../../utils/api");

Page({
  data: {
    attachStep: false,
    attachEmail: "",
    attachPassword: "",
    error: "",
    errorDetail: "",
    serviceState: "idle",
    serviceTitle: "微信授权后即可进入",
    serviceDetail: "点击下方按钮，用微信身份登录家庭档案",
    wechatLoading: false
  },

  onLoad(options = {}) {
    if (options.family_invite) {
      wx.setStorageSync("pendingFamilyInvite", options.family_invite);
    }
    if (wx.getStorageSync("familyEduToken")) {
      const family = wx.getStorageSync("familyEduFamily");
      if (family && family.id) wx.switchTab({ url: "/pages/home/home" });
      else wx.redirectTo({ url: "/pages/onboarding/onboarding" });
    }
  },

  async checkService() {
    this.setData({
      serviceState: "checking",
      serviceTitle: "正在连接服务",
      serviceDetail: "请稍等，正在确认家庭档案服务是否可访问"
    });
    try {
      await api.health();
      this.setData({
        serviceState: "ok",
        serviceTitle: "服务连接正常",
        serviceDetail: "可以继续用微信授权登录"
      });
    } catch (error) {
      this.setData({
        serviceState: "unstable",
        serviceTitle: "服务连接不稳定",
        serviceDetail: "当前网络没有连上家庭档案服务，可以稍后重试"
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
      serviceState: "checking",
      serviceTitle: "正在准备微信登录",
      serviceDetail: "正在获取微信身份并连接家庭档案服务"
    });
    wx.login({
      success: async (res) => {
        if (!res.code) {
          this.setData({
            wechatLoading: false,
            serviceState: "unstable",
            serviceTitle: "微信凭证获取失败",
            serviceDetail: "当前微信运行环境没有返回登录凭证，请重新打开小程序后再试。",
            error: "微信登录没有成功",
            errorDetail: "没有获取到微信登录凭证"
          });
          return;
        }
        try {
          const data = await api.wechatLogin({ code: res.code });
          this.setData({
            serviceState: "ok",
            serviceTitle: "微信已识别",
            serviceDetail: data.needs_family_setup ? "还需要选择家庭" : "正在进入家庭档案"
          });
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
            serviceTitle: "微信登录暂时没有连上",
            serviceDetail: "服务端可用，但当前微信网络请求可能被中断，可以再试一次。",
            error: "微信登录没有成功",
            errorDetail: error.message
          });
        }
      },
      fail: () => this.setData({
        wechatLoading: false,
        serviceState: "unstable",
        serviceTitle: "微信凭证获取失败",
        serviceDetail: "当前微信运行环境没有返回登录凭证，请重新打开小程序后再试。",
        error: "微信登录没有成功",
        errorDetail: "无法获取微信登录凭证"
      })
    });
  },

  openAttach() {
    this.setData({ attachStep: true, error: "", errorDetail: "" });
  },

  closeAttach() {
    this.setData({ attachStep: false, error: "", errorDetail: "", attachEmail: "", attachPassword: "" });
  },

  onAttachField(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, error: "", errorDetail: "" });
  },

  attachAccount() {
    if (this.data.wechatLoading) return;
    const email = String(this.data.attachEmail || "").trim();
    const password = String(this.data.attachPassword || "");
    if (!email || !password) {
      this.setData({ error: "请填写邮箱和密码", errorDetail: "" });
      return;
    }
    this.setData({ wechatLoading: true, error: "", errorDetail: "" });
    wx.login({
      success: async (res) => {
        if (!res.code) {
          this.setData({ wechatLoading: false, error: "没有获取到微信登录凭证", errorDetail: "" });
          return;
        }
        try {
          const data = await api.attachWechatAccount({ code: res.code, email, password });
          this.saveSession(data);
          wx.showToast({ title: "已绑定微信", icon: "success" });
          wx.switchTab({ url: "/pages/home/home" });
        } catch (error) {
          this.setData({ wechatLoading: false, error: "绑定没有成功", errorDetail: error.message });
        }
      },
      fail: () => this.setData({ wechatLoading: false, error: "无法获取微信登录凭证", errorDetail: "" })
    });
  },

  saveSession(data) {
    wx.setStorageSync("familyEduToken", data.token);
    wx.setStorageSync("familyEduUser", data.user || {});
    wx.setStorageSync("familyEduFamily", data.family || {});
    getApp().globalData.user = data.user || null;
    getApp().globalData.family = data.family || null;
  }
});
