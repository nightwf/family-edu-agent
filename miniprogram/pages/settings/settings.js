const api = require("../../utils/api");
const format = require("../../utils/format");

const PHILOSOPHIES = ["以引导和鼓励为主", "兴趣优先", "习惯优先", "成绩与能力并重", "自主探索"];
const COMMUNICATION_STYLES = ["温和直接", "鼓励为主", "简洁明确", "陪伴讨论"];
const STRICTNESS = ["宽松", "适中", "严格"];

Page({
  data: {
    loading: true,
    error: "",
    user: null,
    family: null,
    childCount: 0,
    mcpToken: "",
    workbuddyPrompt: "",
    isWechatBound: false,
    copyText: "复制提示词",
    philosophies: PHILOSOPHIES,
    communicationStyles: COMMUNICATION_STYLES,
    strictnessOptions: STRICTNESS,
    philosophy: "以引导和鼓励为主",
    philosophyIndex: 0,
    communicationStyle: "温和直接",
    communicationIndex: 0,
    strictness: "适中",
    strictnessIndex: 1,
    parentGoals: "",
    recommendedMethods: [],
    policyChanges: []
  },

  async onShow() {
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [settings, educationData, methods, changes] = await Promise.all([
        api.settings(),
        api.getEducationSettings(),
        api.educationMethods(),
        api.policyChanges()
      ]);
      const education = educationData || {};
      const philosophy = education.educationPhilosophy || this.data.philosophy;
      const communicationStyle = education.communicationStyle || this.data.communicationStyle;
      const strictness = education.strictness || this.data.strictness;
      this.setData({
        user: settings.user,
        family: settings.family,
        childCount: settings.child_count || 0,
        mcpToken: settings.mcp_token || "",
        workbuddyPrompt: settings.workbuddy_prompt || "",
        isWechatBound: Boolean(settings.user && settings.user.wechatOpenId),
        philosophy,
        philosophyIndex: Math.max(0, PHILOSOPHIES.indexOf(philosophy)),
        communicationStyle,
        communicationIndex: Math.max(0, COMMUNICATION_STYLES.indexOf(communicationStyle)),
        strictness,
        strictnessIndex: Math.max(0, STRICTNESS.indexOf(strictness)),
        parentGoals: (education.parentGoals || []).join("、"),
        recommendedMethods: (methods.recommended || []).map((item) => item.name),
        policyChanges: (changes || []).filter((item) => item.status === "proposed").map((item) => ({
          ...item,
          createdText: format.formatDate(item.createdAt)
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  onPhilosophyChange(event) {
    const index = Number(event.detail.value);
    this.setData({ philosophyIndex: index, philosophy: PHILOSOPHIES[index] });
  },

  onCommunicationChange(event) {
    const index = Number(event.detail.value);
    this.setData({ communicationIndex: index, communicationStyle: COMMUNICATION_STYLES[index] });
  },

  onStrictnessChange(event) {
    const index = Number(event.detail.value);
    this.setData({ strictnessIndex: index, strictness: STRICTNESS[index] });
  },

  onParentGoals(event) {
    this.setData({ parentGoals: event.detail.value });
  },

  copyPrompt() {
    if (!this.data.workbuddyPrompt) return;
    wx.setClipboardData({
      data: this.data.workbuddyPrompt,
      success: () => {
        this.setData({ copyText: "已复制" });
        setTimeout(() => this.setData({ copyText: "复制提示词" }), 1500);
      }
    });
  },

  bindWechat() {
    wx.login({
      success: async (res) => {
        if (!res.code) {
          wx.showToast({ title: "微信登录失败", icon: "none" });
          return;
        }
        try {
          await api.bindCurrentWechat({ code: res.code });
          wx.showToast({ title: "微信绑定成功", icon: "success" });
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      },
      fail: () => wx.showToast({ title: "无法获取微信凭证", icon: "none" })
    });
  },

  async saveEducation() {
    try {
      await api.updateEducationSettings({
        education_philosophy: this.data.philosophy,
        communication_style: this.data.communicationStyle,
        strictness: this.data.strictness,
        parent_goals: this.data.parentGoals.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
      });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  async reviewPolicy(event) {
    const id = event.currentTarget.dataset.id;
    const action = event.currentTarget.dataset.action;
    try {
      await api.reviewPolicyChange(id, { action });
      wx.showToast({ title: action === "approved" ? "已采纳" : "已忽略", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确定退出当前账号吗？",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.logout();
        } catch (_error) {
          // local logout still proceeds
        }
        wx.removeStorageSync("familyEduToken");
        wx.removeStorageSync("familyEduUser");
        wx.removeStorageSync("familyEduFamily");
        wx.reLaunch({ url: "/pages/login/login" });
      }
    });
  }
});
