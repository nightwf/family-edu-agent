const api = require("../../utils/api");
const format = require("../../utils/format");

function shortText(value, fallback) {
  if (!value) return fallback || "";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return fallback || "";
  return text.length > 56 ? `${text.slice(0, 56)}...` : text;
}

function activityTypeLabel(type) {
  const labels = {
    writing: "写作",
    reading: "阅读",
    homework: "作业",
    parent_note: "家长记录",
    report: "报告"
  };
  return labels[type] || type || "成长";
}

function activityTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return format.formatDate(value);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startToday - startDate) / 86400000);
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (diffDays === 0) return `今天 ${clock}`;
  if (diffDays === 1) return `昨天 ${clock}`;
  return format.formatDate(value);
}

function buildState(child, records, reports, pendingTasks) {
  if (!child) {
    return {
      title: "先建立一个孩子档案",
      summary: "添加学生后，WorkBuddy 同步的作业、报告和成长记录会在首页集中展示。"
    };
  }
  const latestReport = reports[0];
  const latestRecord = records[0];
  if (latestReport && latestReport.summary) {
    return {
      title: `${child.name} 的最新报告已同步`,
      summary: shortText(latestReport.summary, "可以进入成长页查看完整报告。")
    };
  }
  if (pendingTasks.length) {
    return {
      title: `${child.name} 还有 ${pendingTasks.length} 项任务待完成`,
      summary: "建议先处理截止时间更近的任务，完成后由 WorkBuddy 同步完成情况。"
    };
  }
  if (latestRecord) {
    return {
      title: `${child.name} 最近有新的成长记录`,
      summary: shortText(latestRecord.notes || latestRecord.content, "可以进入成长页查看这条记录的完整内容。")
    };
  }
  return {
    title: `${child.name} 的学习档案已准备好`,
    summary: "还没有同步成长动态。和 WorkBuddy 对话并明确要求保存后，会自动进入这里。"
  };
}

function taskIcon(subject) {
  const text = subject || "任";
  return text.slice(0, 1);
}

Page({
  data: {
    loading: true,
    error: "",
    user: null,
    family: null,
    children: [],
    childNames: [],
    childIndex: 0,
    activeChild: null,
    focusText: "",
    todayText: "",
    stateTitle: "",
    stateSummary: "",
    activeGoal: null,
    relationship: null,
    currentStats: [],
    pendingTasks: [],
    activityItems: []
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const storedChildId = wx.getStorageSync("familyEduSelectedChildId");
      const home = await api.mobileHome({ child_id: storedChildId });
      const children = (home.children || []).map((child) => ({
        ...child,
        initial: (child.name || "孩").slice(0, 1),
        subjectsText: (child.subjects || []).join("、") || "未设置"
      }));
      const activeChildId = home.active_child ? home.active_child.id : storedChildId;
      const childIndex = Math.max(0, children.findIndex((child) => child.id === activeChildId));
      const activeChild = children[childIndex] || children[0] || null;
      const records = home.records || [];
      const reports = home.reports || [];
      const pendingTasks = (home.homework || [])
        .filter((item) => (!activeChild || item.childId === activeChild.id) && !["done", "cancelled"].includes(item.status || "pending"))
        .slice(0, 3)
        .map((item, index) => ({
          ...item,
          icon: taskIcon(item.subject),
          tone: index % 2 === 0 ? "gold" : "coral",
          statusText: format.homeworkStatus(item.status),
          dueText: item.dueDate ? `${format.formatDate(item.dueDate)} 前` : "未设置截止时间",
          sourceText: item.source === "workbuddy" ? "来自 WorkBuddy" : item.source || "手动记录"
        }));
      let state = buildState(activeChild, records || [], reports || [], pendingTasks);
      let activeGoal = null;
      if (activeChild) {
        try {
          const [childState, goalsData, relationship] = await Promise.all([
            api.childState(activeChild.id),
            api.listStageGoals(activeChild.id, { status: "ACTIVE" }),
            api.childRelationship(activeChild.id)
          ]);
          const goalItems = (goalsData && goalsData.items) || [];
          activeGoal = goalItems.find((item) => item.status === "ACTIVE") || goalItems[0] || null;
          this.setData({ relationship: relationship || null });
          if (childState && childState.summary) {
            const summary = childState.summary;
            if (!records.length && !reports.length && !pendingTasks.length) {
              state = {
                title: `${activeChild.name} 的当前状态已生成`,
                summary: `近 7 天 ${summary.evidence_7d || 0} 条证据，待确认 ${summary.pending_confirmation || 0} 条。`
              };
            }
          }
        } catch (_error) {
          // V2 状态不可用时继续使用旧首页数据，不影响基础展示。
        }
      }
      const scoredRecords = (records || []).filter((item) => typeof item.score === "number");
      const latestScore = scoredRecords.length ? `${scoredRecords[0].score}` : "-";
      const recentRecordCount = (records || []).filter((item) => {
        const date = new Date(item.date || item.createdAt);
        return !Number.isNaN(date.getTime()) && Date.now() - date.getTime() <= 7 * 86400000;
      }).length;
      const activityItems = [
        ...(records || []).map((item) => ({
          id: item.id,
          sortTime: new Date(item.date || item.createdAt).getTime() || 0,
          type: activityTypeLabel(item.type),
          timeText: activityTime(item.date || item.createdAt),
          title: item.title || "成长记录",
          text: shortText(item.notes || item.content, "这条记录暂无补充说明")
        })),
        ...(reports || []).map((item) => ({
          id: item.id,
          sortTime: new Date(item.createdAt).getTime() || 0,
          type: item.type === "monthly" ? "月报" : "周报",
          timeText: activityTime(item.createdAt),
          title: item.title || "成长报告",
          text: shortText(item.summary || item.content, "报告已同步，可以进入成长页查看")
        }))
      ]
        .sort((a, b) => b.sortTime - a.sortTime)
        .slice(0, 3);
      this.setData({
        user: home.user,
        family: home.family,
        children,
        childNames: children.map((child) => `${child.name} · ${child.grade || "未设置年级"}`),
        childIndex,
        activeChild,
        focusText: activeChild ? `今天重点看 ${activeChild.name} 的学习变化` : "先建立孩子档案",
        todayText: format.formatDate(new Date()),
        stateTitle: state.title,
        stateSummary: state.summary,
        activeGoal,
        currentStats: [
          { value: `${recentRecordCount}`, label: "7天新动态" },
          { value: `${pendingTasks.length}`, label: "待完成任务" },
          { value: latestScore, label: "最近评分" }
        ],
        pendingTasks,
        activityItems,
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

  goStudents() {
    wx.switchTab({ url: "/pages/students/students" });
  },

  goGrowth() {
    wx.switchTab({ url: "/pages/growth/growth" });
  },

  goChildGrowth(event) {
    const childId = event.currentTarget.dataset.id;
    if (childId) wx.setStorageSync("familyEduSelectedChildId", childId);
    wx.switchTab({ url: "/pages/growth/growth" });
  },

  goLearning() {
    wx.setStorageSync("familyEduLearningModule", "questions");
    wx.switchTab({ url: "/pages/learning/learning" });
  },

  goHomework() {
    wx.setStorageSync("familyEduLearningModule", "homework");
    wx.switchTab({ url: "/pages/learning/learning" });
  },

  goSettings() {
    wx.switchTab({ url: "/pages/settings/settings" });
  }
});
