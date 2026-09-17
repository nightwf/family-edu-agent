const api = require("../../utils/api");
const config = require("../../config");
const format = require("../../utils/format");
const session = require("../../utils/session");

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
    openPlatformSteps: [],
    workbuddyPrompt: "",
    doubaoPrompt: "",
    isWechatBound: false,
    copyText: "复制提示词",
    tokenCopyText: "复制 Token",
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
    networkTesting: false,
    networkTestResult: "",
    familyPolicy: null,
    memberships: [],
    joinCode: "",
    connections: [],
    legacyConnections: [],
    joinRequests: [],
    joinCodeInput: "",
    joinSubmitting: false,
    methodLibrary: [],
    policyWeeklyTimeBudget: "",
    policyPrioritySubjects: "",
    policyPressureBoundary: "",
    policyParentGoals: ""
  },

  async onShow() {
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [settings, familyPolicy, membershipsData, methodLibrary] = await Promise.all([
        api.settings(),
        api.getFamilyPolicy(),
        api.familyMemberships(),
        api.listEducationMethodsV2()
      ]);
      const education = settings.education_settings || {};
      const methods = settings.education_methods || { recommended: [] };
      const changes = settings.policy_changes || [];
      const philosophy = education.educationPhilosophy || this.data.philosophy;
      const communicationStyle = education.communicationStyle || this.data.communicationStyle;
      const strictness = education.strictness || this.data.strictness;
      this.setData({
        user: settings.user,
        family: settings.family,
        userInitial: ((settings.family && settings.family.name) || (settings.user && settings.user.email) || "家").slice(0, 1),
        childCount: settings.child_count || 0,
        mcpToken: settings.mcp_token || "",
        joinCode: settings.join_code || "",
        connections: (settings.connections || []).map((item) => ({
          ...item,
          tag: "扫码授权",
          createdText: format.formatDate(item.created_at),
          usedText: item.last_used_at ? format.formatDate(item.last_used_at) : "尚未调用"
        })),
        legacyConnections: (settings.legacy_connections || []).map((item) => ({
          ...item,
          tag: "旧版 Token",
          createdText: format.formatDate(item.created_at),
          usedText: item.last_used_at ? format.formatDate(item.last_used_at) : "尚未调用"
        })),
        joinRequests: (settings.join_requests || []).map((item) => ({
          ...item,
          createdText: format.formatDate(item.created_at),
          nameText: (item.user && item.user.wechatNickname) || "微信用户"
        })),
        openPlatformSteps: (settings.workbuddy_open_platform && settings.workbuddy_open_platform.install_steps) || [],
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
        familyPolicy,
        policyWeeklyTimeBudget: familyPolicy && familyPolicy.weeklyTimeBudget ? String(familyPolicy.weeklyTimeBudget) : "",
        policyPrioritySubjects: (familyPolicy && familyPolicy.prioritySubjects || []).join("、"),
        policyPressureBoundary: familyPolicy && familyPolicy.pressureBoundary || "",
        policyParentGoals: (familyPolicy && familyPolicy.parentGoals || []).join("、"),
        memberships: (membershipsData.memberships || []).map((item) => ({
          ...item,
          isCurrent: membershipsData.current_family_id === item.family.id,
          familyName: item.family.name,
          familyInitial: (item.family.name || "家").slice(0, 1),
          roleText: item.role === "owner" ? "创建者" : "管理者"
        })),
        methodLibrary: (methodLibrary || []).map((item) => ({
          ...item,
          categoryText: item.category === "CORE" ? "核心" : item.category === "SCENARIO" ? "场景" : "理念参考"
        })),
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
        loading: false,
        error: ""
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

  onPolicyField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value });
  },

  async saveFamilyPolicy() {
    try {
      await api.updateFamilyPolicy({
        weekly_time_budget: this.data.policyWeeklyTimeBudget ? Number(this.data.policyWeeklyTimeBudget) : null,
        priority_subjects: this.data.policyPrioritySubjects.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
        pressure_boundary: this.data.policyPressureBoundary,
        parent_goals: this.data.policyParentGoals.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
      });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  async switchFamily(event) {
    const familyId = event.currentTarget.dataset.id;
    if (!familyId) return;
    try {
      const data = await api.switchFamily({ familyId });
      wx.setStorageSync("familyEduToken", data.token);
      wx.setStorageSync("familyEduUser", data.user || {});
      wx.setStorageSync("familyEduFamily", data.family || {});
      getApp().globalData.user = data.user || null;
      getApp().globalData.family = data.family || null;
      session.clearFamilyScopedCache(wx);
      wx.showToast({ title: "已切换家庭", icon: "success" });
      wx.switchTab({ url: "/pages/home/home" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  testNetwork() {
    if (this.data.networkTesting) return;
    const url = `${config.baseUrl}/api/health`;
    const startedAt = format.formatDate(new Date().toISOString());
    const maxRetry = 8;
    this.setData({ networkTesting: true, networkTestResult: `正在测试网络... ${startedAt}` });
    const send = (attempt) => {
      this.setData({ networkTestResult: `正在测试网络... 第 ${attempt + 1}/${maxRetry + 1} 次 · ${startedAt}` });
      wx.request({
        url,
        method: "GET",
        timeout: 15000,
        enableHttp2: false,
        enableQuic: false,
        success: (res) => {
          const finishedAt = format.formatDate(new Date().toISOString());
          this.setData({
            error: "",
            networkTesting: false,
            networkTestResult: `健康检查成功：HTTP ${res.statusCode} · 第 ${attempt + 1} 次 · ${finishedAt}`
          });
        },
        fail: (error) => {
          const detail = error && error.errMsg ? error.errMsg : JSON.stringify(error || {});
          const finishedAt = format.formatDate(new Date().toISOString());
          console.error("[family-edu health check failed]", { url, detail, attempt });
          if (attempt < maxRetry) {
            setTimeout(() => send(attempt + 1), 600 + attempt * 400);
            return;
          }
          this.setData({
            networkTesting: false,
            networkTestResult: `健康检查失败：${detail} · 已重试 ${maxRetry + 1} 次 · ${finishedAt}\n${url}`
          });
        }
      });
    };
    send(0);
  },

  copyPrompt() {
    this.copyAgentPrompt("workbuddyPrompt", "copyText");
  },

  copyJoinCode() {
    if (!this.data.joinCode) return;
    wx.setClipboardData({
      data: this.data.joinCode,
      success: () => wx.showToast({ title: "家庭编码已复制", icon: "success" })
    });
  },

  onJoinCodeInput(event) {
    this.setData({ joinCodeInput: event.detail.value });
  },

  async submitJoinRequest() {
    if (this.data.joinSubmitting) return;
    const joinCode = String(this.data.joinCodeInput || "").trim();
    if (!/^[0-9]{6}$/.test(joinCode)) {
      wx.showToast({ title: "请输入 6 位家庭编码", icon: "none" });
      return;
    }
    this.setData({ joinSubmitting: true });
    try {
      await api.applyFamilyJoin({ join_code: joinCode });
      wx.showModal({ title: "申请已提交", content: "等家庭创建者审核通过后即可进入该家庭。", showCancel: false });
      this.setData({ joinCodeInput: "" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ joinSubmitting: false });
    }
  },

  async reviewJoinRequest(event) {
    const id = event.currentTarget.dataset.id;
    const action = event.currentTarget.dataset.action;
    try {
      await api.reviewFamilyJoinRequest(id, { action });
      wx.showToast({ title: action === "approved" ? "已通过" : "已拒绝", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  revokeConnection(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "解除授权",
      content: "解除后 WorkBuddy 需要重新扫码授权才能访问本家庭数据。",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.revokeConnection(id);
          wx.showToast({ title: "已解除", icon: "success" });
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  copyMcpToken() {
    this.copyAgentPrompt("mcpToken", "tokenCopyText");
  },

  copyDoubaoPrompt() {
    this.copyAgentPrompt("doubaoPrompt", "doubaoCopyText");
  },

  copyAgentPrompt(promptKey, copyKey) {
    if (!this.data[promptKey]) return;
    const idleText = copyKey === "tokenCopyText" ? "复制 Token" : "复制提示词";
    wx.setClipboardData({
      data: this.data[promptKey],
      success: () => {
        this.setData({ [copyKey]: "已复制" });
        setTimeout(() => this.setData({ [copyKey]: idleText }), 1500);
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
