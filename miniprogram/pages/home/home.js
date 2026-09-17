const api = require("../../utils/api");
const format = require("../../utils/format");
const presentation = require("../../utils/presentation");

function shortText(value, fallback) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback || "";
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

Page({
  data: {
    loading: true, error: "", family: null, children: [], childNames: [], childIndex: 0,
    activeChild: null, todayText: "", scene: presentation.SCENES[0], animationEnabled: true,
    hero: presentation.deriveChildPresentation({}), recentChanges: [], pendingTasks: []
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
      const childHomework = (home.homework || []).filter((item) => !activeChild || item.childId === activeChild.id);
      const hero = presentation.deriveChildPresentation({
        child: activeChild,
        childState: home.child_state,
        relationship: home.relationship,
        wrongQuestions: home.wrong_questions,
        mastery: home.mastery,
        reports: home.reports,
        homework: childHomework
      });
      const pendingTasks = childHomework.filter((item) => !["done", "cancelled"].includes(item.status)).slice(0, 3).map((item) => ({
        ...item,
        subjectMark: String(item.subject || "任").slice(0, 1),
        dueText: item.dueDate ? `${format.formatDate(item.dueDate)} 前` : "未设置截止时间"
      }));
      const recentChanges = [
        ...(home.records || []).map((item) => ({
          id: `record-${item.id}`, label: "成长记录", title: item.title || `${item.type || "学习"}记录`,
          text: shortText(item.notes || item.content, "暂无补充说明"), time: item.date || item.createdAt, target: "growth"
        })),
        ...(home.reports || []).map((item) => ({
          id: `report-${item.id}`, sourceId: item.id, label: item.type === "monthly" ? "月度报告" : "阶段报告",
          title: item.title || "成长报告", text: shortText(item.summary || item.content, "报告已同步"), time: item.createdAt, target: "report"
        }))
      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 2);

      this.setData({
        family: home.family, children, childNames: children.map((child) => child.displayText), childIndex, activeChild,
        todayText: format.formatDate(new Date()), scene: presentation.dailyScene(activeChild && activeChild.id, new Date()),
        hero, pendingTasks, recentChanges, loading: false
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

  onHeroImageError() { this.setData({ "hero.image": presentation.STATE_ASSETS.stable, animationEnabled: false }); },
  goStudents() { wx.switchTab({ url: "/pages/students/students" }); },
  goGrowth() { wx.switchTab({ url: "/pages/growth/growth" }); },
  goHomework() { wx.setStorageSync("familyEduLearningModule", "homework"); wx.navigateTo({ url: "/pages/learning-manager/learning-manager" }); },
  goChildState() {
    if (!this.data.activeChild) return this.goStudents();
    wx.navigateTo({ url: `/pages/child-state/child-state?childId=${this.data.activeChild.id}` });
  },
  goWeakness() {
    if (this.data.activeChild) wx.navigateTo({ url: `/pages/weakness-detail/weakness-detail?childId=${this.data.activeChild.id}` });
  },
  openInsight() {
    if (this.data.hero && this.data.hero.weakness) this.goWeakness();
    else this.goChildState();
  },
  openChange(event) {
    const item = this.data.recentChanges.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (item && item.target === "report") {
      const childId = this.data.activeChild ? this.data.activeChild.id : "";
      return wx.navigateTo({ url: `/pages/monthly-report/monthly-report?id=${item.sourceId}&childId=${childId}` });
    }
    this.goGrowth();
  }
});
