const api = require("../../utils/api");

Page({
  data: {
    scene: "",
    step: "loading",
    memberships: [],
    selectedFamilyId: "",
    loading: false,
    error: ""
  },

  onLoad(options = {}) {
    const scene = decodeURIComponent(options.scene || "");
    if (!scene) {
      this.setData({ step: "error", error: "缺少登录参数，请刷新网页重新生成二维码" });
      return;
    }
    this.setData({ scene });
    this.startLogin();
  },

  startLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "" });
    wx.login({
      success: async (res) => {
        if (!res.code) {
          this.setData({ step: "error", error: "没有获取到微信登录凭证", loading: false });
          return;
        }
        try {
          const data = await api.webLoginSession(this.data.scene, { code: res.code });
          wx.setStorageSync("familyEduToken", data.token);
          wx.setStorageSync("familyEduUser", data.user || {});
          wx.setStorageSync("familyEduFamily", data.family || {});
          const memberships = data.memberships || [];
          if (data.needs_family_setup || !memberships.length) {
            wx.setStorageSync("pendingOnboarding", { kind: "web", scene: this.data.scene });
            wx.redirectTo({ url: "/pages/onboarding/onboarding" });
            return;
          }
          this.setData({
            step: "confirm",
            memberships,
            selectedFamilyId: memberships[0].familyId,
            loading: false
          });
        } catch (error) {
          this.setData({ step: "error", error: error.message, loading: false });
        }
      },
      fail: () => this.setData({ step: "error", error: "无法获取微信登录凭证", loading: false })
    });
  },

  selectFamily(event) {
    this.setData({ selectedFamilyId: event.currentTarget.dataset.id });
  },

  async approve() {
    if (!this.data.selectedFamilyId) return;
    this.setData({ loading: true, error: "" });
    try {
      await api.webLoginApprove(this.data.scene, { familyId: this.data.selectedFamilyId });
      const family = this.data.memberships.find((item) => item.familyId === this.data.selectedFamilyId);
      wx.setStorageSync("familyEduFamily", { id: this.data.selectedFamilyId, name: family && family.family && family.family.name });
      this.setData({ step: "done", loading: false });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  openHome() {
    wx.switchTab({ url: "/pages/home/home" });
  }
});
