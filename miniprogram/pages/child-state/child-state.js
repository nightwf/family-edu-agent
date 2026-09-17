const api = require("../../utils/api");
const format = require("../../utils/format");
const presentation = require("../../utils/presentation");

Page({
  data: { loading: true, error: "", childId: "", child: null, hero: presentation.deriveChildPresentation({}), evidence: [], relationship: null },
  onLoad(options) { this.setData({ childId: options.childId || wx.getStorageSync("familyEduSelectedChildId") || "" }); },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const home = await api.mobileHome({ child_id: this.data.childId });
      const child = home.active_child;
      const hero = presentation.deriveChildPresentation({ child, childState: home.child_state, relationship: home.relationship, wrongQuestions: home.wrong_questions, mastery: home.mastery, reports: home.reports, homework: home.homework || [] });
      const evidence = (((home.child_state || {}).recent_evidence) || []).map((item) => ({ ...item, dateText: format.formatDate(item.observedAt), titleText: item.title || item.dimension || item.type || "学习证据", contentText: item.summary || item.content || item.observation || "暂无补充说明" }));
      this.setData({ child, hero, evidence, relationship: home.relationship, loading: false });
    } catch (error) { this.setData({ error: error.message, loading: false }); }
  },
  goWeakness() { wx.navigateTo({ url: `/pages/weakness-detail/weakness-detail?childId=${this.data.childId}` }); },
  goGrowth() { wx.switchTab({ url: "/pages/growth/growth" }); }
});
