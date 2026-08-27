const api = require("../../utils/api");
const format = require("../../utils/format");

Page({
  data: {
    loading: true,
    error: "",
    user: null,
    family: null,
    children: [],
    reports: [],
    stats: []
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [home, me] = await Promise.all([api.home(), api.me()]);
      const stats = [
        { label: "成长记录", value: `${home.stats.records || 0}`, tone: "accent" },
        { label: "作文完成", value: `${home.stats.writing || 0} 篇`, tone: "teal" },
        { label: "阅读复述", value: `${home.stats.reading || 0}%`, tone: "" },
        { label: "作业完成度", value: `${home.stats.homework || 0}%`, tone: "" }
      ];
      this.setData({
        user: me.user,
        family: me.family,
        children: (home.children || []).map((child) => ({
          ...child,
          subjectsText: (child.subjects || []).join("、") || "未设置"
        })),
        reports: (home.reports || []).map((report) => ({
          ...report,
          dateText: format.formatDate(report.createdAt),
          childName: format.childName(home.children || [], report.childId)
        })),
        stats,
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  goStudents() {
    wx.switchTab({ url: "/pages/students/students" });
  },

  goGrowth() {
    wx.switchTab({ url: "/pages/growth/growth" });
  },

  goLearning() {
    wx.switchTab({ url: "/pages/learning/learning" });
  },

  goSettings() {
    wx.switchTab({ url: "/pages/settings/settings" });
  }
});
