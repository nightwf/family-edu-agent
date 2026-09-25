const api = require("../../utils/api");
const format = require("../../utils/format");
const presentation = require("../../utils/presentation");
const planning = require("../../utils/planning");
const subjects = require("../../utils/subjects");

/**
 * 首页主次关系：
 * 1. 孩子整体状态（结论 + 关键数字）
 * 2. 各学科情况（主体，可进入学科详情看后续规划建议）
 * 3. 学习计划待规划提示与最近学习任务（次要）
 */
Page({
  data: {
    loading: true,
    error: "",
    family: null,
    children: [],
    childNames: [],
    childIndex: 0,
    activeChild: null,
    todayText: "",
    scene: presentation.SCENES[0],
    animationEnabled: true,
    overall: null,
    subjects: [],
    characterImage: "",
    planningCard: null,
    planningBusy: false,
    pendingTasks: []
  },

  onLoad() {
    let info = null;
    try { info = wx.getDeviceInfo ? wx.getDeviceInfo() : null; } catch (_error) { info = null; }
    this.setData({ animationEnabled: presentation.shouldAnimate(info) });
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const storedChildId = wx.getStorageSync("familyEduSelectedChildId");
      const home = await api.mobileHome({ child_id: storedChildId });
      const children = (home.children || []).map((child) => ({ ...child, displayText: `${child.name} · ${child.grade || "未设置年级"}` }));
      const activeChildId = home.active_child ? home.active_child.id : storedChildId;
      const foundIndex = children.findIndex((child) => child.id === activeChildId);
      const childIndex = foundIndex >= 0 ? foundIndex : 0;
      const activeChild = children[childIndex] || null;

      const overview = home.subject_overview || null;
      const rawSubjects = (overview && overview.subjects) || [];
      const evidenceCount = home.child_state && home.child_state.summary ? home.child_state.summary.evidence_7d : null;
      const characterState = subjects.pickCharacterState(rawSubjects);
      const childHomework = (home.homework || []).filter((item) => !activeChild || item.childId === activeChild.id);

      this.setData({
        family: home.family,
        children,
        childNames: children.map((child) => child.displayText),
        childIndex,
        activeChild,
        todayText: format.formatDate(new Date()),
        scene: presentation.dailyScene(activeChild && activeChild.id, new Date()),
        overall: subjects.mapOverall(overview && overview.overall, evidenceCount),
        subjects: subjects.mapSubjectRows(rawSubjects),
        characterImage: presentation.stateAsset(characterState, activeChild && activeChild.gender),
        planningCard: planning.buildPlanningCard(activeChild, home.learning_priorities, home.planning_request),
        planningBusy: false,
        pendingTasks: childHomework
          .filter((item) => !["done", "cancelled"].includes(item.status))
          .slice(0, 3)
          .map((item) => ({
            ...item,
            subjectMark: String(item.subject || "任").slice(0, 1),
            dueText: item.dueDate ? `${format.formatDate(item.dueDate)} 前` : "未设置截止时间"
          })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  onChildChange(event) {
    const childIndex = Number(event.detail.value);
    const child = this.data.children[childIndex];
    if (child) wx.setStorageSync("familyEduSelectedChildId", child.id);
    this.setData({ childIndex });
    this.load();
  },

  onHeroImageError() {
    const gender = this.data.activeChild && this.data.activeChild.gender;
    this.setData({ characterImage: presentation.stateAsset("stable", gender) });
  },

  openSubject(event) {
    const subject = event.currentTarget.dataset.subject;
    if (!subject || !this.data.activeChild) return;
    wx.navigateTo({ url: `/pages/subject-detail/subject-detail?childId=${this.data.activeChild.id}&subject=${encodeURIComponent(subject)}` });
  },

  goStudents() { wx.switchTab({ url: "/pages/students/students" }); },
  goGrowth() { wx.switchTab({ url: "/pages/growth/growth" }); },
  goHomework() { wx.setStorageSync("familyEduLearningModule", "homework"); wx.navigateTo({ url: "/pages/learning-manager/learning-manager" }); },
  goLearning() { wx.switchTab({ url: "/pages/learning/learning" }); },
  goChildState() {
    if (!this.data.activeChild) return this.goStudents();
    wx.navigateTo({ url: `/pages/child-state/child-state?childId=${this.data.activeChild.id}` });
  },

  async generateAiPlan() {
    const card = this.data.planningCard;
    if (!card || !card.canGenerate || this.data.planningBusy) return;
    this.setData({ planningBusy: true, error: "" });
    try {
      await api.generateAiPlan(card.id);
      wx.showToast({ title: "计划草稿已生成", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: error.message, planningBusy: false });
    }
  },

  confirmAiPlan() {
    const card = this.data.planningCard;
    if (!card || !card.canConfirm || this.data.planningBusy) return;
    wx.showModal({
      title: "确认学习计划",
      content: "确认后，这份阶段目标和本周任务会正式开始执行。",
      confirmText: "确认开始",
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ planningBusy: true, error: "" });
        try {
          await api.confirmAiPlan(card.id);
          wx.showToast({ title: "计划已开始", icon: "success" });
          await this.load();
        } catch (error) {
          this.setData({ error: error.message, planningBusy: false });
        }
      }
    });
  }
});
