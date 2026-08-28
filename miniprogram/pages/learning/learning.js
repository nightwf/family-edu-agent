const api = require("../../utils/api");
const format = require("../../utils/format");

const SUBJECTS = ["数学", "语文", "英语", "科学", "地理", "物理", "化学", "其他"];
const WRONG_STATUSES = ["pending_correction", "strengthening", "mastered", "needs_review", "archived"];
const MASTERY_STATUSES = ["unassessed", "learning", "basic", "mastered", "needs_review"];
const TASK_STATUSES = ["pending", "in_progress", "completed", "skipped"];

function lines(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}：${typeof item === "string" ? item : JSON.stringify(item)}`).join("\n");
  return value ? String(value) : "";
}

function textValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function actionEvent(id) {
  return { currentTarget: { dataset: { id } } };
}

Page({
  data: {
    loading: false,
    error: "",
    module: "questions",
    qTab: "questions",
    wTab: "wrong",
    children: [],
    childNames: [],
    childIndex: 0,
    childId: "",
    subjectOptions: ["全部学科", ...SUBJECTS],
    subjectIndex: 0,
    subject: "",
    query: "",
    questions: [],
    questionTypes: [],
    masteries: [],
    wrongQuestions: [],
    papers: [],
    plans: [],
    textbooks: [],
    homework: [],
    knowledge: [],
    question: null,
    questionEdit: null,
    questionEditForm: {},
    questionType: null,
    typeFormVisible: false,
    typeEditingId: "",
    typeForm: {},
    masteryEdit: null,
    wrong: null,
    wrongEdit: null,
    wrongEditForm: {},
    wrongStatus: null,
    paper: null,
    plan: null,
    textbookFormVisible: false,
    textbookEditingId: "",
    textbookForm: {},
    textbookFile: "",
    homeworkFormVisible: false,
    homeworkEditingId: "",
    homeworkForm: {},
    knowledgeFormVisible: false,
    knowledgeForm: {},
    taskStatuses: TASK_STATUSES,
    wrongStatuses: WRONG_STATUSES,
    masteryStatuses: MASTERY_STATUSES,
    difficultyOptions: ["基础", "进阶", "迁移", "复习"],
    homeworkStatusOptions: ["pending", "in_progress", "done", "cancelled"],
    knowledgeKinds: ["summary", "report", "suggestion"],
    knowledgeKindLabels: {
      summary: "总结",
      report: "报告",
      suggestion: "建议"
    },
    masteryStatusLabels: {
      unassessed: "未评估",
      learning: "学习中",
      basic: "基本掌握",
      mastered: "已掌握",
      needs_review: "需复习"
    },
    wrongStatusLabels: {
      pending_correction: "待订正",
      strengthening: "巩固中",
      mastered: "已掌握",
      needs_review: "需复习",
      archived: "已归档"
    }
  },

  async onShow() {
    const requestedModule = wx.getStorageSync("familyEduLearningModule");
    if (["questions", "wrong", "textbooks", "homework", "knowledge"].includes(requestedModule)) {
      this.setData({ module: requestedModule });
      wx.removeStorageSync("familyEduLearningModule");
    }
    await this.loadChildren();
  },

  async loadChildren() {
    try {
      const children = await api.listChildren();
      const childId = children.length ? children[0].id : "";
      this.setData({
        children,
        childNames: children.map((child) => `${child.name} · ${child.grade}`),
        childId,
        childIndex: 0
      });
      await this.loadModule();
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  onChildChange(event) {
    const childIndex = Number(event.detail.value);
    const child = this.data.children[childIndex];
    this.setData({ childIndex, childId: child ? child.id : "" });
    this.loadModule();
  },

  onSubjectChange(event) {
    const subjectIndex = Number(event.detail.value);
    this.setData({
      subjectIndex,
      subject: subjectIndex === 0 ? "" : SUBJECTS[subjectIndex - 1]
    });
    this.loadModule();
  },

  onQuery(event) {
    this.setData({ query: event.detail.value });
  },

  onQuestionEditDifficulty(event) {
    const difficulty = ["basic", "advanced", "transfer", "review"][Number(event.detail.value)];
    this.setData({ "questionEditForm.difficulty": difficulty });
  },

  search() {
    this.loadModule();
  },

  switchModule(event) {
    const module = event.currentTarget.dataset.module;
    this.setData({ module, error: "" });
    this.loadModule();
  },

  switchQTab(event) {
    this.setData({ qTab: event.currentTarget.dataset.tab });
    this.loadQModule();
  },

  switchWTab(event) {
    this.setData({ wTab: event.currentTarget.dataset.tab });
    this.loadWModule();
  },

  async loadModule() {
    if (this.data.module === "questions") {
      await this.loadQModule();
    } else if (this.data.module === "wrong") {
      await this.loadWModule();
    } else if (this.data.module === "textbooks") {
      await this.loadTextbooks();
    } else if (this.data.module === "homework") {
      await this.loadHomework();
    } else if (this.data.module === "knowledge") {
      await this.loadKnowledge();
    }
  },

  async loadQModule() {
    if (this.data.qTab === "questions") await this.loadQuestions();
    if (this.data.qTab === "types") await this.loadQuestionTypes();
    if (this.data.qTab === "mastery") await this.loadMastery();
  },

  async loadWModule() {
    if (this.data.wTab === "wrong") await this.loadWrongQuestions();
    if (this.data.wTab === "papers") await this.loadPapers();
    if (this.data.wTab === "plans") await this.loadPlans();
  },

  async loadQuestions() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.listQuestions({
        child_id: this.data.childId,
        subject: this.data.subject,
        query: this.data.query,
        limit: 50
      });
      this.setData({
        questions: (data.items || []).map((item) => ({
          ...item,
          difficultyLabel: format.difficultyLabel(item.difficulty),
          questionTypeName: item.questionType ? item.questionType.name : "-",
          tagsText: format.joinTags(item.tags)
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async loadQuestionTypes() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.listQuestionTypes({
        subject: this.data.subject,
        query: this.data.query,
        limit: 50
      });
      this.setData({
        questionTypes: (data.items || []).map((item) => ({
          ...item,
          knowledgeText: format.joinTags(item.knowledgePoints),
          questionCount: item._count ? item._count.questions : 0,
          masteryCount: item._count ? item._count.masteries : 0
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async loadMastery() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.listMastery({
        child_id: this.data.childId,
        subject: this.data.subject,
        limit: 50
      });
      this.setData({
        masteries: (data.items || []).map((item) => ({
          ...item,
          statusLabel: format.masteryStatus(item.status),
          questionTypeName: item.questionType ? item.questionType.name : "-",
          childName: item.child ? item.child.name : "-",
          scorePercent: Math.min(100, Number(item.masteryScore || 0))
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async loadWrongQuestions() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.listWrongQuestions({
        child_id: this.data.childId,
        subject: this.data.subject,
        query: this.data.query,
        limit: 50
      });
      this.setData({
        wrongQuestions: (data.items || []).map((item) => ({
          ...item,
          statusLabel: format.wrongStatus(item.status),
          statusTone: format.wrongTone(item.status),
          childName: item.child ? item.child.name : "-",
          lastWrongAtText: format.formatDate(item.lastWrongAt),
          knowledgeText: format.joinTags(item.knowledgePoints),
          scorePercent: Math.min(100, Number(item.masteryScore || 0))
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async loadPapers() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.listPracticePapers({
        child_id: this.data.childId,
        subject: this.data.subject,
        limit: 50
      });
      this.setData({
        papers: (data.items || []).map((item) => ({
          ...item,
          statusLabel: format.paperStatus(item.status),
          childName: item.child ? item.child.name : "-",
          questionCount: item._count ? item._count.questions : 0,
          attemptCount: item._count ? item._count.attempts : 0
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async loadPlans() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.listRemediationPlans({
        child_id: this.data.childId,
        subject: this.data.subject,
        limit: 50
      });
      this.setData({
        plans: (data.items || []).map((item) => ({
          ...item,
          statusLabel: format.planStatus(item.status),
          childName: item.child ? item.child.name : "-",
          taskCount: item._count ? item._count.tasks : 0,
          startText: format.formatDate(item.startDate),
          endText: format.formatDate(item.endDate)
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async loadTextbooks() {
    this.setData({ loading: true, error: "" });
    try {
      const textbooks = await api.listTextbooks();
      this.setData({
        textbooks: (textbooks || []).map((item) => ({
          ...item,
          childName: format.childName(this.data.children, item.childId),
          statusLabel: item.status === "ready" ? "已就绪" : "识别中"
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async loadHomework() {
    this.setData({ loading: true, error: "" });
    try {
      const homework = await api.listHomework();
      this.setData({
        homework: (homework || []).map((item) => ({
          ...item,
          childName: format.childName(this.data.children, item.childId),
          statusLabel: format.homeworkStatus(item.status),
          statusTone: format.homeworkTone(item.status),
          dueText: format.formatDate(item.dueDate)
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async loadKnowledge() {
    this.setData({ loading: true, error: "" });
    try {
      const knowledge = await api.listKnowledge();
      this.setData({
        knowledge: (knowledge || []).map((item) => ({
          ...item,
          childName: format.childName(this.data.children, item.childId),
          dateText: format.formatDate(item.createdAt)
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  async openQuestion(event) {
    try {
      const question = await api.getQuestion(event.currentTarget.dataset.id);
      this.setData({
        question: {
          ...question,
          difficultyLabel: format.difficultyLabel(question.difficulty),
          questionTypeName: question.questionType ? question.questionType.name : "-",
          answerText: format.safeText(question.answer),
          solutionText: question.solution || "未填写解析",
          attempts: (question.attempts || []).map((attempt) => ({
            ...attempt,
            childName: attempt.child ? attempt.child.name : "-",
            dateText: format.formatDate(attempt.attemptedAt)
          }))
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  closeQuestion() {
    this.setData({ question: null });
  },

  openQuestionActions(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["编辑题目", "删除题目"],
      success: (res) => {
        if (res.tapIndex === 0) this.openQuestionEdit(actionEvent(id));
        if (res.tapIndex === 1) this.removeQuestion(actionEvent(id));
      }
    });
  },

  openQuestionEdit(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.questions.find((question) => question.id === id);
    if (!item) return;
    this.setData({
      questionEdit: item,
      questionEditForm: {
        stem: item.stem || "",
        solution: item.solution || "",
        answer: item.answer === null || item.answer === undefined ? "" : typeof item.answer === "string" ? item.answer : JSON.stringify(item.answer),
        difficulty: item.difficulty || "basic",
        variation_type: item.variationType || "original",
        tags: (item.tags || []).join("、")
      }
    });
  },

  closeQuestionEdit() {
    this.setData({ questionEdit: null, questionEditForm: {} });
  },

  onQuestionEditField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`questionEditForm.${field}`]: event.detail.value });
  },

  async submitQuestionEdit() {
    const { questionEdit, questionEditForm } = this.data;
    if (!questionEdit) return;
    try {
      await api.updateQuestion(questionEdit.id, {
        stem: questionEditForm.stem,
        solution: questionEditForm.solution,
        answer: questionEditForm.answer,
        difficulty: questionEditForm.difficulty,
        variation_type: questionEditForm.variation_type,
        tags: questionEditForm.tags.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
      });
      wx.showToast({ title: "已保存", icon: "success" });
      this.closeQuestionEdit();
      await this.loadQuestions();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  removeQuestion(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除题目",
      content: "已有作答、错题或试卷关联的题目会拒绝删除，可先停用。",
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteQuestion(id);
          await this.loadQuestions();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  async openQuestionType(event) {
    try {
      const type = await api.getQuestionType(event.currentTarget.dataset.id);
      this.setData({
        questionType: {
          ...type,
          knowledgeText: format.joinTags(type.knowledgePoints),
          solutionMethod: type.solutionMethod || "未填写",
          abilityGoal: type.abilityGoal || "未填写",
          generationRule: format.safeText(type.generationRule),
          answerValidation: format.safeText(type.answerValidation)
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  closeQuestionType() {
    this.setData({ questionType: null });
  },

  openTypeActions(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["编辑题型", "删除题型"],
      success: (res) => {
        if (res.tapIndex === 0) this.openTypeEdit(actionEvent(id));
        if (res.tapIndex === 1) this.removeType(actionEvent(id));
      }
    });
  },

  openTypeCreate() {
    this.setData({
      typeFormVisible: true,
      typeEditingId: "",
      typeForm: {
        subject: "数学",
        grade: "",
        name: "",
        description: "",
        knowledge_points: "",
        tags: "",
        ability_goal: "",
        solution_method: "",
        standard_steps: "",
        common_errors: "",
        invariants: "",
        variable_parameters: "",
        generation_rule: "",
        answer_validation: "",
        rule_version: "1.0.0",
        min_score: "80",
        min_attempts: "5",
        min_variations: "3"
      }
    });
  },

  openTypeEdit(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.questionTypes.find((type) => type.id === id);
    if (!item) return;
    const criteria = item.masteryCriteria || {};
    this.setData({
      typeFormVisible: true,
      typeEditingId: item.id,
      typeForm: {
        subject: item.subject || "",
        grade: item.grade || "",
        name: item.name || "",
        description: item.description || "",
        knowledge_points: (item.knowledgePoints || []).join("、"),
        tags: (item.tags || []).join("、"),
        ability_goal: item.abilityGoal || "",
        solution_method: item.solutionMethod || "",
        standard_steps: lines(item.standardSteps),
        common_errors: lines(item.commonErrors),
        invariants: lines(item.invariants),
        variable_parameters: lines(item.variableParameters),
        generation_rule: textValue(item.generationRule),
        answer_validation: textValue(item.answerValidation),
        rule_version: item.ruleVersion || "1.0.0",
        min_score: String(criteria.minScore || 80),
        min_attempts: String(criteria.minAttempts || 5),
        min_variations: String(criteria.minVariations || 3)
      }
    });
  },

  closeTypeForm() {
    this.setData({ typeFormVisible: false, typeEditingId: "" });
  },

  onTypeField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`typeForm.${field}`]: event.detail.value });
  },

  async submitType() {
    const { typeEditingId, typeForm } = this.data;
    if (!typeForm.name || !typeForm.subject) {
      wx.showToast({ title: "请填写学科和题型名称", icon: "none" });
      return;
    }
    const split = (value) => String(value || "").split(/\n|[,，、]/).map((item) => item.trim()).filter(Boolean);
    const payload = {
      subject: typeForm.subject,
      grade: typeForm.grade,
      name: typeForm.name,
      description: typeForm.description,
      knowledge_points: split(typeForm.knowledge_points),
      tags: split(typeForm.tags),
      ability_goal: typeForm.ability_goal,
      solution_method: typeForm.solution_method,
      standard_steps: split(typeForm.standard_steps),
      common_errors: split(typeForm.common_errors),
      invariants: split(typeForm.invariants),
      variable_parameters: split(typeForm.variable_parameters),
      generation_rule: typeForm.generation_rule,
      answer_validation: typeForm.answer_validation,
      rule_version: typeForm.rule_version,
      mastery_criteria: {
        minScore: Number(typeForm.min_score || 80),
        minAttempts: Number(typeForm.min_attempts || 5),
        minVariations: Number(typeForm.min_variations || 3)
      }
    };
    try {
      if (typeEditingId) {
        await api.updateQuestionType(typeEditingId, payload);
      } else {
        await api.createQuestionType(payload);
      }
      wx.showToast({ title: "已保存", icon: "success" });
      this.closeTypeForm();
      await this.loadQuestionTypes();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  removeType(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除题型",
      content: "有关联题目、错题或教学任务时会拒绝删除，请先停用。",
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteQuestionType(id);
          await this.loadQuestionTypes();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  openMasteryEdit(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.masteries.find((mastery) => mastery.id === id);
    if (!item) return;
    this.setData({ masteryEdit: item });
  },

  openMasteryActions(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["调整掌握度"],
      success: () => this.openMasteryEdit(actionEvent(id))
    });
  },

  closeMasteryEdit() {
    this.setData({ masteryEdit: null });
  },

  onMasteryStatus(event) {
    this.setData({ "masteryEdit.status": event.detail.value });
  },

  onMasteryReason(event) {
    this.setData({ "masteryEdit.manualReason": event.detail.value });
  },

  async submitMastery() {
    const item = this.data.masteryEdit;
    if (!item || !item.manualReason) {
      wx.showToast({ title: "请填写调整原因", icon: "none" });
      return;
    }
    try {
      await api.updateMastery(item.childId, item.questionTypeId, {
        status: item.status,
        reason: item.manualReason,
        source: "parent"
      });
      wx.showToast({ title: "已调整", icon: "success" });
      this.closeMasteryEdit();
      await this.loadMastery();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  async openWrong(event) {
    try {
      const wrong = await api.getWrongQuestion(event.currentTarget.dataset.id);
      this.setData({
        wrong: {
          ...wrong,
          statusLabel: format.wrongStatus(wrong.status),
          statusTone: format.wrongTone(wrong.status),
          lastWrongAtText: format.formatDate(wrong.lastWrongAt),
          nextReviewText: format.formatDate(wrong.nextReviewAt),
          answerText: format.safeText(wrong.question ? wrong.question.answer : ""),
          wrongAnswerText: format.safeText(wrong.latestWrongAnswer),
          evidence: wrong.masteryEvidence || {},
          attempts: (wrong.attempts || []).map((attempt) => ({
            ...attempt,
            dateText: format.formatDate(attempt.attemptedAt),
            resultLabel: attempt.isCorrect ? "答对" : "答错",
            variationText: attempt.isOriginalCorrection ? "原题订正" : attempt.variationType || "练习"
          }))
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  closeWrong() {
    this.setData({ wrong: null });
  },

  openWrongActions(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["编辑错题", "删除错题"],
      success: (res) => {
        if (res.tapIndex === 0) this.openWrongEdit(actionEvent(id));
        if (res.tapIndex === 1) this.removeWrong(actionEvent(id));
      }
    });
  },

  openWrongEdit(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.wrongQuestions.find((wrong) => wrong.id === id);
    if (!item) return;
    this.setData({
      wrongEdit: item,
      wrongEditForm: {
        chapter: item.chapter || "",
        knowledge_points: (item.knowledgePoints || []).join("、"),
        error_category: item.errorCategory || "",
        error_reason: item.errorReason || "",
        workbuddy_analysis: item.workbuddyAnalysis || "",
        correction_method: item.correctionMethod || "",
        key_learning_point: item.keyLearningPoint || ""
      }
    });
  },

  closeWrongEdit() {
    this.setData({ wrongEdit: null, wrongEditForm: {} });
  },

  onWrongEditField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`wrongEditForm.${field}`]: event.detail.value });
  },

  async submitWrongEdit() {
    const { wrongEdit, wrongEditForm } = this.data;
    if (!wrongEdit) return;
    try {
      await api.updateWrongQuestion(wrongEdit.id, {
        ...wrongEditForm,
        knowledge_points: wrongEditForm.knowledge_points.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
      });
      wx.showToast({ title: "已保存", icon: "success" });
      this.closeWrongEdit();
      await this.loadWrongQuestions();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  openWrongStatus(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.wrongQuestions.find((wrong) => wrong.id === id);
    if (!item) return;
    this.setData({
      wrongStatus: {
        ...item,
        status: item.status,
        reason: ""
      }
    });
  },

  closeWrongStatus() {
    this.setData({ wrongStatus: null });
  },

  onWrongStatusChange(event) {
    this.setData({ "wrongStatus.status": event.detail.value });
  },

  onWrongStatusReason(event) {
    this.setData({ "wrongStatus.reason": event.detail.value });
  },

  async submitWrongStatus() {
    const item = this.data.wrongStatus;
    if (!item || !item.reason) {
      wx.showToast({ title: "请填写调整原因", icon: "none" });
      return;
    }
    try {
      await api.updateWrongQuestionStatus(item.id, { status: item.status, reason: item.reason, source: "parent" });
      wx.showToast({ title: "已调整", icon: "success" });
      this.closeWrongStatus();
      await this.loadWrongQuestions();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  removeWrong(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除错题",
      content: "有关联练习证据时会自动归档，不影响题库原题。",
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteWrongQuestion(id);
          await this.loadWrongQuestions();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  async openPaper(event) {
    try {
      const paper = await api.getPracticePaper(event.currentTarget.dataset.id);
      this.setData({
        paper: {
          ...paper,
          statusLabel: format.paperStatus(paper.status),
          childName: paper.child ? paper.child.name : "-",
          questions: (paper.questions || []).map((item) => ({
            ...item,
            answerText: format.safeText(item.question ? item.question.answer : ""),
            solution: item.question ? item.question.solution || "未填写解析" : ""
          }))
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  closePaper() {
    this.setData({ paper: null });
  },

  openPaperActions(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["删除试卷"],
      success: () => this.removePaper(actionEvent(id))
    });
  },

  removePaper(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除试卷",
      content: "已有作答时会自动归档。",
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deletePracticePaper(id);
          await this.loadPapers();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  async openPlan(event) {
    try {
      const plan = await api.getRemediationPlan(event.currentTarget.dataset.id);
      this.setData({
        plan: {
          ...plan,
          statusLabel: format.planStatus(plan.status),
          childName: plan.child ? plan.child.name : "-",
          startText: format.formatDate(plan.startDate),
          endText: format.formatDate(plan.endDate),
          diagnosisText: format.safeText(plan.diagnosis),
          strategy: plan.strategy || "未填写",
          tasks: (plan.tasks || []).map((task) => ({
            ...task,
            statusLabel: format.taskStatus(task.status),
            dueText: format.formatDate(task.dueAt)
          }))
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  closePlan() {
    this.setData({ plan: null });
  },

  openPlanActions(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["删除教学规划"],
      success: () => this.removePlan(actionEvent(id))
    });
  },

  onTaskStatusChange(event) {
    const planId = event.currentTarget.dataset.planId;
    const taskId = event.currentTarget.dataset.taskId;
    const status = event.detail.value;
    api.updateRemediationTaskStatus(planId, taskId, {
      status,
      completion_evidence: { source: "miniprogram", updated_at: new Date().toISOString() }
    }).then(async () => {
      wx.showToast({ title: "任务已更新", icon: "success" });
      await this.openPlan({ currentTarget: { dataset: { id: planId } } });
      await this.loadPlans();
    }).catch((error) => wx.showToast({ title: error.message, icon: "none" }));
  },

  removePlan(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除教学规划",
      content: "有完成证据时会自动归档。",
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteRemediationPlan(id);
          await this.loadPlans();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  openTextbookCreate() {
    this.setData({
      textbookFormVisible: true,
      textbookEditingId: "",
      textbookForm: { child_id: this.data.childId, title: "", subject: "", grade: "", publisher: "", version: "" },
      textbookFile: ""
    });
  },

  openTextbookActions(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["编辑教材", "删除教材"],
      success: (res) => {
        if (res.tapIndex === 0) this.openTextbookEdit(actionEvent(id));
        if (res.tapIndex === 1) this.removeTextbook(actionEvent(id));
      }
    });
  },

  openTextbookEdit(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.textbooks.find((textbook) => textbook.id === id);
    if (!item) return;
    this.setData({
      textbookFormVisible: true,
      textbookEditingId: item.id,
      textbookForm: {
        child_id: item.childId,
        title: item.title || "",
        subject: item.subject || "",
        grade: item.grade || "",
        publisher: item.publisher || "",
        version: item.version || ""
      },
      textbookFile: ""
    });
  },

  closeTextbookForm() {
    this.setData({ textbookFormVisible: false, textbookEditingId: "" });
  },

  onTextbookField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`textbookForm.${field}`]: event.detail.value });
  },

  onTextbookChildChange(event) {
    const child = this.data.children[Number(event.detail.value)];
    this.setData({ "textbookForm.child_id": child ? child.id : "" });
  },

  chooseTextbookFile() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["pdf", "png", "jpg", "jpeg", "webp", "gif", "doc", "docx"],
      success: (res) => {
        if (res.tempFiles && res.tempFiles.length) {
          this.setData({ textbookFile: res.tempFiles[0].path });
        }
      }
    });
  },

  async submitTextbook() {
    const { textbookEditingId, textbookForm, textbookFile } = this.data;
    if (!textbookForm.child_id || !textbookForm.title) {
      wx.showToast({ title: "请选择孩子并填写教材名", icon: "none" });
      return;
    }
    try {
      if (textbookFile) {
        await api.uploadTextbook({
          filePath: textbookFile,
          formData: textbookForm
        });
      } else if (textbookEditingId) {
        await api.updateTextbook(textbookEditingId, textbookForm);
      } else {
        await api.createTextbook(textbookForm);
      }
      wx.showToast({ title: "已保存", icon: "success" });
      this.closeTextbookForm();
      await this.loadTextbooks();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  removeTextbook(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除教材",
      content: "确定删除这本教材吗？",
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteTextbook(id);
          await this.loadTextbooks();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  openHomeworkCreate() {
    this.setData({
      homeworkFormVisible: true,
      homeworkEditingId: "",
      homeworkForm: { child_id: this.data.childId, subject: "", title: "", description: "", estimated_minutes: "", priority: "medium", due_date: "", status: "pending" }
    });
  },

  openHomeworkActions(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.homework.find((homework) => homework.id === id);
    const itemList = item && item.status !== "done" ? ["标记完成", "编辑作业", "删除作业"] : ["编辑作业", "删除作业"];
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const offset = itemList.length === 3 ? 0 : 1;
        if (res.tapIndex === 0 && offset === 0) this.completeHomework(actionEvent(id));
        if (res.tapIndex === 1 - offset) this.openHomeworkEdit(actionEvent(id));
        if (res.tapIndex === 2 - offset) this.removeHomework(actionEvent(id));
      }
    });
  },

  openHomeworkEdit(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.homework.find((homework) => homework.id === id);
    if (!item) return;
    this.setData({
      homeworkFormVisible: true,
      homeworkEditingId: item.id,
      homeworkForm: {
        child_id: item.childId,
        subject: item.subject || "",
        title: item.title || "",
        description: item.description || "",
        estimated_minutes: item.estimatedMinutes === null || item.estimatedMinutes === undefined ? "" : String(item.estimatedMinutes),
        priority: item.priority || "medium",
        due_date: item.dueDate ? item.dueDate.slice(0, 10) : "",
        status: item.status || "pending"
      }
    });
  },

  closeHomeworkForm() {
    this.setData({ homeworkFormVisible: false, homeworkEditingId: "" });
  },

  onHomeworkField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`homeworkForm.${field}`]: event.detail.value });
  },

  onHomeworkChildChange(event) {
    const child = this.data.children[Number(event.detail.value)];
    this.setData({ "homeworkForm.child_id": child ? child.id : "" });
  },

  onHomeworkStatusChange(event) {
    this.setData({ "homeworkForm.status": event.detail.value });
  },

  async submitHomework() {
    const { homeworkEditingId, homeworkForm } = this.data;
    if (!homeworkForm.child_id || !homeworkForm.title) {
      wx.showToast({ title: "请选择孩子并填写作业名", icon: "none" });
      return;
    }
    const payload = {
      ...homeworkForm,
      estimated_minutes: Number(homeworkForm.estimated_minutes || 0),
      due_date: homeworkForm.due_date || undefined
    };
    try {
      if (homeworkEditingId) {
        await api.updateHomework(homeworkEditingId, payload);
      } else {
        await api.createHomework(payload);
      }
      wx.showToast({ title: "已保存", icon: "success" });
      this.closeHomeworkForm();
      await this.loadHomework();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  completeHomework(event) {
    const id = event.currentTarget.dataset.id;
    api.completeHomework(id).then(async () => {
      wx.showToast({ title: "已完成", icon: "success" });
      await this.loadHomework();
    }).catch((error) => wx.showToast({ title: error.message, icon: "none" }));
  },

  removeHomework(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除作业",
      content: "确定删除这条作业吗？",
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteHomework(id);
          await this.loadHomework();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  openKnowledgeCreate() {
    this.setData({
      knowledgeFormVisible: true,
      knowledgeForm: { child_id: this.data.childId, kind: "summary", title: "", content: "" }
    });
  },

  closeKnowledgeForm() {
    this.setData({ knowledgeFormVisible: false });
  },

  openKnowledgeActions(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["删除内容"],
      success: () => this.removeKnowledge(actionEvent(id))
    });
  },

  onKnowledgeField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`knowledgeForm.${field}`]: event.detail.value });
  },

  onKnowledgeChildChange(event) {
    const child = this.data.children[Number(event.detail.value)];
    this.setData({ "knowledgeForm.child_id": child ? child.id : "" });
  },

  onKnowledgeKindChange(event) {
    this.setData({ "knowledgeForm.kind": event.detail.value });
  },

  async submitKnowledge() {
    const { knowledgeForm } = this.data;
    if (!knowledgeForm.child_id || !knowledgeForm.title || !knowledgeForm.content) {
      wx.showToast({ title: "请填写完整知识库内容", icon: "none" });
      return;
    }
    try {
      await api.createKnowledge(knowledgeForm);
      wx.showToast({ title: "已保存", icon: "success" });
      this.closeKnowledgeForm();
      await this.loadKnowledge();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  removeKnowledge(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除内容",
      content: "确定删除这条知识库内容吗？",
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteKnowledge(id);
          await this.loadKnowledge();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  },

  noop() {}
});
