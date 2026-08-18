import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookMarked,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Copy,
  Edit,
  Eye,
  Plus,
  RefreshCw,
  Search,
  Shapes,
  Sparkles,
  Target,
  Trash,
  X,
} from "lucide-react";

type Child = { id: string; name: string; grade: string };
type ApiRequest = (path: string, options?: RequestInit, token?: string) => Promise<any>;

type QuestionType = {
  id: string;
  subject: string;
  grade?: string;
  name: string;
  description?: string;
  textbook?: string;
  chapter?: string;
  knowledgePoints: string[];
  tags: string[];
  abilityGoal?: string;
  solutionMethod?: string;
  standardSteps?: unknown;
  commonErrors?: unknown;
  invariants?: unknown;
  variableParameters?: unknown;
  difficultyLevels?: unknown;
  generationRule?: unknown;
  answerValidation?: unknown;
  masteryCriteria?: unknown;
  ruleVersion: string;
  status: string;
  _count?: { questions: number; masteries: number };
};

type Question = {
  id: string;
  questionTypeId: string;
  stem: string;
  format: string;
  options?: unknown;
  answer?: unknown;
  solution?: string;
  scoringRubric?: unknown;
  difficulty: string;
  tags: string[];
  source: string;
  fileKey?: string;
  sourceQuestionId?: string;
  generationRuleVersion?: string;
  variationType?: string;
  generatedByWorkbuddy: boolean;
  status: string;
  questionType: QuestionType & { masteries?: Mastery[] };
  attempts?: Attempt[];
  _count?: { attempts: number };
};

type Attempt = {
  id: string;
  childId: string;
  isCorrect?: boolean;
  score?: number;
  usedHint: boolean;
  errorReason?: string;
  evaluation?: string;
  attemptedAt: string;
  child?: Child;
};

type Mastery = {
  id: string;
  childId: string;
  questionTypeId: string;
  status: string;
  calculatedStatus: string;
  masteryScore: number;
  totalAttempts: number;
  correctRate: number;
  independentAttempts: number;
  variationCount: number;
  transferScore?: number;
  nextReviewAt?: string;
  manualStatus?: string;
  manualReason?: string;
  evidence?: any;
  child: Child;
  questionType: QuestionType;
};

const DIFFICULTY_LABELS: Record<string, string> = { basic: "基础", advanced: "进阶", transfer: "迁移", review: "复习" };
const STATUS_LABELS: Record<string, string> = { unassessed: "未评估", learning: "学习中", basic: "基本掌握", mastered: "已掌握", needs_review: "需复习" };
const FORMAT_LABELS: Record<string, string> = { single_choice: "单选题", multiple_choice: "多选题", true_false: "判断题", fill_blank: "填空题", short_answer: "简答题", essay: "写作题", calculation: "计算题" };
const SUBJECTS = ["数学", "语文", "英语", "科学", "物理", "化学"];

