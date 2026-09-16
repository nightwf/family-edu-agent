const api = require("../../utils/api");
const format = require("../../utils/format");

const TYPE_LABELS = {
  writing: "写作",
  reading: "阅读",
  homework: "作业",
  parent_note: "家长备注"
};

const PAGE_SIZE = 20;

Page({
  data: {
    loading: true,
    loadingMore: false,
    error: "",
    children: [],
    childNames: [],
    childIndex: 0,
    childId: "",
    tab: "records",
    records: [],
    reports: [],
    growth: [],
    totalRecords: 0,
    totalReports: 0,
    recordsHasMore: false,
    reportsHasMore: false,
    pageSize: PAGE_SIZE,
    detail: null,
    detailType: ""
  },

  onReachBottom() {
    this.loadMore();
  },

  async onShow() {
    await this.loadChildren();
  },

  async loadChildren() {
    try {
      const savedChildId = wx.getStorageSync("familyEduSelectedChildId");
      const data = await api.mobileGrowth({ child_id: savedChildId, limit: PAGE_SIZE, offset: 0 });
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

  setGrowthData(data, extra = {}, append = false) {
    const nextRecords = (data.records || []).map((item) => ({
      ...item,
      dateText: format.formatDate(item.date),
      typeLabel: TYPE_LABELS[item.type] || item.type || "记录"
    }));
    const nextReports = (data.reports || []).map((item) => ({
      ...item,
      dateText: format.formatDate(item.createdAt),
      typeLabel: item.type === "weekly" ? "周报" : "月报"
    }));
    // 接口对成长记录和报告使用同一个 offset：一次请求会同时返回两者，
    // 追加时只能合并当前页签的那一份，否则切换页签会出现重复条目。
    const appendedTab = append ? this.data.tab : "";
    const records = appendedTab === "records"
      ? [...this.data.records, ...nextRecords]
      : append ? this.data.records : nextRecords;
    const reports = appendedTab === "reports"
      ? [...this.data.reports, ...nextReports]
      : append ? this.data.reports : nextReports;
    const page = data.page || {};
    const totalRecords = typeof page.total_records === "number" ? page.total_records : records.length;
    const totalReports = typeof page.total_reports === "number" ? page.total_reports : reports.length;
    this.setData({
      ...extra,
      records,
      reports,
      totalRecords,
      totalReports,
      recordsHasMore: records.length < totalRecords,
      reportsHasMore: reports.length < totalReports,
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
      this.setData({ records: [], reports: [], growth: [], totalRecords: 0, totalReports: 0, loading: false });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.mobileGrowth({ child_id: childId, limit: PAGE_SIZE, offset: 0 });
      this.setGrowthData(data);
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async loadMore() {
    const { tab, childId, loading, loadingMore } = this.data;
    if (!childId || loading || loadingMore) return;
    if (tab === "growth") return;
    const loaded = tab === "records" ? this.data.records.length : this.data.reports.length;
    const total = tab === "records" ? this.data.totalRecords : this.data.totalReports;
    if (!total || loaded >= total) return;
    this.setData({ loadingMore: true });
    try {
      const data = await api.mobileGrowth({ child_id: childId, limit: PAGE_SIZE, offset: loaded });
      this.setGrowthData(data, {}, true);
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ loadingMore: false });
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
