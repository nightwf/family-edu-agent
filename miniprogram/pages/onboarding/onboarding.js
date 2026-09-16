const api = require("../../utils/api");

Page({
  data: {
    step: "choose",
    mode: "create",
    familyName: "",
    joinCode: "",
    loading: false,
    error: "",
    memberships: [],
    pendingRequests: [],
    receivedRequests: [],
    joinSubmitted: null
  },

  onLoad() {
    this.loadState();
  },

  async loadState() {
    try {
      const data = await api.onboarding();
      this.setData({
        memberships: data.memberships || [],
        pendingRequests: data.pending_join_requests || [],
        receivedRequests: data.received_join_requests || []
      });
      if ((data.memberships || []).length > 0) {
        this.setData({ step: "select" });
      }
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  chooseMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode, error: "" });
  },

  onField(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, error: "" });
  },

  async submitCreate() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.createFamily({ name: this.data.familyName });
      this.applySession(data);
      this.finish("家庭已创建");
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  async submitJoin() {
    if (this.data.loading) return;
    const joinCode = String(this.data.joinCode || "").trim();
    if (!/^\d{6}$/.test(joinCode)) {
      this.setData({ error: "请输入 6 位家庭编码" });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.applyFamilyJoin({ join_code: joinCode });
      this.setData({ step: "waiting", joinSubmitted: data });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  async approveRequest(event) {
    const id = event.currentTarget.dataset.id;
    try {
      await api.reviewFamilyJoinRequest(id, { action: "approved" });
      wx.showToast({ title: "已通过", icon: "success" });
      await this.loadState();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  async rejectRequest(event) {
    const id = event.currentTarget.dataset.id;
    try {
      await api.reviewFamilyJoinRequest(id, { action: "rejected" });
      wx.showToast({ title: "已拒绝", icon: "none" });
      await this.loadState();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  async refreshStatus() {
    await this.loadState();
    if (this.data.memberships.length > 0) {
      this.finish("已加入家庭");
      return;
    }
    wx.showToast({ title: "还在等待管理员审核", icon: "none" });
  },

  useFamily(event) {
    const familyId = event.currentTarget.dataset.id;
    const family = this.data.memberships.find((item) => item.familyId === familyId);
    if (!family) return;
    const stored = wx.getStorageSync("familyEduFamily") || {};
    wx.setStorageSync("familyEduFamily", { ...stored, id: family.familyId, name: family.family && family.family.name });
    this.finish("已进入家庭");
  },

  applySession(data) {
    if (!data || !data.token) return;
    wx.setStorageSync("familyEduToken", data.token);
    wx.setStorageSync("familyEduUser", data.user || {});
    wx.setStorageSync("familyEduFamily", data.family || {});
    getApp().globalData.user = data.user || null;
    getApp().globalData.family = data.family || null;
  },

  finish(message) {
    const pending = wx.getStorageSync("pendingOnboarding") || { kind: "app" };
    wx.removeStorageSync("pendingOnboarding");
    if (message) wx.showToast({ title: message, icon: "success" });
    if (pending.kind === "workbuddy" && pending.scene) {
      wx.redirectTo({ url: `/pages/workbuddy-bind/workbuddy-bind?scene=${encodeURIComponent(pending.scene)}` });
      return;
    }
    if (pending.kind === "web" && pending.scene) {
      wx.redirectTo({ url: `/pages/web-login/web-login?scene=${encodeURIComponent(pending.scene)}` });
      return;
    }
    wx.switchTab({ url: "/pages/home/home" });
  }
});
