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
    loading: false,
    wechatLoading: false
  },

  onField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value, error: "" });
  },

  switchMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode, error: "" });
  },

  async submit() {
    if (this.data.loading) return;
    const { mode, email, password, inviteCode } = this.data;
    if (!email || !password) {
      this.setData({ error: "请填写邮箱和密码" });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const data = mode === "register"
        ? await api.register({ inviteCode, email, password })
        : await api.login({ email, password });
      this.saveSession(data);
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  wechatLogin() {
    if (this.data.wechatLoading) return;
    this.setData({ wechatLoading: true, error: "" });
    wx.login({
      success: async (res) => {
        if (!res.code) {
          this.setData({ wechatLoading: false, error: "微信登录失败，请重试" });
          return;
        }
        try {
          const data = await api.wechatLogin({ code: res.code });
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
          this.setData({ wechatLoading: false, error: error.message });
        }
      },
      fail: () => this.setData({ wechatLoading: false, error: "无法获取微信登录凭证" })
    });
  },

  chooseBindMode(event) {
    this.setData({ bindMode: event.currentTarget.dataset.mode, error: "" });
  },

  async submitBind() {
    if (this.data.loading) return;
    const { bindToken, bindMode, email, password, inviteCode } = this.data;
    if (!email || !password || (bindMode === "register" && !inviteCode)) {
      this.setData({ error: "请填写完整绑定信息" });
      return;
    }
    this.setData({ loading: true, error: "" });
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
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  saveSession(data) {
    this.setData({ error: "", loading: false, wechatLoading: false });
    wx.setStorageSync("familyEduToken", data.token);
    wx.setStorageSync("familyEduUser", data.user || {});
    wx.setStorageSync("familyEduFamily", data.family || {});
    getApp().globalData.user = data.user || null;
    getApp().globalData.family = data.family || null;
    wx.switchTab({ url: "/pages/home/home" });
  }
});
