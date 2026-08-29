const api = require("../../utils/api");
const config = require("../../config");
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
    userInitial: "家",
    childCount: 0,
    mcpToken: "",
    workbuddyPrompt: "",
    doubaoPrompt: "",
    isWechatBound: false,
    copyText: "复制提示词",
    doubaoCopyText: "复制提示词",
    promptExpanded: false,
    doubaoPromptExpanded: false,
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
    policyChanges: [],
    memberRole: "admin",
    isOwner: false,
    members: [],
    pendingInvites: [],
    inviteEmail: "",
    joinInviteCode: "",
    inviteLoading: false,
    joinLoading: false,
    networkTesting: false,
    networkTestResult: ""
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
        userInitial: ((settings.family && settings.family.name) || (settings.user && settings.user.email) || "家").slice(0, 1),
        childCount: settings.child_count || 0,
        mcpToken: settings.mcp_token || "",
        workbuddyPrompt: settings.workbuddy_prompt || "",
        doubaoPrompt: settings.doubao_prompt || "",
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
        memberRole: settings.member ? settings.member.role : "admin",
        isOwner: Boolean(settings.member && settings.member.role === "owner"),
        members: (settings.members || []).map((item) => ({
          ...item,
          roleText: item.role === "owner" ? "创建者" : "管理者",
          joinedText: format.formatDate(item.joinedAt || item.createdAt),
          nameText: (item.user && (item.user.wechatNickname || item.user.email)) || "未命名账号",
          initial: ((item.user && (item.user.wechatNickname || item.user.email)) || "管").slice(0, 1),
          canRemove: settings.member && settings.member.role === "owner" && item.role !== "owner"
        })),
        pendingInvites: (settings.invites || []).map((item) => ({
          ...item,
          expiresText: format.formatDate(item.expiresAt),
          targetText: item.inviteEmail || "未限定邮箱"
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

  onInviteEmail(event) {
    this.setData({ inviteEmail: event.detail.value });
  },

  onJoinInviteCode(event) {
    this.setData({ joinInviteCode: event.detail.value });
  },

  testNetwork() {
    if (this.data.networkTesting) return;
    const url = `${config.baseUrl}/api/health`;
    this.setData({ networkTesting: true, networkTestResult: "正在测试网络..." });
    wx.request({
      url,
      method: "GET",
      timeout: 15000,
      enableHttp2: false,
      enableQuic: false,
      success: (res) => {
        this.setData({
          networkTesting: false,
          networkTestResult: `健康检查成功：HTTP ${res.statusCode}`
        });
      },
      fail: (error) => {
        const detail = error && error.errMsg ? error.errMsg : JSON.stringify(error || {});
        console.error("[family-edu health check failed]", { url, error });
        this.setData({
          networkTesting: false,
          networkTestResult: `健康检查失败：${detail}\n${url}`
        });
      }
    });
  },

  copyPrompt() {
    this.copyAgentPrompt("workbuddyPrompt", "copyText");
  },

  copyDoubaoPrompt() {
    this.copyAgentPrompt("doubaoPrompt", "doubaoCopyText");
  },

  copyAgentPrompt(promptKey, copyKey) {
    if (!this.data[promptKey]) return;
    wx.setClipboardData({
      data: this.data[promptKey],
      success: () => {
        this.setData({ [copyKey]: "已复制" });
        setTimeout(() => this.setData({ [copyKey]: "复制提示词" }), 1500);
      }
    });
  },

  togglePrompt() {
    this.setData({ promptExpanded: !this.data.promptExpanded });
  },

  toggleDoubaoPrompt() {
    this.setData({ doubaoPromptExpanded: !this.data.doubaoPromptExpanded });
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

  async createInvite() {
    if (!this.data.isOwner || this.data.inviteLoading) return;
    this.setData({ inviteLoading: true });
    try {
      const invite = await api.createFamilyInvite({ email: this.data.inviteEmail });
      wx.setClipboardData({
        data: invite.inviteCode,
        success: () => wx.showToast({ title: "邀请码已复制", icon: "success" })
      });
      this.setData({ inviteEmail: "" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ inviteLoading: false });
    }
  },

  copyInvite(event) {
    const code = event.currentTarget.dataset.code;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: "已复制", icon: "success" })
    });
  },

  cancelInvite(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || !this.data.isOwner) return;
    wx.showModal({
      title: "取消邀请",
      content: "确定取消这个家庭邀请吗？",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.cancelFamilyInvite(id);
          wx.showToast({ title: "已取消", icon: "success" });
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  removeMember(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || !this.data.isOwner) return;
    wx.showModal({
      title: "移除管理者",
      content: "移除后，对方将不能继续查看或同步这个家庭的数据。",
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.removeFamilyMember(id);
          wx.showToast({ title: "已移除", icon: "success" });
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  async acceptInvite() {
    const code = this.data.joinInviteCode.trim();
    if (!code || this.data.joinLoading) return;
    this.setData({ joinLoading: true });
    try {
      const data = await api.acceptFamilyInvite({ inviteCode: code });
      wx.setStorageSync("familyEduToken", data.token);
      wx.setStorageSync("familyEduUser", data.user || {});
      wx.setStorageSync("familyEduFamily", data.family || {});
      getApp().globalData.user = data.user || null;
      getApp().globalData.family = data.family || null;
      wx.showToast({ title: "已加入家庭", icon: "success" });
      wx.switchTab({ url: "/pages/home/home" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ joinLoading: false });
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
