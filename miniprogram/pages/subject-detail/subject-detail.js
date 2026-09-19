const api = require("../../utils/api");
const format = require("../../utils/format");
const subjects = require("../../utils/subjects");

/**
 * 学科详情：回答「这一科现在什么水平、先解决什么、接下来怎么练、练到什么程度算过」。
 * 内容全部来自服务端规则计算，页面不做判断。
 */
Page({
  data: {
    loading: true,
    error: "",
    childId: "",
    subject: "",
    detail: null,
    judgement: "",
    statusText: "",
    scoreText: "—",
    gaps: [],
    advice: null,
    tasks: [],
    planningRequired: false
  },

  onLoad(options) {
    const subject = options && options.subject ? decodeURIComponent(options.subject) : "";
    this.setData({ childId: (options && options.childId) || "", subject });
  },

  onShow() {
    if (this.data.subject) this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const detail = await api.subjectDetail({ child_id: this.data.childId, subject: this.data.subject });
      this.setData({
        detail,
        judgement: detail.judgement || "",
        statusText: detail.status_text || "",
        scoreText: detail.mastery_score === null || detail.mastery_score === undefined ? "—" : String(Math.round(detail.mastery_score)),
        gaps: subjects.mapGaps(detail.gaps),
        advice: subjects.mapAdvice(detail.advice),
        tasks: (detail.tasks || []).map((item) => ({
          ...item,
          subjectMark: String(this.data.subject || "科").slice(0, 1),
          dueText: item.due_date ? `${format.formatDate(item.due_date)} 前` : "未设置截止时间",
          minutesText: item.estimated_minutes ? `预计 ${item.estimated_minutes} 分钟` : ""
        })),
        planningRequired: Boolean(detail.planning_required),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) return wx.navigateBack();
    wx.switchTab({ url: "/pages/home/home" });
  },

  goWrongBook() {
    if (!this.data.childId) return;
    wx.navigateTo({ url: `/pages/wrong-book/wrong-book?childId=${this.data.childId}` });
  }
});
