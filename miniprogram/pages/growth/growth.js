const api = require("../../utils/api");
const format = require("../../utils/format");

const TYPE_LABELS = {
  writing: "写作",
  reading: "阅读",
  homework: "作业",
  parent_note: "家长备注"
};

Page({
  data: {
    loading: true,
    error: "",
    children: [],
    childNames: [],
    childIndex: 0,
    childId: "",
    tab: "records",
    records: [],
    reports: [],
    growth: [],
    detail: null,
    detailType: ""
  },

  async onShow() {
    await this.loadChildren();
  },

  async loadChildren() {
    try {
      const savedChildId = wx.getStorageSync("familyEduSelectedChildId");
      const data = await api.mobileGrowth({ child_id: savedChildId });
      const children = data.children || [];
      const activeChildId = data.active_child ? data.active_child.id : savedChildId;
      const savedIndex = children.findIndex((child) => child.id === activeChildId);
      const childIndex = savedIndex >= 0 ? savedIndex : 0;
      const childId = children.length ? children[childIndex].id : "";
      this.setGrowthData(data, {
        children,
        childNames: children.map((child) => `${child.name} · ${child.grade}`),
        childId,
        childIndex
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  setGrowthData(data, extra = {}) {
    this.setData({
      ...extra,
      records: (data.records || []).map((item) => ({
        ...item,
        dateText: format.formatDate(item.date),
        typeLabel: TYPE_LABELS[item.type] || item.type || "记录"
      })),
      reports: (data.reports || []).map((item) => ({
        ...item,
        dateText: format.formatDate(item.createdAt),
        typeLabel: item.type === "weekly" ? "周报" : "月报"
      })),
      growth: (data.growth || []).map((item, index) => ({
        ...item,
        dateText: format.formatDate(item.date),
        scorePercent: Math.min(100, Number(item.score || 0)),
        row: index + 1
      })),
      loading: false
    });
  },

  onChildChange(event) {
    const index = Number(event.detail.value);
    const child = this.data.children[index];
    this.setData({ childIndex: index, childId: child ? child.id : "" });
    if (child) wx.setStorageSync("familyEduSelectedChildId", child.id);
    this.loadData();
  },

  switchTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab });
  },

  async loadData() {
    const { childId } = this.data;
    if (!childId) {
      this.setData({ records: [], reports: [], growth: [], loading: false });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.mobileGrowth({ child_id: childId });
      this.setGrowthData(data);
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  openRecord(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.records.find((record) => record.id === id);
    if (!item) return;
    this.setData({ detail: item, detailType: "record" });
  },

  openReport(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.reports.find((report) => report.id === id);
    if (!item) return;
    this.setData({ detail: item, detailType: "report" });
  },

  closeDetail() {
    this.setData({ detail: null, detailType: "" });
  },

  noop() {}
});