function textLines(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item));
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}：${typeof item === "string" ? item : JSON.stringify(item)}`);
  return value ? [String(value)] : [];
}

function pretty(value: unknown) {
  if (value === undefined || value === null || value === "") return "未设置";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formText(value: unknown) {
  return value === undefined || value === null ? "" : pretty(value);
}

function parseValue(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch (_error) { return text; }
}

function parseLines(value: FormDataEntryValue | null) {
  return String(value || "").split(/\n|[,，、]/).map((item) => item.trim()).filter(Boolean);
}

function statusTone(status: string) {
  if (status === "mastered") return "bg-teal/10 text-teal";
  if (status === "needs_review") return "bg-accent/10 text-accent";
  if (status === "basic") return "bg-gold/20 text-amber-800";
  return "bg-stone-100 text-stone-600";
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17252a]/60 p-3 md:p-6">
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-lg bg-panel shadow-2xl ${wide ? "max-w-4xl" : "max-w-xl"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-panel px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" title="关闭" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-stone-500 hover:bg-stone-100"><X size={19} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, detail, action }: { icon: any; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-stone-300 bg-white/40 px-6 text-center">
      <Icon size={34} className="text-teal" />
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-stone-500">{detail}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default function QuestionBank({ token, children, request }: { token: string; children: Child[]; request: ApiRequest }) {
  const [tab, setTab] = useState<"questions" | "types" | "mastery">("questions");
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [masteries, setMasteries] = useState<Mastery[]>([]);
  const [subjects, setSubjects] = useState(SUBJECTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [childId, setChildId] = useState("");
  const [masteryStatus, setMasteryStatus] = useState("");
  const [questionDialog, setQuestionDialog] = useState(false);
  const [typeDialog, setTypeDialog] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [editingType, setEditingType] = useState<QuestionType | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
  const [selectedType, setSelectedType] = useState<QuestionType | null>(null);
  const [editingMastery, setEditingMastery] = useState<Mastery | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const questionParams = new URLSearchParams({ limit: "100" });
      if (query) questionParams.set("query", query);
      if (subject) questionParams.set("subject", subject);
      if (difficulty) questionParams.set("difficulty", difficulty);
      if (childId) questionParams.set("child_id", childId);
      const masteryParams = new URLSearchParams({ limit: "100" });
      if (childId) masteryParams.set("child_id", childId);
      if (subject) masteryParams.set("subject", subject);
      if (masteryStatus) masteryParams.set("status", masteryStatus);
      const [typeData, questionData, masteryData, subjectData] = await Promise.all([
        request("/api/question-types?limit=100", {}, token),
        request(`/api/questions?${questionParams}`, {}, token),
        request(`/api/mastery?${masteryParams}`, {}, token),
        request("/api/question-subjects", {}, token),
      ]);
      setQuestionTypes(typeData.items || []);
      setQuestions(questionData.items || []);
      setMasteries(masteryData.items || []);
      setSubjects(subjectData || SUBJECTS);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, request, query, subject, difficulty, childId, masteryStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredTypes = useMemo(() => questionTypes.filter((item) => (
    (!subject || item.subject === subject)
    && (!query || `${item.name}${item.description || ""}${item.knowledgePoints.join("")}`.toLowerCase().includes(query.toLowerCase()))
  )), [questionTypes, query, subject]);

  async function submitQuestionType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      subject: form.get("subject"), grade: form.get("grade"), name: form.get("name"), description: form.get("description"),
      textbook: form.get("textbook"), chapter: form.get("chapter"), knowledge_points: parseLines(form.get("knowledge_points")), tags: parseLines(form.get("tags")),
      ability_goal: form.get("ability_goal"), solution_method: form.get("solution_method"), standard_steps: parseLines(form.get("standard_steps")),
      common_errors: parseLines(form.get("common_errors")), invariants: parseLines(form.get("invariants")), variable_parameters: parseLines(form.get("variable_parameters")),
      difficulty_levels: parseValue(form.get("difficulty_levels")), generation_rule: form.get("generation_rule"), answer_validation: form.get("answer_validation"),
      mastery_criteria: { minScore: Number(form.get("min_score") || 80), minAttempts: Number(form.get("min_attempts") || 5), minVariations: Number(form.get("min_variations") || 3), requireTransfer: true, requireDelayedReview: true, delayedHours: 24 },
      rule_version: form.get("rule_version") || "1.0.0", status: form.get("status") || "active",
    };
    await request(editingType ? `/api/question-types/${editingType.id}` : "/api/question-types", { method: editingType ? "PATCH" : "POST", body: JSON.stringify(payload) }, token);
    setTypeDialog(false); setEditingType(null); await load();
  }

  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingQuestion) return;
    const form = new FormData(event.currentTarget);
    let fileKey = editingQuestion?.fileKey;
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      const upload = new FormData(); upload.append("file", file);
      const uploaded = await request("/api/questions/upload", { method: "POST", body: upload }, token);
      fileKey = uploaded.file_key;
    }
    const payload = {
      question_type_id: form.get("question_type_id"), stem: form.get("stem"), format: form.get("format"), options: parseValue(form.get("options")),
      answer: parseValue(form.get("answer")), solution: form.get("solution"), scoring_rubric: parseLines(form.get("scoring_rubric")), difficulty: form.get("difficulty"),
      variation_type: form.get("variation_type"), tags: parseLines(form.get("tags")), source: form.get("source") || "parent", file_key: fileKey,
      generated_by_workbuddy: editingQuestion?.generatedByWorkbuddy || false, status: form.get("status") || "active",
    };
    await request(`/api/questions/${editingQuestion.id}`, { method: "PATCH", body: JSON.stringify(payload) }, token);
    setQuestionDialog(false); setEditingQuestion(null); await load();
  }

  async function saveMastery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMastery) return;
    const form = new FormData(event.currentTarget);
    await request(`/api/mastery/${editingMastery.childId}/${editingMastery.questionTypeId}`, { method: "PATCH", body: JSON.stringify({ status: form.get("status"), reason: form.get("reason"), source: "parent" }) }, token);
    setEditingMastery(null); await load();
  }

  async function clearMasteryOverride(item: Mastery) {
    await request(`/api/mastery/${item.childId}/${item.questionTypeId}`, { method: "PATCH", body: JSON.stringify({ clear_manual_override: true }) }, token);
    await load();
  }

  async function toggleType(item: QuestionType) {
    await request(`/api/question-types/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "active" ? "inactive" : "active" }) }, token); await load();
  }

  async function toggleQuestion(item: Question) {
    await request(`/api/questions/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "active" ? "inactive" : "active" }) }, token); await load();
  }

  async function remove(path: string, message: string) {
    if (!window.confirm(message)) return;
    try { await request(path, { method: "DELETE" }, token); await load(); } catch (err) { window.alert((err as Error).message); }
  }

  async function openQuestion(item: Question) {
    const detail = await request(`/api/questions/${item.id}`, {}, token);
    setSelectedQuestion(detail);
  }

  async function openType(item: QuestionType) {
    const detail = await request(`/api/question-types/${item.id}`, {}, token);
    setSelectedType(detail);
  }

  async function copyPracticePrompt(questionTypeId: string, sourceQuestionId?: string) {
    const chosenChild = children.find((item) => item.id === childId);
    const text = `请使用禾芽题库为${chosenChild ? `学生“${chosenChild.name}”` : "当前学生"}生成同题型练习。先调用 get_question_generation_context，question_type_id=${questionTypeId}${sourceQuestionId ? `，source_question_id=${sourceQuestionId}` : ""}，根据学生薄弱点生成基础、进阶和迁移变式题，完成后调用 save_questions_batch 写回题库。`;
    await navigator.clipboard.writeText(text);
    setCopyStatus("已复制到剪贴板"); window.setTimeout(() => setCopyStatus(""), 1800);
  }

  async function openAttachment(questionId: string) {
    const apiBase = location.pathname.startsWith("/family-edu/") ? "/family-edu" : "";
    const response = await fetch(`${apiBase}/api/questions/${questionId}/file`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      window.alert(data.error || "附件打开失败");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-stone-500">家庭题目沉淀、题型方法与学生掌握证据</p>
          <div className="mt-3 inline-flex rounded-lg border border-stone-200 bg-white p-1">
            {([{ id: "questions", label: "题目列表", icon: BookMarked }, { id: "types", label: "题型分类", icon: Shapes }, { id: "mastery", label: "学生掌握", icon: Target }] as const).map((item) => {
              const Icon = item.icon;
              return <button key={item.id} onClick={() => setTab(item.id)} className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm ${tab === item.id ? "bg-[#23353b] text-white" : "text-stone-600 hover:bg-stone-50"}`}><Icon size={16} />{item.label}</button>;
            })}
          </div>
        </div>
        <div className="flex gap-2">
          <button title="刷新题库" onClick={load} className="grid h-10 w-10 place-items-center rounded-lg border border-stone-200 bg-white text-stone-600"><RefreshCw size={17} /></button>
          {tab === "types" ? <button onClick={() => { setEditingType(null); setTypeDialog(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm text-white"><Plus size={17} />新建题型</button> : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_160px_160px_160px]">
        <label className="relative block"><Search size={16} className="absolute left-3 top-3 text-stone-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full rounded-lg border border-stone-200 bg-white pl-9 pr-3 text-sm" placeholder="搜索题干、题型或知识点" /></label>
        <select value={subject} onChange={(event) => setSubject(event.target.value)} className="h-10 rounded-lg border border-stone-200 bg-white px-3 text-sm"><option value="">全部学科</option>{subjects.map((item) => <option key={item}>{item}</option>)}</select>
        {tab === "questions" && <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="h-10 rounded-lg border border-stone-200 bg-white px-3 text-sm"><option value="">全部难度</option>{Object.entries(DIFFICULTY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
        {(tab === "questions" || tab === "mastery") && <select value={childId} onChange={(event) => setChildId(event.target.value)} className="h-10 rounded-lg border border-stone-200 bg-white px-3 text-sm"><option value="">全部学生</option>{children.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        {tab === "mastery" && <select value={masteryStatus} onChange={(event) => setMasteryStatus(event.target.value)} className="h-10 rounded-lg border border-stone-200 bg-white px-3 text-sm"><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
      </div>

      {error && <div className="border-l-4 border-accent bg-white px-4 py-3 text-sm text-accent">{error}</div>}
      {copyStatus && <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-[#23353b] px-4 py-3 text-sm text-white shadow-lg">{copyStatus}</div>}

      {loading ? <div className="py-20 text-center text-sm text-stone-500">正在读取题库...</div> : null}

      {!loading && tab === "questions" && (questions.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {questions.map((item) => (
            <article key={item.id} className="border border-stone-200 bg-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap gap-2 text-xs"><span className="bg-teal/10 px-2 py-1 text-teal">{item.questionType.subject}</span><span className="bg-stone-100 px-2 py-1 text-stone-600">{item.questionType.name}</span><span className="bg-gold/20 px-2 py-1 text-amber-800">{DIFFICULTY_LABELS[item.difficulty] || item.difficulty}</span>{item.status !== "active" && <span className="bg-stone-200 px-2 py-1 text-stone-600">已停用</span>}</div><h3 className="mt-3 line-clamp-3 font-semibold leading-7">{item.stem}</h3></div>
                <button title="查看题目详情" onClick={() => openQuestion(item)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-stone-200 text-teal"><Eye size={17} /></button>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-stone-200 pt-3 text-xs text-stone-500">
                <span>{FORMAT_LABELS[item.format] || item.format} · {item.variationType || "原始题"} · {item._count?.attempts || 0} 次作答</span>
                <div className="flex gap-1"><button title="复制 WorkBuddy 变式练习指令" onClick={() => copyPracticePrompt(item.questionTypeId, item.id)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-stone-100"><Sparkles size={16} /></button><button title="编辑题目" onClick={() => { setEditingQuestion(item); setQuestionDialog(true); }} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-stone-100"><Edit size={16} /></button><button title={item.status === "active" ? "停用题目" : "重新启用"} onClick={() => toggleQuestion(item)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-stone-100"><Archive size={16} /></button><button title="删除题目" onClick={() => remove(`/api/questions/${item.id}`, "确定删除这道题吗？已有作答记录的题目将不能删除。") } className="grid h-8 w-8 place-items-center rounded-lg text-accent hover:bg-accent/5"><Trash size={16} /></button></div>
              </div>
            </article>
          ))}
        </div>
      ) : <EmptyState icon={BookMarked} title="题库还是空的" detail="请在 WorkBuddy 中发送或上传题目，并明确说“保存到禾芽题库”。WorkBuddy 会通过家庭专属 MCP 完成题型识别和同步。" />)}

      {!loading && tab === "types" && (filteredTypes.length ? (
        <div className="divide-y divide-stone-200 border-y border-stone-200 bg-panel">
          {filteredTypes.map((item) => <div key={item.id} className="grid gap-4 px-4 py-5 md:grid-cols-[1fr_180px_auto] md:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{item.name}</span><span className="bg-teal/10 px-2 py-1 text-xs text-teal">{item.subject}</span>{item.grade && <span className="text-xs text-stone-500">{item.grade}</span>}{item.status !== "active" && <span className="bg-stone-100 px-2 py-1 text-xs text-stone-500">已停用</span>}</div><p className="mt-2 text-sm leading-6 text-stone-600">{item.description || item.abilityGoal || "尚未填写题型说明"}</p><div className="mt-2 flex flex-wrap gap-2">{item.knowledgePoints.map((point) => <span key={point} className="text-xs text-stone-500">#{point}</span>)}</div></div><div className="text-sm text-stone-500"><div>{item._count?.questions || 0} 道题</div><div className="mt-1">规则 v{item.ruleVersion}</div></div><div className="flex gap-1"><button title="查看题型规则" onClick={() => openType(item)} className="grid h-9 w-9 place-items-center rounded-lg border border-stone-200 text-teal"><ChevronRight size={17} /></button><button title="编辑题型" onClick={() => { setEditingType(item); setTypeDialog(true); }} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-stone-100"><Edit size={16} /></button><button title={item.status === "active" ? "停用题型" : "重新启用"} onClick={() => toggleType(item)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-stone-100"><Archive size={16} /></button><button title="删除题型" onClick={() => remove(`/api/question-types/${item.id}`, "确定删除这个题型吗？有关联题目的题型将不能删除。") } className="grid h-9 w-9 place-items-center rounded-lg text-accent"><Trash size={16} /></button></div></div>)}
        </div>
      ) : <EmptyState icon={Shapes} title="还没有题型分类" detail="题型规则决定 WorkBuddy 如何生成有效变式题，也是判断学生是否真正掌握的基础。" action={<button onClick={() => setTypeDialog(true)} className="rounded-lg bg-accent px-4 py-2 text-sm text-white">建立第一个题型</button>} />)}

      {!loading && tab === "mastery" && (masteries.length ? (
        <div className="overflow-x-auto border border-stone-200 bg-panel"><table className="w-full min-w-[780px] text-sm"><thead className="bg-[#23353b] text-left text-white"><tr><th className="px-4 py-3">学生</th><th className="px-4 py-3">题型</th><th className="px-4 py-3">掌握度</th><th className="px-4 py-3">证据</th><th className="px-4 py-3">下次复习</th><th className="px-4 py-3">操作</th></tr></thead><tbody>{masteries.map((item) => <tr key={item.id} className="border-t border-stone-200"><td className="px-4 py-4 font-semibold">{item.child.name}<div className="mt-1 text-xs font-normal text-stone-500">{item.child.grade}</div></td><td className="px-4 py-4">{item.questionType.name}<div className="mt-1 text-xs text-stone-500">{item.questionType.subject}</div></td><td className="px-4 py-4"><div className="flex items-center gap-2"><span className={`px-2 py-1 text-xs ${statusTone(item.status)}`}>{STATUS_LABELS[item.status]}</span>{item.manualStatus && <span title={item.manualReason} className="text-xs text-stone-400">人工</span>}</div><div className="mt-2 h-2 w-36 overflow-hidden rounded-full bg-stone-100"><div className="h-full bg-teal" style={{ width: `${Math.min(100, item.masteryScore)}%` }} /></div><div className="mt-1 text-xs text-stone-500">{Math.round(item.masteryScore)} 分</div></td><td className="px-4 py-4 text-xs leading-6 text-stone-600">练习 {item.totalAttempts} 次<br />正确率 {Math.round(item.correctRate * 100)}% · 变式 {item.variationCount} 种</td><td className="px-4 py-4 text-stone-600">{item.nextReviewAt ? item.nextReviewAt.slice(0, 10) : "未安排"}</td><td className="px-4 py-4"><button onClick={() => setEditingMastery(item)} className="text-teal">调整</button>{item.manualStatus && <button onClick={() => clearMasteryOverride(item)} className="ml-3 text-stone-500">恢复自动</button>}</td></tr>)}</tbody></table></div>
      ) : <EmptyState icon={Target} title="还没有掌握证据" detail="学生在 WorkBuddy 中完成题目并同步作答后，这里会按题型形成独立的掌握轨迹。" />)}

      {typeDialog && <Modal title={editingType ? "编辑题型规则" : "新建题型分类"} onClose={() => { setTypeDialog(false); setEditingType(null); }} wide><form onSubmit={submitQuestionType} className="space-y-6"><div className="grid gap-3 md:grid-cols-3"><label className="text-sm">学科<input list="question-subjects" name="subject" required defaultValue={editingType?.subject} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><datalist id="question-subjects">{subjects.map((item) => <option key={item}>{item}</option>)}</datalist><label className="text-sm">年级<input name="grade" defaultValue={editingType?.grade} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="text-sm">规则版本<input name="rule_version" defaultValue={editingType?.ruleVersion || "1.0.0"} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label></div><label className="block text-sm">题型名称<input name="name" required defaultValue={editingType?.name} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="block text-sm">题型说明<textarea name="description" defaultValue={editingType?.description} className="mt-1 h-20 w-full rounded-lg border border-stone-200 p-3" /></label><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">教材<input name="textbook" defaultValue={editingType?.textbook} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="text-sm">章节<input name="chapter" defaultValue={editingType?.chapter} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="text-sm">知识点<input name="knowledge_points" defaultValue={editingType?.knowledgePoints.join("、")} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="text-sm">标签<input name="tags" defaultValue={editingType?.tags.join("、")} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label></div><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">核心能力目标<textarea name="ability_goal" defaultValue={editingType?.abilityGoal} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" /></label><label className="text-sm">核心解题方法<textarea name="solution_method" defaultValue={editingType?.solutionMethod} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" /></label><label className="text-sm">标准步骤，每行一条<textarea name="standard_steps" defaultValue={textLines(editingType?.standardSteps).join("\n")} className="mt-1 h-28 w-full rounded-lg border border-stone-200 p-3" /></label><label className="text-sm">常见错误，每行一条<textarea name="common_errors" defaultValue={textLines(editingType?.commonErrors).join("\n")} className="mt-1 h-28 w-full rounded-lg border border-stone-200 p-3" /></label><label className="text-sm">题型不变量，每行一条<textarea name="invariants" defaultValue={textLines(editingType?.invariants).join("\n")} className="mt-1 h-28 w-full rounded-lg border border-stone-200 p-3" /></label><label className="text-sm">可变参数，每行一条<textarea name="variable_parameters" defaultValue={textLines(editingType?.variableParameters).join("\n")} className="mt-1 h-28 w-full rounded-lg border border-stone-200 p-3" /></label></div><label className="block text-sm">难度阶梯<textarea name="difficulty_levels" defaultValue={formText(editingType?.difficultyLevels)} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3 font-mono text-xs" /></label><label className="block text-sm">同题型生成规则<textarea name="generation_rule" defaultValue={formText(editingType?.generationRule)} className="mt-1 h-28 w-full rounded-lg border border-stone-200 p-3" /></label><label className="block text-sm">答案校验规则<textarea name="answer_validation" defaultValue={formText(editingType?.answerValidation)} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" /></label><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><CircleHelp size={16} className="text-teal" />掌握判定</div><div className="grid gap-3 md:grid-cols-3"><label className="text-sm">最低掌握分<input name="min_score" type="number" min="1" max="100" defaultValue={(editingType?.masteryCriteria as any)?.minScore || 80} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="text-sm">最少练习次数<input name="min_attempts" type="number" min="1" defaultValue={(editingType?.masteryCriteria as any)?.minAttempts || 5} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="text-sm">最少变式种类<input name="min_variations" type="number" min="1" defaultValue={(editingType?.masteryCriteria as any)?.minVariations || 3} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label></div></div><input type="hidden" name="status" value={editingType?.status || "active"} /><div className="flex justify-end gap-2 border-t border-stone-200 pt-4"><button type="button" onClick={() => { setTypeDialog(false); setEditingType(null); }} className="rounded-lg border border-stone-200 px-4 py-2">取消</button><button className="rounded-lg bg-accent px-5 py-2 text-white">保存题型</button></div></form></Modal>}

      {questionDialog && <Modal title={editingQuestion ? "编辑题目" : "录入题目"} onClose={() => { setQuestionDialog(false); setEditingQuestion(null); }} wide><form onSubmit={submitQuestion} className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><label className="text-sm">题型<select name="question_type_id" required defaultValue={editingQuestion?.questionTypeId} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3"><option value="">选择题型</option>{questionTypes.filter((item) => item.status === "active" || item.id === editingQuestion?.questionTypeId).map((item) => <option key={item.id} value={item.id}>{item.subject} · {item.name}</option>)}</select></label><label className="text-sm">题目形式<select name="format" defaultValue={editingQuestion?.format || "short_answer"} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3">{Object.entries(FORMAT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm">难度<select name="difficulty" defaultValue={editingQuestion?.difficulty || "basic"} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3">{Object.entries(DIFFICULTY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><label className="block text-sm">题干<textarea name="stem" required defaultValue={editingQuestion?.stem} className="mt-1 h-32 w-full rounded-lg border border-stone-200 p-3 text-base leading-7" /></label><label className="block text-sm">选项，可填写 JSON<textarea name="options" defaultValue={editingQuestion?.options ? pretty(editingQuestion.options) : ""} className="mt-1 h-20 w-full rounded-lg border border-stone-200 p-3 font-mono text-xs" /></label><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">标准答案<textarea name="answer" defaultValue={formText(editingQuestion?.answer)} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" /></label><label className="text-sm">评分点，每行一条<textarea name="scoring_rubric" defaultValue={textLines(editingQuestion?.scoringRubric).join("\n")} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" /></label></div><label className="block text-sm">解题过程<textarea name="solution" defaultValue={editingQuestion?.solution} className="mt-1 h-28 w-full rounded-lg border border-stone-200 p-3" /></label><div className="grid gap-3 md:grid-cols-3"><label className="text-sm">变式类型<input name="variation_type" defaultValue={editingQuestion?.variationType || "original"} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="text-sm">标签<input name="tags" defaultValue={editingQuestion?.tags.join("、")} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="text-sm">来源<input name="source" defaultValue={editingQuestion?.source || "parent"} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label></div><label className="block text-sm">图片或附件<input name="file" type="file" accept="image/*,.pdf,.doc,.docx" className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2" /></label><input type="hidden" name="status" value={editingQuestion?.status || "active"} /><div className="flex justify-end gap-2 border-t border-stone-200 pt-4"><button type="button" onClick={() => { setQuestionDialog(false); setEditingQuestion(null); }} className="rounded-lg border border-stone-200 px-4 py-2">取消</button><button className="rounded-lg bg-accent px-5 py-2 text-white">保存题目</button></div></form></Modal>}

      {selectedQuestion && <Modal title="题目详情" onClose={() => setSelectedQuestion(null)} wide><div className="space-y-6"><div className="flex flex-wrap gap-2 text-xs"><span className="bg-teal/10 px-2 py-1 text-teal">{selectedQuestion.questionType.subject}</span><span className="bg-stone-100 px-2 py-1">{selectedQuestion.questionType.name}</span><span className="bg-gold/20 px-2 py-1">{DIFFICULTY_LABELS[selectedQuestion.difficulty]}</span><span className="bg-stone-100 px-2 py-1">{selectedQuestion.variationType || "原始题"}</span></div><section><div className="text-xs font-semibold text-stone-400">题目</div><div className="mt-3 whitespace-pre-wrap border-l-4 border-gold bg-white px-5 py-4 text-lg font-semibold leading-8">{selectedQuestion.stem}</div></section>{selectedQuestion.options && <section><div className="text-xs font-semibold text-stone-400">选项</div><pre className="mt-2 overflow-x-auto whitespace-pre-wrap bg-white p-4 text-sm">{pretty(selectedQuestion.options)}</pre></section>}<div className="grid gap-4 md:grid-cols-2"><section className="border-t-2 border-teal bg-white p-4"><div className="flex items-center gap-2 font-semibold text-teal"><CheckCircle2 size={18} />标准答案</div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-7">{pretty(selectedQuestion.answer)}</pre></section><section className="border-t-2 border-gold bg-white p-4"><div className="font-semibold">评分点</div><ul className="mt-3 space-y-2 text-sm leading-6">{textLines(selectedQuestion.scoringRubric).map((line) => <li key={line}>• {line}</li>)}</ul></section></div><section><div className="font-semibold">解题过程</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-stone-700">{selectedQuestion.solution || "未填写解析"}</p></section>{selectedQuestion.fileKey && <section className="flex items-center justify-between gap-3 border-y border-stone-200 py-4"><div><div className="font-semibold">题目附件</div><div className="mt-1 text-xs text-stone-500">附件仅向当前家庭账号开放</div></div><button onClick={() => openAttachment(selectedQuestion.id)} className="rounded-lg border border-teal px-4 py-2 text-sm text-teal">打开附件</button></section>}<section><div className="mb-3 flex items-center justify-between"><div className="font-semibold">学生作答记录</div><button onClick={() => copyPracticePrompt(selectedQuestion.questionTypeId, selectedQuestion.id)} className="inline-flex items-center gap-2 text-sm text-teal"><Copy size={16} />复制变式练习指令</button></div>{selectedQuestion.attempts?.length ? <div className="divide-y divide-stone-200 border-y border-stone-200">{selectedQuestion.attempts.map((item) => <div key={item.id} className="grid gap-2 py-3 text-sm md:grid-cols-[120px_100px_1fr]"><span className="font-medium">{item.child?.name || "学生"}</span><span className={item.isCorrect ? "text-teal" : "text-accent"}>{item.isCorrect ? "正确" : "待巩固"}{item.score !== undefined ? ` · ${item.score}分` : ""}</span><span className="text-stone-500">{item.errorReason || item.evaluation || "无补充评价"}</span></div>)}</div> : <p className="text-sm text-stone-500">还没有学生作答记录。</p>}</section></div></Modal>}

      {selectedType && <Modal title={selectedType.name} onClose={() => setSelectedType(null)} wide><div className="space-y-7"><div className="flex flex-wrap items-center gap-2"><span className="bg-teal/10 px-3 py-1 text-sm text-teal">{selectedType.subject}</span><span className="text-sm text-stone-500">{selectedType.grade || "全年级"} · 规则 v{selectedType.ruleVersion}</span><button onClick={() => copyPracticePrompt(selectedType.id)} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-teal px-3 py-2 text-sm text-teal"><Sparkles size={16} />复制练习指令</button></div><p className="text-base leading-8 text-stone-700">{selectedType.description || "尚未填写题型说明。"}</p><div className="grid gap-4 md:grid-cols-3"><section className="border-t-2 border-accent bg-white p-4"><div className="text-sm font-semibold">核心能力</div><p className="mt-3 text-sm leading-7 text-stone-600">{selectedType.abilityGoal || "未设置"}</p></section><section className="border-t-2 border-teal bg-white p-4"><div className="text-sm font-semibold">解题方法</div><p className="mt-3 text-sm leading-7 text-stone-600">{selectedType.solutionMethod || "未设置"}</p></section><section className="border-t-2 border-gold bg-white p-4"><div className="text-sm font-semibold">掌握门槛</div><p className="mt-3 text-sm leading-7 text-stone-600">至少 {(selectedType.masteryCriteria as any)?.minAttempts || 5} 次练习，覆盖 {(selectedType.masteryCriteria as any)?.minVariations || 3} 种变式，并通过迁移题和延迟复测。</p></section></div><div className="grid gap-6 md:grid-cols-2"><section><h3 className="font-semibold">标准步骤</h3><ol className="mt-3 space-y-3">{textLines(selectedType.standardSteps).map((line, index) => <li key={line} className="flex gap-3 text-sm leading-6"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal text-xs text-white">{index + 1}</span>{line}</li>)}</ol></section><section><h3 className="font-semibold">常见错误</h3><ul className="mt-3 space-y-3">{textLines(selectedType.commonErrors).map((line) => <li key={line} className="border-l-2 border-accent pl-3 text-sm leading-6 text-stone-600">{line}</li>)}</ul></section><section><h3 className="font-semibold">不可变化的结构</h3><ul className="mt-3 space-y-2">{textLines(selectedType.invariants).map((line) => <li key={line} className="text-sm leading-6">• {line}</li>)}</ul></section><section><h3 className="font-semibold">可变化参数</h3><ul className="mt-3 space-y-2">{textLines(selectedType.variableParameters).map((line) => <li key={line} className="text-sm leading-6">• {line}</li>)}</ul></section></div><section className="border-y border-stone-200 py-5"><h3 className="font-semibold">WorkBuddy 同题型生成规则</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-700">{pretty(selectedType.generationRule)}</p></section><section><h3 className="font-semibold">答案校验</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-600">{pretty(selectedType.answerValidation)}</p></section></div></Modal>}

      {editingMastery && <Modal title="调整掌握状态" onClose={() => setEditingMastery(null)}><form onSubmit={saveMastery} className="space-y-4"><div className="bg-white p-4"><div className="font-semibold">{editingMastery.child.name} · {editingMastery.questionType.name}</div><div className="mt-2 text-sm text-stone-500">系统计算：{STATUS_LABELS[editingMastery.calculatedStatus]}，{Math.round(editingMastery.masteryScore)} 分</div></div><label className="block text-sm">调整为<select name="status" defaultValue={editingMastery.status} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3">{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm">调整原因<textarea name="reason" required defaultValue={editingMastery.manualReason} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" placeholder="说明观察到的学习表现，便于后续追踪" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingMastery(null)} className="rounded-lg border border-stone-200 px-4 py-2">取消</button><button className="rounded-lg bg-teal px-5 py-2 text-white">保存调整</button></div></form></Modal>}
    </div>
  );
}
