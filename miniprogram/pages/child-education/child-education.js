const api = require("../../utils/api");

const PHILOSOPHIES = ["以引导和鼓励为主", "兴趣优先", "习惯优先", "成绩与能力并重", "自主探索"];
const COMMUNICATION_STYLES = ["温和直接", "鼓励为主", "简洁明确", "陪伴讨论"];
const STRICTNESS = ["宽松", "适中", "严格"];
const SKILL_LABELS = {
  "growth-analysis": "成长分析",
  "homework-planner": "作业规划",
  "parent-coach": "家长沟通",
  "reading-coach": "阅读引导",
  "writing-coach": "写作指导"
};

function indexOf(list, value, fallback) {
  const found = list.indexOf(value);
  return found >= 0 ? found : fallback;
}

Page({
  data: {
    loading: true,
    error: "",
    childId: "",
    childName: "",
    childInitial: "学",
    skills: [],
    activeIndex: 0,
    inheritsFamily: true,
    philosophies: PHILOSOPHIES,
    communicationStyles: COMMUNICATION_STYLES,
    strictnessOptions: STRICTNESS,
    philosophy: PHILOSOPHIES[0],
    philosophyIndex: 0,
    communicationStyle: COMMUNICATION_STYLES[0],
    communicationIndex: 0,
    strictness: STRICTNESS[1],
    strictnessIndex: 1,
    parentGoals: "",
    notes: "",
    saving: false
  },

  onLoad(options) {
    this.setData({
      childId: options.childId || wx.getStorageSync("familyEduSelectedChildId") || "",
      childName: options.name ? decodeURIComponent(options.name) : ""
    });
  },

  onShow() {
    this.load();
  },

  async load() {
    if (!this.data.childId) {
      this.setData({ loading: false, error: "缺少学生信息，请从学生详情进入" });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const list = await api.childEducationProfile(this.data.childId);
      const skills = (list || []).map((item) => ({
        skillId: item.skill_id,
        name: SKILL_LABELS[item.skill_id] || item.name || item.skill_id,
        inheritsFamily: Boolean(item.inherits_family),
        overrides: item.child_overrides || [],
        effective: item.effective_settings || {},
        profile: item.profile || null,
        inheritedFromFamily: item.inherited_from_family || {}
      }));
      const childName = (list && list[0] && list[0].child_name) || this.data.childName;
      this.setData({
        skills,
        childName,
        childInitial: (childName || "学").slice(0, 1),
        activeIndex: 0,
        loading: false
      });
      this.applySkill(0, skills);
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  applySkill(index, skills) {
    const list = skills || this.data.skills;
    const skill = list[index];
    if (!skill) return;
    const settings = skill.effective || {};
    this.setData({
      activeIndex: index,
      inheritsFamily: skill.inheritsFamily,
      philosophy: settings.philosophy || PHILOSOPHIES[0],
      philosophyIndex: indexOf(PHILOSOPHIES, settings.philosophy, 0),
      communicationStyle: settings.communicationStyle || COMMUNICATION_STYLES[0],
      communicationIndex: indexOf(COMMUNICATION_STYLES, settings.communicationStyle, 0),
      strictness: settings.strictness || STRICTNESS[1],
      strictnessIndex: indexOf(STRICTNESS, settings.strictness, 1),
      parentGoals: (settings.parentGoals || []).join("、"),
      notes: (skill.profile && skill.profile.notes) || ""
    });
  },

  onSkillTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isNaN(index) || index === this.data.activeIndex) return;
    this.applySkill(index);
  },

  onPhilosophyChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ philosophyIndex: index, philosophy: PHILOSOPHIES[index] });
  },

  onCommunicationChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ communicationIndex: index, communicationStyle: COMMUNICATION_STYLES[index] });
  },

  onStrictnessChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ strictnessIndex: index, strictness: STRICTNESS[index] });
  },

  onParentGoals(event) {
    this.setData({ parentGoals: event.detail.value });
  },

  onNotes(event) {
    this.setData({ notes: event.detail.value });
  },

  buildPayload(skillId) {
    return {
      skill_id: skillId,
      philosophy: this.data.philosophy,
      communication_style: this.data.communicationStyle,
      strictness: this.data.strictness,
      parent_goals: this.data.parentGoals.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      notes: this.data.notes
    };
  },

  async save() {
    const skill = this.data.skills[this.data.activeIndex];
    if (!skill || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await api.updateChildEducationProfile(this.data.childId, this.buildPayload(skill.skillId));
      wx.showToast({ title: "已保存", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  saveAll() {
    if (this.data.saving || !this.data.skills.length) return;
    wx.showModal({
      title: "应用到全部场景",
      content: "把当前设置写入这个孩子的所有教育场景，覆盖各场景已有的单独设置。",
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ saving: true });
        try {
          for (const skill of this.data.skills) {
            await api.updateChildEducationProfile(this.data.childId, this.buildPayload(skill.skillId));
          }
          wx.showToast({ title: "已应用到全部场景", icon: "success" });
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        } finally {
          this.setData({ saving: false });
        }
      }
    });
  },

  resetToFamily() {
    const skill = this.data.skills[this.data.activeIndex];
    if (!skill || this.data.saving || skill.inheritsFamily) return;
    wx.showModal({
      title: "恢复继承家庭设置",
      content: `清除这个孩子在「${skill.name}」上的单独设置，改为跟随家庭统一设置。`,
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ saving: true });
        try {
          await api.updateChildEducationProfile(this.data.childId, { skill_id: skill.skillId, clear: true });
          wx.showToast({ title: "已恢复", icon: "success" });
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        } finally {
          this.setData({ saving: false });
        }
      }
    });
  }
});
