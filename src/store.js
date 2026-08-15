import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DB_FILE, DATA_DIR, UPLOAD_DIR, INVITE_CODES, DEMO_EMAIL, DEMO_PASSWORD } from "./config.js";

function defaultDB() {
  return {
    users: [],
    families: [],
    children: [],
    records: [],
    reports: [],
    textbooks: [],
    tasks: [],
    knowledge: [],
    sessions: [],
  };
}

let cache = null;

export function readDB() {
  if (cache) return cache;
  if (!fs.existsSync(DB_FILE)) {
    cache = defaultDB();
    saveDB();
  } else {
    cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  }
  for (const collection of ["users", "families", "children", "records", "reports", "textbooks", "tasks", "knowledge", "sessions"]) {
    if (!Array.isArray(cache[collection])) cache[collection] = [];
  }
  return cache;
}

export function saveDB() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

export function findUserByEmail(email) {
  const db = readDB();
  const normalized = String(email || "").trim().toLowerCase();
  return db.users.find((user) => user.email === normalized) || null;
}

export function findUserById(userId) {
  const db = readDB();
  return db.users.find((user) => user.id === userId) || null;
}

export function getFamily(familyId) {
  const db = readDB();
  return db.families.find((family) => family.id === familyId) || null;
}

export function registerFamily({ email, password, inviteCode }) {
  const db = readDB();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const code = String(inviteCode || "").trim();

  if (!INVITE_CODES.has(code)) {
    const error = new Error("邀请码无效");
    error.status = 400;
    throw error;
  }
  if (!normalizedEmail || !password || password.length < 6) {
    const error = new Error("请填写有效邮箱和至少 6 位密码");
    error.status = 400;
    throw error;
  }
  if (findUserByEmail(normalizedEmail)) {
    const error = new Error("该邮箱已注册");
    error.status = 409;
    throw error;
  }

  const family = {
    id: uid("family"),
    name: "我的家庭",
    invite_code: code,
    created_at: nowIso(),
  };
  db.families.push(family);

  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: uid("user"),
    family_id: family.id,
    email: normalizedEmail,
    password_hash: hashPassword(password, salt),
    salt,
    created_at: nowIso(),
  };
  db.users.push(user);
  saveDB();
  return { user, family };
}

export function verifyPassword(user, password) {
  return user.password_hash === hashPassword(password, user.salt);
}

