const config = require("../../config");
const api = require("../../utils/api");

Page({
  data: {
    mode: "login",
    bindStep: false,
    bindMode: "existing",
    bindToken: "",
    inviteCode: config.defaultInviteCode,
    email: "",
    password: "",
    error: "",
    errorDetail: "",
    serviceState: "checking",
    serviceTitle: "正在连接家庭档案服务",
    serviceDetail: "首次打开会先确认服务是否可访问",
    loading: false,
    wechatLoading: false
  },

  onLoad() {
    this.checkService(true);
  },

  onField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value, error: "", errorDetail: "" });
  },

  switchMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode, error: "", errorDetail: "" });
  },

  async checkService(silent) {
    if (!silent) {
      this.setData({
        serviceState: "checking",
        serviceTitle: "正在重新连接服务",
        serviceDetail: "请稍等，正在确认家庭档案服务是否可访问"
      });
    }
    try {
      await api.health();
      this.setData({
        serviceState: "ok",
        serviceTitle: "服务连接正常",
        serviceDetail: "可以使用微信登录或邮箱账号继续"
      });
      return true;
    } catch (error) {
      this.setData({
        serviceState: "unstable",
        serviceTitle: "服务连接不稳定",
        serviceDetail: "微信网络层暂时没有连上家庭档案服务。可以再试一次，或改用邮箱登录。"
      });
      return false;
    }
  },

  retryService() {
    this.checkService(false);
  },

  async submit() {
    if (this.data.loading) return;
    const { mode, email, password, inviteCode } = this.data;
    if (!email || !password) {
      this.setData({ error: "请填写邮箱和密码", errorDetail: "" });
      return;
    }
    this.setData({ loading: true, error: "", errorDetail: "" });
    try {
      const data = mode === "register"
        ? await api.register({ inviteCode, email, password })
        : await api.login({ email, password });
      this.saveSession(data);
    } catch (error) {
      this.setData({
        error: "邮箱登录没有成功",
        errorDetail: error.message
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  wechatLogin() {
    if (this.data.wechatLoading) return;
    this.setData({
      wechatLoading: true,
      error: "",
      errorDetail: "",
      serviceState: this.data.serviceState === "ok" ? "ok" : "checking",
      serviceTitle: this.data.serviceState === "ok" ? "服务连接正常" : "正在准备微信登录",
      serviceDetail: "正在获取微信凭证并连接家庭档案服务"
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
            serviceTitle: "服务连接正常",
            serviceDetail: "微信已识别，正在进入家庭档案"
          });
          if (data.need_bind) {
            this.setData({
              bindStep: true,
              bindMode: "existing",
              bindToken: data.bind_token,
              wechatLoading: false,
              error: ""
            });
            return;
          }
          this.saveSession(data);
        } catch (error) {
          this.setData({
            wechatLoading: false,
            serviceState: "unstable",
            serviceTitle: "微信登录暂时没有连上",
            serviceDetail: "服务端可用，但当前微信网络请求可能被中断。可以再试一次，或使用邮箱账号登录。",
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

  chooseBindMode(event) {
    this.setData({ bindMode: event.currentTarget.dataset.mode, error: "", errorDetail: "" });
  },

  async submitBind() {
    if (this.data.loading) return;
    const { bindToken, bindMode, email, password, inviteCode } = this.data;
    if (!email || !password || (bindMode === "register" && !inviteCode)) {
      this.setData({ error: "请填写完整绑定信息", errorDetail: "" });
      return;
    }
    this.setData({ loading: true, error: "", errorDetail: "" });
    try {
      const data = await api.wechatBind({
        bind_token: bindToken,
        mode: bindMode,
        email,
        password,
        inviteCode
      });
      this.saveSession(data);
    } catch (error) {
      this.setData({
        error: "关联家庭账号没有成功",
        errorDetail: error.message
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  saveSession(data) {
    this.setData({ error: "", errorDetail: "", loading: false, wechatLoading: false });
    wx.setStorageSync("familyEduToken", data.token);
    wx.setStorageSync("familyEduUser", data.user || {});
    wx.setStorageSync("familyEduFamily", data.family || {});
    getApp().globalData.user = data.user || null;
    getApp().globalData.family = data.family || null;
    wx.switchTab({ url: "/pages/home/home" });
  }
});
