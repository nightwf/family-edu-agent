const { request, uploadFile } = require("./request");

function qs(params) {
  return Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
}

const api = {
  health: () => request({ url: "/api/health", auth: false, retry: 3 }),
  login: (data) => request({ url: "/api/auth/login", method: "POST", data, auth: false }),
  register: (data) => request({ url: "/api/auth/register", method: "POST", data, auth: false }),
  wechatLogin: (data) => request({ url: "/api/auth/wechat/login", method: "POST", data, auth: false }),
  wechatBind: (data) => request({ url: "/api/auth/wechat/bind", method: "POST", data, auth: false }),
  bindCurrentWechat: (data) => request({ url: "/api/auth/wechat/bind-current", method: "POST", data }),
  logout: () => request({ url: "/api/auth/logout", method: "POST" }),
  me: () => request({ url: "/api/auth/me" }),
  home: () => request({ url: "/api/home" }),
  mobileHome: (params) => request({ url: `/api/mobile/home?${qs(params)}` }),
  mobileGrowth: (params) => request({ url: `/api/mobile/growth?${qs(params)}` }),
  mobileLearning: (params) => request({ url: `/api/mobile/learning?${qs({ limit: 20, ...(params || {}) })}` }),
  settings: () => request({ url: "/api/settings" }),
  familyMembers: () => request({ url: "/api/family/members" }),
  createFamilyInvite: (data) => request({ url: "/api/family/invites", method: "POST", data }),
  acceptFamilyInvite: (data) => request({ url: "/api/family/invites/accept", method: "POST", data }),
  cancelFamilyInvite: (id) => request({ url: `/api/family/invites/${id}`, method: "DELETE" }),
  removeFamilyMember: (id) => request({ url: `/api/family/members/${id}`, method: "DELETE" }),

  listChildren: () => request({ url: "/api/children" }),
  createChild: (data) => request({ url: "/api/children", method: "POST", data }),
  updateChild: (id, data) => request({ url: `/api/children/${id}`, method: "PATCH", data }),
  deleteChild: (id) => request({ url: `/api/children/${id}`, method: "DELETE" }),

  childRecords: (childId) => request({ url: `/api/children/${childId}/records` }),
  childReports: (childId) => request({ url: `/api/children/${childId}/reports` }),
  childGrowth: (childId) => request({ url: `/api/children/${childId}/growth` }),

  listQuestions: (params) => request({ url: `/api/questions?${qs(params)}` }),
  getQuestion: (id) => request({ url: `/api/questions/${id}` }),
  updateQuestion: (id, data) => request({ url: `/api/questions/${id}`, method: "PATCH", data }),
  deleteQuestion: (id) => request({ url: `/api/questions/${id}`, method: "DELETE" }),
  listQuestionTypes: (params) => request({ url: `/api/question-types?${qs(params)}` }),
  getQuestionType: (id) => request({ url: `/api/question-types/${id}` }),
  createQuestionType: (data) => request({ url: "/api/question-types", method: "POST", data }),
  updateQuestionType: (id, data) => request({ url: `/api/question-types/${id}`, method: "PATCH", data }),
  deleteQuestionType: (id) => request({ url: `/api/question-types/${id}`, method: "DELETE" }),
  listMastery: (params) => request({ url: `/api/mastery?${qs(params)}` }),
  updateMastery: (childId, typeId, data) => request({ url: `/api/mastery/${childId}/${typeId}`, method: "PATCH", data }),

  listWrongQuestions: (params) => request({ url: `/api/wrong-questions?${qs(params)}` }),
  getWrongQuestion: (id) => request({ url: `/api/wrong-questions/${id}` }),
  updateWrongQuestion: (id, data) => request({ url: `/api/wrong-questions/${id}`, method: "PATCH", data }),
  updateWrongQuestionStatus: (id, data) => request({ url: `/api/wrong-questions/${id}/status`, method: "PATCH", data }),
  deleteWrongQuestion: (id) => request({ url: `/api/wrong-questions/${id}`, method: "DELETE" }),
  listPracticePapers: (params) => request({ url: `/api/practice-papers?${qs(params)}` }),
  getPracticePaper: (id) => request({ url: `/api/practice-papers/${id}` }),
  deletePracticePaper: (id) => request({ url: `/api/practice-papers/${id}`, method: "DELETE" }),
  listRemediationPlans: (params) => request({ url: `/api/remediation-plans?${qs(params)}` }),
  getRemediationPlan: (id) => request({ url: `/api/remediation-plans/${id}` }),
  updateRemediationTaskStatus: (planId, taskId, data) => request({ url: `/api/remediation-plans/${planId}/tasks/${taskId}/status`, method: "PATCH", data }),
  deleteRemediationPlan: (id) => request({ url: `/api/remediation-plans/${id}`, method: "DELETE" }),

  listTextbooks: () => request({ url: "/api/textbooks" }),
  createTextbook: (data) => request({ url: "/api/textbooks", method: "POST", data }),
  updateTextbook: (id, data) => request({ url: `/api/textbooks/${id}`, method: "PATCH", data }),
  deleteTextbook: (id) => request({ url: `/api/textbooks/${id}`, method: "DELETE" }),
  uploadTextbook: (options) => uploadFile({ url: "/api/textbooks/upload", ...options }),

  listHomework: () => request({ url: "/api/homework" }),
  createHomework: (data) => request({ url: "/api/homework", method: "POST", data }),
  updateHomework: (id, data) => request({ url: `/api/homework/${id}`, method: "PATCH", data }),
  completeHomework: (id) => request({ url: `/api/homework/${id}/complete`, method: "POST" }),
  deleteHomework: (id) => request({ url: `/api/homework/${id}`, method: "DELETE" }),

  listKnowledge: () => request({ url: "/api/knowledge" }),
  createKnowledge: (data) => request({ url: "/api/knowledge", method: "POST", data }),
  deleteKnowledge: (id) => request({ url: `/api/knowledge/${id}`, method: "DELETE" }),

  getEducationSettings: () => request({ url: "/api/education-settings" }),
  updateEducationSettings: (data) => request({ url: "/api/education-settings", method: "PATCH", data }),
  educationMethods: () => request({ url: "/api/education-methods" }),
  policyChanges: () => request({ url: "/api/policy-changes" }),
  reviewPolicyChange: (id, data) => request({ url: `/api/policy-changes/${id}/review`, method: "POST", data })
};

module.exports = api;