export function createSession(userId) {
  const db = readDB();
  const token = crypto.randomBytes(24).toString("hex");
  const session = {
    token,
    user_id: userId,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  db.sessions.push(session);
  saveDB();
  return token;
}

export function getUserByToken(token) {
  if (!token) return null;
  const db = readDB();
  const session = db.sessions.find((item) => item.token === token && new Date(item.expires_at) > new Date());
  if (!session) return null;
  return findUserById(session.user_id);
}

export function deleteSession(token) {
  const db = readDB();
  db.sessions = db.sessions.filter((item) => item.token !== token);
  saveDB();
}

export function listChildren(familyId) {
  return readDB().children
    .filter((child) => child.family_id === familyId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function createChild(familyId, input) {
  const db = readDB();
  const child = {
    id: uid("child"),
    family_id: familyId,
    name: String(input.name || "").trim(),
    age: Number(input.age || 0),
    grade: String(input.grade || "").trim(),
    subjects: Array.isArray(input.subjects) ? input.subjects : String(input.subjects || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    textbook_version: String(input.textbook_version || "").trim(),
    created_at: nowIso(),
  };
  if (!child.name || !child.grade) {
    const error = new Error("孩子姓名和年级必填");
    error.status = 400;
    throw error;
  }
  db.children.push(child);
  saveDB();
  return child;
}

export function updateChild(childId, input) {
  const db = readDB();
  const child = db.children.find((item) => item.id === childId);
  if (!child) return null;
  if (input.name !== undefined) child.name = String(input.name).trim();
  if (input.age !== undefined) child.age = Number(input.age);
  if (input.grade !== undefined) child.grade = String(input.grade).trim();
  if (input.subjects !== undefined) child.subjects = Array.isArray(input.subjects) ? input.subjects : String(input.subjects).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  if (input.textbook_version !== undefined) child.textbook_version = String(input.textbook_version).trim();
  saveDB();
  return child;
}

export function deleteChild(childId) {
  const db = readDB();
  db.children = db.children.filter((item) => item.id !== childId);
  db.records = db.records.filter((item) => item.child_id !== childId);
  db.reports = db.reports.filter((item) => item.child_id !== childId);
  db.textbooks = db.textbooks.filter((item) => item.child_id !== childId);
  saveDB();
}

export function createRecord(input) {
  const db = readDB();
  const record = {
    id: uid("record"),
    child_id: String(input.child_id),
    family_id: String(input.family_id || ""),
    type: String(input.type || "writing"),
    date: String(input.date || nowIso().slice(0, 10)),
    title: String(input.title || "成长记录"),
    score: Number(input.score || 0),
    notes: String(input.notes || ""),
    metadata: input.metadata || {},
    created_at: nowIso(),
  };
  db.records.push(record);
  saveDB();
  return record;
}

export function listRecords(childId) {
  return readDB().records
    .filter((item) => item.child_id === childId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function listTextbooks(familyId) {
  return readDB().textbooks
    .filter((item) => item.family_id === familyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createKnowledgeItem(input) {
  const db = readDB();
  const item = {
    id: uid("knowledge"),
    family_id: String(input.family_id || ""),
    child_id: String(input.child_id || ""),
    kind: String(input.kind || "summary"),
    title: String(input.title || "未命名总结"),
    content: String(input.content || ""),
    source: String(input.source || "workbuddy"),
    created_at: nowIso(),
  };
  db.knowledge.push(item);
  saveDB();
  return item;
}

export function listKnowledgeItems(familyId) {
  return readDB().knowledge
    .filter((item) => item.family_id === familyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function deleteKnowledgeItem(itemId) {
  const db = readDB();
  db.knowledge = db.knowledge.filter((item) => item.id !== itemId);
  saveDB();
}

export function getTextbook(textbookId) {
  return readDB().textbooks.find((item) => item.id === textbookId) || null;
}

export function createTextbook(input) {
  const db = readDB();
  const textbook = {
    id: uid("textbook"),
    family_id: String(input.family_id || ""),
    child_id: String(input.child_id || ""),
    title: String(input.title || "未命名教材"),
    subject: String(input.subject || ""),
    grade: input.grade === undefined ? "" : String(input.grade),
    publisher: String(input.publisher || ""),
    version: String(input.version || ""),
    source: String(input.source || "workbuddy_upload"),
    file: String(input.file || ""),
    chapters: Array.isArray(input.chapters) ? input.chapters : [],
    knowledge_points: Array.isArray(input.knowledge_points) ? input.knowledge_points : [],
    status: String(input.status || "ready"),
    created_at: nowIso(),
  };
  db.textbooks.push(textbook);
  saveDB();
  return textbook;
}

export function updateTextbook(textbookId, input) {
  const db = readDB();
  const textbook = db.textbooks.find((item) => item.id === textbookId);
  if (!textbook) return null;
  for (const key of ["title", "subject", "grade", "publisher", "version", "status"]) {
    if (input[key] !== undefined) textbook[key] = String(input[key]);
  }
  if (input.chapters !== undefined) textbook.chapters = input.chapters;
  if (input.knowledge_points !== undefined) textbook.knowledge_points = input.knowledge_points;
  if (input.child_id !== undefined) textbook.child_id = String(input.child_id);
  saveDB();
  return textbook;
}

export function deleteTextbook(textbookId) {
  const db = readDB();
  db.textbooks = db.textbooks.filter((item) => item.id !== textbookId);
  saveDB();
}

export function generateReport(childId, type = "weekly") {
  const db = readDB();
  const child = db.children.find((item) => item.id === childId);
  if (!child) return null;
  const records = listRecords(childId);
  const writing = records.filter((item) => item.type === "writing");
  const reading = records.filter((item) => item.type === "reading");
  const homework = records.filter((item) => item.type === "homework");
  const avg = (items) => (items.length ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : 0);
  const report = {
    id: uid("report"),
    family_id: child.family_id,
    child_id: child.id,
    type,
    period_start: records.length ? records[0].date : nowIso().slice(0, 10),
    period_end: records.length ? records[records.length - 1].date : nowIso().slice(0, 10),
    title: `${child.name} · ${type === "monthly" ? "成长月报" : "成长周报"}`,
    summary: `${child.name}近期共产生 ${records.length} 条成长记录：写作 ${writing.length} 条、阅读 ${reading.length} 条、作业 ${homework.length} 条。`,
    metrics: {
      writing: avg(writing),
      reading: avg(reading),
      homework: avg(homework),
    },
    created_at: nowIso(),
  };
  db.reports.push(report);
  saveDB();
  return report;
}

export function listReports(childId) {
  return readDB().reports
    .filter((item) => item.child_id === childId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createTask(input) {
  const db = readDB();
  const task = {
    id: uid("task"),
    family_id: String(input.family_id || ""),
    child_id: String(input.child_id || ""),
    kind: String(input.kind || "task"),
    subject: String(input.subject || ""),
    title: String(input.title || ""),
    description: String(input.description || ""),
    estimated_minutes: Number(input.estimated_minutes || 0),
    priority: String(input.priority || "medium"),
    deadline: String(input.deadline || ""),
    due_date: String(input.due_date || input.deadline || ""),
    status: String(input.status || "pending"),
    difficulty: String(input.difficulty || "medium"),
    source: String(input.source || "workbuddy"),
    date: String(input.date || nowIso().slice(0, 10)),
    completed_at: String(input.completed_at || ""),
    created_at: nowIso(),
  };
  db.tasks.push(task);
  saveDB();
  return task;
}

export function updateTask(taskId, input) {
  const db = readDB();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return null;
  for (const key of ["kind", "subject", "title", "description", "estimated_minutes", "priority", "deadline", "due_date", "status", "difficulty", "source", "date", "completed_at"]) {
    if (input[key] !== undefined) {
      task[key] = ["estimated_minutes"].includes(key) ? Number(input[key]) : String(input[key]);
    }
  }
  saveDB();
  return task;
}

export function listTasks(childId) {
  const db = readDB();
  return db.tasks
    .filter((item) => !childId || item.child_id === childId)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

export function createHomework(input) {
  return createTask({
    ...input,
    kind: "homework",
    source: input.source || "workbuddy_homework",
  });
}

export function listHomework(childId) {
  return listTasks(childId).filter((item) => item.kind === "homework");
}

export function updateHomework(taskId, input) {
  return updateTask(taskId, input);
}

export function completeHomework(taskId, completedAt = nowIso()) {
  const db = readDB();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return null;
  task.status = "done";
  task.completed_at = completedAt;
  saveDB();
  return task;
}

export function growthSeries(childId) {
  const records = listRecords(childId);
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.date)) grouped.set(record.date, { writing: [], reading: [], homework: [] });
    const bucket = grouped.get(record.date);
    if (bucket[record.type]) bucket[record.type].push(record.score);
  }
  return [...grouped.entries()].map(([date, scores]) => {
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
    return { date, writing: avg(scores.writing), reading: avg(scores.reading), homework: avg(scores.homework) };
  });
}

export function getHomeData(familyId) {
  const db = readDB();
  const family = getFamily(familyId);
  const children = listChildren(familyId);
  const reports = db.reports.filter((item) => item.family_id === familyId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const records = db.records.filter((item) => item.family_id === familyId);
  const textbooks = listTextbooks(familyId);
  const knowledge = db.knowledge
    .filter((item) => item.family_id === familyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 4);
  const writing = records.filter((item) => item.type === "writing");
  const reading = records.filter((item) => item.type === "reading");
  const homework = records.filter((item) => item.type === "homework");
  const avg = (items) => (items.length ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : 0);
  const insights = children.map((child) => {
    const childRecords = records.filter((item) => item.child_id === child.id);
    const recent = childRecords.filter((item) => item.date >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    return {
      child_id: child.id,
      name: child.name,
      message: recent.length
        ? `最近 7 天有 ${recent.length} 条成长记录，建议继续关注“原因表达”类训练。`
        : `本周暂无新记录，建议从一次阅读复述开始。`,
    };
  });
  return {
    family,
    children,
    reports: reports.slice(0, 3),
    textbooks: textbooks.slice(0, 4),
    knowledge,
    stats: {
      records: records.length,
      writing: writing.length,
      reading: Math.round(avg(reading)),
      homework: Math.round(avg(homework)),
      trend: records.length >= 10 ? "+3" : "+1",
    },
    insights,
    growth: children.map((child) => ({ child_id: child.id, name: child.name, series: growthSeries(child.id) })),
  };
}

export function getFamilySummary(familyId) {
  const db = readDB();
  const children = listChildren(familyId);
  const records = db.records.filter((item) => item.family_id === familyId);
  const textbooks = listTextbooks(familyId);
  return {
    family_id: familyId,
    children: children.map((child) => ({ child_id: child.id, name: child.name, grade: child.grade })),
    record_count: records.length,
    textbook_count: textbooks.length,
  };
}

export function seedIfEmpty() {
  const db = readDB();
  if (db.users.length > 0) return;

  const family = {
    id: "family_001",
    name: "乔乔家",
    invite_code: "HE-2026",
    created_at: "2026-07-20T08:00:00.000Z",
  };
  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: "user_001",
    family_id: family.id,
    email: DEMO_EMAIL,
    password_hash: hashPassword(DEMO_PASSWORD, salt),
    salt,
    created_at: "2026-07-20T08:05:00.000Z",
  };
  db.families.push(family);
  db.users.push(user);

  db.children.push(
    { id: "child_001", family_id: family.id, name: "乔乔", age: 9, grade: "三年级", subjects: ["语文", "数学", "英语"], textbook_version: "人教版 · 三年级上册", created_at: "2026-07-20T09:00:00.000Z" },
    { id: "child_002", family_id: family.id, name: "小明", age: 7, grade: "一年级", subjects: ["语文", "数学"], textbook_version: "部编版 · 一年级上册", created_at: "2026-07-28T09:00:00.000Z" }
  );

  const records = [
    ["child_001", "writing", "2026-08-01", "怕桥的日记", 61, "时间顺序较混乱"],
    ["child_001", "writing", "2026-08-05", "漂流的一天", 66, "开始按事件顺序描述"],
    ["child_001", "writing", "2026-08-08", "雨后小路", 72, "出现人物语言"],
    ["child_001", "writing", "2026-08-10", "市场下雨", 74, "细节描写提升"],
    ["child_001", "writing", "2026-08-13", "暑假的最后一天", 78, "结构完整，原因表达待加强"],
    ["child_001", "reading", "2026-08-03", "小王子", 62, "能复述主要情节"],
    ["child_001", "reading", "2026-08-09", "夏洛的网", 70, "能说出人物关系"],
    ["child_001", "reading", "2026-08-12", "昆虫记", 74, "开始回答为什么类问题"],
    ["child_001", "homework", "2026-08-02", "数学练习册", 80, "完成度稳定"],
    ["child_001", "homework", "2026-08-11", "语文背诵", 86, "提前完成"],
    ["child_002", "reading", "2026-08-04", "猜猜我有多爱你", 60, "复述完整度一般"],
    ["child_002", "reading", "2026-08-08", "蚯蚓的日记", 66, "复述提升"],
    ["child_002", "reading", "2026-08-12", "好饿的毛毛虫", 72, "能回答为什么类问题"],
  ];
  for (const [childId, type, date, title, score, notes] of records) {
    db.records.push({ id: uid("record"), family_id: family.id, child_id: childId, type, date, title, score, notes, metadata: {}, created_at: `${date}T10:00:00.000Z` });
  }

  db.tasks.push(
    {
      id: "homework_001",
      family_id: family.id,
      child_id: "child_001",
      kind: "homework",
      subject: "语文",
      title: "背诵古诗两首",
      description: "课本第二单元古诗，明天课堂检查。",
      estimated_minutes: 20,
      priority: "high",
      deadline: "2026-08-13",
      due_date: "2026-08-13",
      status: "done",
      difficulty: "medium",
      source: "workbuddy_homework",
      date: "2026-08-13",
      completed_at: "2026-08-13T20:00:00.000Z",
      created_at: "2026-08-13T08:00:00.000Z",
    },
    {
      id: "homework_002",
      family_id: family.id,
      child_id: "child_001",
      kind: "homework",
      subject: "数学",
      title: "练习册 P32-33",
      description: "完成口算和应用题，完成后家长签字。",
      estimated_minutes: 30,
      priority: "high",
      deadline: "2026-08-13",
      due_date: "2026-08-13",
      status: "pending",
      difficulty: "medium",
      source: "workbuddy_homework",
      date: "2026-08-13",
      completed_at: "",
      created_at: "2026-08-13T08:00:00.000Z",
    },
    {
      id: "homework_003",
      family_id: family.id,
      child_id: "child_002",
      kind: "homework",
      subject: "语文",
      title: "朗读课文 20 分钟",
      description: "读熟今天学习的课文，并复述大意。",
      estimated_minutes: 20,
      priority: "medium",
      deadline: "2026-08-13",
      due_date: "2026-08-13",
      status: "pending",
      difficulty: "easy",
      source: "workbuddy_homework",
      date: "2026-08-13",
      completed_at: "",
      created_at: "2026-08-13T08:00:00.000Z",
    }
  );

  db.reports.push({
    id: uid("report"),
    family_id: family.id,
    child_id: "child_001",
    type: "weekly",
    period_start: "2026-08-06",
    period_end: "2026-08-13",
    title: "乔乔 · 8月第二周成长周报",
    summary: "乔乔本周写作持续提升，阅读复述完整度提升，作业完成度稳定。",
    metrics: { writing: 78, reading: 74, homework: 86 },
    created_at: "2026-08-13T12:00:00.000Z",
  });

  db.textbooks.push(
    {
      id: "textbook_001",
      family_id: family.id,
      child_id: "child_001",
      title: "语文三年级上册",
      subject: "语文",
      grade: "三年级",
      publisher: "人教版",
      version: "三年级上册",
      source: "workbuddy_upload",
      file: "object-store://families/family_001/textbooks/chinese-grade3.pdf",
      chapters: [
        { title: "第一单元", knowledge_points: ["词语积累", "阅读表达"] },
        { title: "第二单元", knowledge_points: ["观察与表达", "段落结构"] },
      ],
      knowledge_points: ["词语积累", "阅读表达", "观察与表达"],
      status: "ready",
      created_at: "2026-08-13T10:00:00.000Z",
    },
    {
      id: "textbook_002",
      family_id: family.id,
      child_id: "child_001",
      title: "数学三年级上册",
      subject: "数学",
      grade: "三年级",
      publisher: "人教版",
      version: "三年级上册",
      source: "workbuddy_upload",
      file: "object-store://families/family_001/textbooks/math-grade3.pdf",
      chapters: [{ title: "第一单元", knowledge_points: ["时分秒", "测量"] }],
      knowledge_points: ["时分秒", "测量"],
      status: "ready",
      created_at: "2026-08-12T10:00:00.000Z",
    },
    {
      id: "textbook_003",
      family_id: family.id,
      child_id: "child_002",
      title: "语文一年级上册",
      subject: "语文",
      grade: "一年级",
      publisher: "部编版",
      version: "一年级上册",
      source: "workbuddy_upload",
      file: "object-store://families/family_001/textbooks/chinese-grade1.pdf",
      chapters: [{ title: "识字单元", knowledge_points: ["拼音", "识字"] }],
      knowledge_points: ["拼音", "识字"],
      status: "syncing",
      created_at: "2026-08-11T10:00:00.000Z",
    }
  );

  db.knowledge.push(
    {
      id: "knowledge_001",
      family_id: family.id,
      child_id: "child_001",
      kind: "summary",
      title: "乔乔 8月写作阶段总结",
      content: "乔乔近期写作结构完整度明显提升，已经能从按时间顺序描述过渡到出现人物语言。下一步重点是解释事情发生的原因，而不是只写发生了什么。",
      source: "workbuddy",
      created_at: "2026-08-13T11:00:00.000Z",
    },
    {
      id: "knowledge_002",
      family_id: family.id,
      child_id: "child_002",
      kind: "suggestion",
      title: "小明阅读复述建议",
      content: "小明连续阅读记录完整，但复述时容易只讲开头和结尾。建议每天读完后增加两个问题：中间发生了什么，为什么会出现这个变化。",
      source: "workbuddy",
      created_at: "2026-08-12T11:00:00.000Z",
    }
  );
  saveDB();
}

export function syncLocalPayload(payload) {
  const db = readDB();
  const familyId = payload.family_id || "family_sync";
  if (Array.isArray(payload.children)) {
    for (const child of payload.children) {
      if (!db.children.some((item) => item.id === child.id)) {
        db.children.push({ ...child, family_id: familyId });
      }
    }
  }
  if (Array.isArray(payload.records)) {
    for (const record of payload.records) {
      if (!db.records.some((item) => item.id === record.id)) {
        db.records.push({ ...record, family_id: familyId });
      }
    }
  }
  if (Array.isArray(payload.textbooks)) {
    for (const textbook of payload.textbooks) {
      if (!db.textbooks.some((item) => item.id === textbook.id)) {
        db.textbooks.push({ ...textbook, family_id: familyId });
      }
    }
  }
  saveDB();
  return { synced: true, family_id: familyId };
}

export function extractTextbookChapters(title, subject, grade) {
  const unitName = subject === "数学" ? "单元" : subject === "英语" ? "Module" : "单元";
  return [
    { title: `第一${unitName}`, knowledge_points: ["基础概念", "表达训练"] },
    { title: `第二${unitName}`, knowledge_points: ["综合应用", "复习巩固"] },
  ];
}

export function ensureUploadDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
