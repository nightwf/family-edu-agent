import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  getFamily,
  getUserByToken,
  createSession,
  deleteSession,
  findUserByEmail,
  registerFamily,
  verifyPassword,
  listChildren,
  createChild,
  updateChild,
  deleteChild,
  listRecords,
  createRecord,
  listTextbooks,
  getTextbook,
  createTextbook,
  updateTextbook,
  deleteTextbook,
  createKnowledgeItem,
  listKnowledgeItems,
  deleteKnowledgeItem,
  createHomework,
  listHomework,
  updateHomework,
  completeHomework,
  listReports,
  generateReport,
  growthSeries,
  getHomeData,
  getFamilySummary,
  syncLocalPayload,
  extractTextbookChapters,
  ensureUploadDirs,
} from "./store.js";
import { PORT, WEB_DIR, UPLOAD_DIR, WORKBUDDY_PROMPT } from "./config.js";
import { registerMcpHttp } from "./mcp/http.js";

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    family_id: user.family_id,
    created_at: user.created_at,
  };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.query.token;
  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: "未登录或登录已过期" });
  }
  req.user = user;
  req.token = token;
  next();
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  ensureUploadDirs();
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\u4e00-\u9fa5_-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  });
  const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "family-edu-agent", time: new Date().toISOString() }));

  app.post("/api/auth/register", asyncHandler(async (req, res) => {
    const { inviteCode, email, password } = req.body || {};
    const { user, family } = registerFamily({ email, password, inviteCode });
    const token = createSession(user.id);
    res.status(201).json({ token, user: publicUser(user), family });
  }));

  app.post("/api/auth/login", asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const user = findUserByEmail(email);
    if (!user || !verifyPassword(user, password)) {
      return res.status(401).json({ error: "邮箱或密码错误" });
    }
    const token = createSession(user.id);
    res.json({ token, user: publicUser(user), family: getFamily(user.family_id) });
  }));

  app.post("/api/auth/logout", (req, res) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.body?.token;
    if (token) deleteSession(token);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user), family: getFamily(req.user.family_id) });
  });

  app.get("/api/home", requireAuth, asyncHandler(async (req, res) => {
    res.json(getHomeData(req.user.family_id));
  }));

  app.get("/api/family/summary", requireAuth, asyncHandler(async (req, res) => {
    res.json(getFamilySummary(req.user.family_id));
  }));

  app.get("/api/knowledge", requireAuth, (req, res) => {
    res.json(listKnowledgeItems(req.user.family_id));
  });

  app.get("/api/homework", requireAuth, (req, res) => {
    const items = listHomework().filter((item) => item.family_id === req.user.family_id);
    if (req.query.child_id) {
      res.json(items.filter((item) => item.child_id === req.query.child_id));
    } else {
      res.json(items);
    }
  });

  app.post("/api/homework", requireAuth, asyncHandler(async (req, res) => {
    const item = createHomework({
      family_id: req.user.family_id,
      ...(req.body || {}),
    });
    res.status(201).json(item);
  }));

  app.patch("/api/homework/:homeworkId", requireAuth, asyncHandler(async (req, res) => {
    const item = updateHomework(req.params.homeworkId, req.body);
    if (!item) return res.status(404).json({ error: "作业不存在" });
    res.json(item);
  }));

  app.post("/api/homework/:homeworkId/complete", requireAuth, asyncHandler(async (req, res) => {
    const item = completeHomework(req.params.homeworkId, req.body?.completed_at || undefined);
    if (!item) return res.status(404).json({ error: "作业不存在" });
    res.json(item);
  }));

  app.post("/api/knowledge", requireAuth, asyncHandler(async (req, res) => {
    const item = createKnowledgeItem({
      family_id: req.user.family_id,
      ...(req.body || {}),
    });
    res.status(201).json(item);
  }));

  app.delete("/api/knowledge/:itemId", requireAuth, asyncHandler(async (req, res) => {
    deleteKnowledgeItem(req.params.itemId);
    res.json({ ok: true });
  }));

  app.get("/api/children", requireAuth, (req, res) => {
    res.json(listChildren(req.user.family_id));
  });

  app.post("/api/children", requireAuth, asyncHandler(async (req, res) => {
    const child = createChild(req.user.family_id, req.body);
    res.status(201).json(child);
  }));

  app.patch("/api/children/:childId", requireAuth, asyncHandler(async (req, res) => {
    const child = updateChild(req.params.childId, req.body);
    if (!child) return res.status(404).json({ error: "孩子不存在" });
    res.json(child);
  }));

  app.delete("/api/children/:childId", requireAuth, asyncHandler(async (req, res) => {
    deleteChild(req.params.childId);
    res.json({ ok: true });
  }));

  app.get("/api/children/:childId/records", requireAuth, (req, res) => {
    res.json(listRecords(req.params.childId));
  });

  app.post("/api/children/:childId/records", requireAuth, asyncHandler(async (req, res) => {
    const record = createRecord({
      family_id: req.user.family_id,
      child_id: req.params.childId,
      ...(req.body || {}),
    });
    res.status(201).json(record);
  }));

  app.get("/api/children/:childId/reports", requireAuth, (req, res) => {
    res.json(listReports(req.params.childId));
  });

  app.post("/api/children/:childId/reports", requireAuth, asyncHandler(async (req, res) => {
    const report = generateReport(req.params.childId, req.body?.type || "weekly");
    if (!report) return res.status(404).json({ error: "孩子不存在" });
    res.status(201).json(report);
  }));

  app.get("/api/children/:childId/growth", requireAuth, (req, res) => {
    res.json(growthSeries(req.params.childId));
  });

  app.get("/api/textbooks", requireAuth, (req, res) => {
    res.json(listTextbooks(req.user.family_id));
  });

  app.get("/api/textbooks/:textbookId", requireAuth, (req, res) => {
    const textbook = getTextbook(req.params.textbookId);
    if (!textbook) return res.status(404).json({ error: "教材不存在" });
    res.json(textbook);
  });

  app.patch("/api/textbooks/:textbookId", requireAuth, asyncHandler(async (req, res) => {
    const textbook = updateTextbook(req.params.textbookId, req.body);
    if (!textbook) return res.status(404).json({ error: "教材不存在" });
    res.json(textbook);
  }));

  app.delete("/api/textbooks/:textbookId", requireAuth, asyncHandler(async (req, res) => {
    deleteTextbook(req.params.textbookId);
    res.json({ ok: true });
  }));

  app.post("/api/textbooks/import", requireAuth, upload.single("file"), asyncHandler(async (req, res) => {
    const body = req.body || {};
    const title = body.title || (req.file ? path.parse(req.file.originalname).name : "未命名教材");
    const subject = body.subject || "语文";
    const grade = body.grade || "";
    const childId = body.child_id || "";
    const chapters = extractTextbookChapters(title, subject, grade);
    const textbook = createTextbook({
      family_id: req.user.family_id,
      child_id: childId,
      title,
      subject,
      grade,
      publisher: body.publisher || "",
      version: body.version || "",
      source: "workbuddy_upload",
      file: req.file ? `/uploads/${req.file.filename}` : body.file || "",
      chapters,
      knowledge_points: chapters.flatMap((item) => item.knowledge_points),
      status: "ready",
    });
    res.status(201).json(textbook);
  }));

  app.post("/api/sync/local", requireAuth, asyncHandler(async (req, res) => {
    res.json(syncLocalPayload({ family_id: req.user.family_id, ...(req.body || {}) }));
  }));

  app.get("/api/settings", requireAuth, (req, res) => {
    res.json({
      user: publicUser(req.user),
      family: getFamily(req.user.family_id),
      child_count: listChildren(req.user.family_id).length,
      workbuddy_prompt: WORKBUDDY_PROMPT,
    });
  });

  await registerMcpHttp(app);

  app.use(express.static(WEB_DIR));
  app.get("*", (req, res) => {
    const indexPath = path.join(WEB_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: "not found" });
    }
  });

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "文件不能超过 20MB" });
    }
    res.status(status).json({ error: error.message || "服务内部错误" });
  });

  return app;
}

export async function startApi() {
  const app = await createApp();
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`[family-edu-agent] API running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}
