import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookX,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Edit,
  Eye,
  FileText,
  GraduationCap,
  Printer,
  RefreshCw,
  Search,
  Target,
  Trash,
  X,
} from "lucide-react";

type Child = { id: string; name: string; grade: string };
type ApiRequest = (path: string, options?: RequestInit, token?: string) => Promise<any>;

const STATUS_LABELS: Record<string, string> = {
  pending_correction: "待订正",
  strengthening: "巩固中",
  mastered: "已掌握",
  needs_review: "需复习",
  archived: "已归档",
};
const PAPER_STATUS_LABELS: Record<string, string> = { draft: "草稿", ready: "待练习", in_progress: "练习中", completed: "已完成", archived: "已归档" };
const PLAN_STATUS_LABELS: Record<string, string> = { draft: "草稿", active: "进行中", completed: "已完成", archived: "已归档" };
const TASK_STATUS_LABELS: Record<string, string> = { pending: "待开始", in_progress: "进行中", completed: "已完成", skipped: "已跳过" };
const SUBJECTS = ["数学", "语文", "英语", "科学", "地理", "物理", "化学", "其他"];

function pretty(value: unknown) {
  if (value === undefined || value === null || value === "") return "未记录";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function lines(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item));
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}：${pretty(item)}`);
  return value ? [String(value)] : [];
}

function formatDate(value?: string) {
  if (!value) return "未安排";
  return new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function tone(status: string) {
  if (status === "mastered" || status === "completed") return "bg-teal/10 text-teal";
  if (status === "needs_review" || status === "pending_correction") return "bg-accent/10 text-accent";
  if (status === "strengthening" || status === "in_progress" || status === "active") return "bg-gold/25 text-amber-800";
  return "bg-stone-100 text-stone-600";
}

function Modal({ title, onClose, children, wide = false, printClass = "" }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; printClass?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17252a]/60 p-3 md:p-6 print:static print:block print:bg-white print:p-0">
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-lg bg-panel shadow-2xl print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:shadow-none ${wide ? "max-w-5xl" : "max-w-xl"} ${printClass}`}>
        <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-panel px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" title="关闭" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-stone-500 hover:bg-stone-100"><X size={19} /></button>
        </div>
        <div className="p-5 print:p-0">{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, detail }: { icon: any; title: string; detail: string }) {
  return <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-stone-300 bg-white/40 px-6 text-center"><Icon size={36} className="text-teal" /><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 max-w-lg text-sm leading-6 text-stone-500">{detail}</p></div>;
}

export default function WrongBook({ token, children, request }: { token: string; children: Child[]; request: ApiRequest }) {
  const [tab, setTab] = useState<"wrong" | "mastery" | "papers" | "plans">("wrong");
  const [wrongQuestions, setWrongQuestions] = useState<any[]>([]);
  const [papers, setPapers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ child_id: "", subject: "", status: "", query: "" });
  const [selectedWrong, setSelectedWrong] = useState<any | null>(null);
  const [editingWrong, setEditingWrong] = useState<any | null>(null);
  const [statusWrong, setStatusWrong] = useState<any | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<any | null>(null);
  const [paperMode, setPaperMode] = useState<"student" | "parent">("student");
  const [selectedPlan, setSelectedPlan] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const wrongParams = new URLSearchParams({ limit: "100" });
      Object.entries(filters).forEach(([key, value]) => { if (value) wrongParams.set(key, value); });
      const [wrong, paperData, planData] = await Promise.all([
        request(`/api/wrong-questions?${wrongParams}`, {}, token),
        request("/api/practice-papers?limit=100", {}, token),
        request("/api/remediation-plans?limit=100", {}, token),
      ]);
      setWrongQuestions(wrong.items || []);
      setPapers(paperData.items || []);
      setPlans(planData.items || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters, request, token]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    total: wrongQuestions.length,
    pending: wrongQuestions.filter((item) => item.status === "pending_correction").length,
    strengthening: wrongQuestions.filter((item) => item.status === "strengthening").length,
    mastered: wrongQuestions.filter((item) => item.status === "mastered").length,
    review: wrongQuestions.filter((item) => item.status === "needs_review").length,
  }), [wrongQuestions]);

  async function openWrong(id: string) {
    setSelectedWrong(await request(`/api/wrong-questions/${id}`, {}, token));
  }

  async function openPaper(id: string) {
    setPaperMode("student");
    setSelectedPaper(await request(`/api/practice-papers/${id}`, {}, token));
  }

  async function openPlan(id: string) {
    setSelectedPlan(await request(`/api/remediation-plans/${id}`, {}, token));
  }

  async function submitWrongEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form.entries());
    data.knowledge_points = String(data.knowledge_points || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean) as any;
    const saved = await request(`/api/wrong-questions/${editingWrong.id}`, { method: "PATCH", body: JSON.stringify(data) }, token);
    setEditingWrong(null); setSelectedWrong(saved); await load();
  }

  async function submitStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await request(`/api/wrong-questions/${statusWrong.id}/status`, { method: "PATCH", body: JSON.stringify({ status: form.get("status"), reason: form.get("reason"), source: "parent" }) }, token);
    setStatusWrong(null); setSelectedWrong(saved); await load();
  }

  async function clearStatus(item: any) {
    await request(`/api/wrong-questions/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ clear_manual_override: true }) }, token);
    setSelectedWrong(await request(`/api/wrong-questions/${item.id}`, {}, token)); await load();
  }

  async function removeWrong(item: any) {
    if (!window.confirm("确定删除这条错题吗？已有练习证据时系统会改为归档并保留历史。")) return;
    await request(`/api/wrong-questions/${item.id}`, { method: "DELETE" }, token);
    setSelectedWrong(null); await load();
  }

  async function archivePaper(item: any) {
    if (!window.confirm("确定删除这份练习试卷吗？已有作答时系统会归档。")) return;
    await request(`/api/practice-papers/${item.id}`, { method: "DELETE" }, token); setSelectedPaper(null); await load();
  }

  async function archivePlan(item: any) {
    if (!window.confirm("确定删除这份教学规划吗？已有完成证据时系统会归档。")) return;
    await request(`/api/remediation-plans/${item.id}`, { method: "DELETE" }, token); setSelectedPlan(null); await load();
  }

  async function updateTask(task: any, status: string) {
    await request(`/api/remediation-plans/${selectedPlan.id}/tasks/${task.id}/status`, { method: "PATCH", body: JSON.stringify({ status, completion_evidence: { source: "parent_web", updated_at: new Date().toISOString() } }) }, token);
    await openPlan(selectedPlan.id); await load();
  }

  const tabs = [
    { id: "wrong", label: "错题列表", icon: BookX },
    { id: "mastery", label: "掌握进度", icon: Target },
    { id: "papers", label: "练习试卷", icon: FileText },
    { id: "plans", label: "教学规划", icon: GraduationCap },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[["错题总数", stats.total], ["待订正", stats.pending], ["巩固中", stats.strengthening], ["已掌握", stats.mastered], ["需复习", stats.review]].map(([label, count], index) => (
          <div key={label} className={`border-t-2 bg-panel p-4 ${index === 1 || index === 4 ? "border-accent" : index === 3 ? "border-teal" : "border-gold"}`}><div className="text-xs text-stone-500">{label}</div><div className="mt-2 text-2xl font-bold">{count}</div></div>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-stone-200">
        {tabs.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} className={`flex min-w-max items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${tab === item.id ? "border-teal text-teal" : "border-transparent text-stone-500"}`}><Icon size={17} />{item.label}</button>; })}
        <button title="刷新" onClick={load} className="ml-auto grid min-h-11 min-w-11 place-items-center text-stone-500"><RefreshCw size={17} /></button>
      </div>

      {error && <div className="border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent">{error}</div>}

      {tab === "wrong" && <div className="grid gap-3 bg-panel p-4 md:grid-cols-[1fr_1fr_1fr_2fr_auto]">
        <select aria-label="筛选学生" value={filters.child_id} onChange={(event) => setFilters({ ...filters, child_id: event.target.value })} className="h-10 rounded-lg border border-stone-200 px-3 text-sm"><option value="">全部学生</option>{children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</select>
        <select aria-label="筛选学科" value={filters.subject} onChange={(event) => setFilters({ ...filters, subject: event.target.value })} className="h-10 rounded-lg border border-stone-200 px-3 text-sm"><option value="">全部学科</option>{SUBJECTS.map((subject) => <option key={subject}>{subject}</option>)}</select>
        <select aria-label="筛选状态" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="h-10 rounded-lg border border-stone-200 px-3 text-sm"><option value="">进行中的错题</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <label className="relative"><Search size={16} className="absolute left-3 top-3 text-stone-400" /><input aria-label="搜索错题" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="搜索题干、错误原因或知识点" className="h-10 w-full rounded-lg border border-stone-200 pl-9 pr-3 text-sm" /></label>
        <button onClick={load} className="h-10 rounded-lg bg-teal px-4 text-sm text-white">查询</button>
      </div>}

      {!loading && tab === "wrong" && (wrongQuestions.length ? <div className="overflow-x-auto border border-stone-200 bg-panel"><table className="w-full min-w-[900px] text-sm"><thead className="bg-[#23353b] text-left text-white"><tr><th className="px-4 py-3">学生 / 学科</th><th className="px-4 py-3">错题</th><th className="px-4 py-3">错误诊断</th><th className="px-4 py-3">掌握状态</th><th className="px-4 py-3">记录</th><th className="px-4 py-3">操作</th></tr></thead><tbody>{wrongQuestions.map((item) => <tr key={item.id} className="border-t border-stone-200 align-top"><td className="px-4 py-4 font-semibold">{item.child.name}<div className="mt-1 text-xs font-normal text-stone-500">{item.subject} · {item.grade || item.child.grade}</div></td><td className="max-w-sm px-4 py-4"><button onClick={() => openWrong(item.id)} className="line-clamp-3 text-left font-medium leading-6 hover:text-teal">{item.question.stem}</button><div className="mt-2 text-xs text-stone-500">{item.questionType.name} · {item.knowledgePoints?.join("、") || "未标知识点"}</div></td><td className="max-w-xs px-4 py-4 text-stone-600"><div className="font-medium text-ink">{item.errorCategory || "待分类"}</div><p className="mt-1 line-clamp-2 text-xs leading-5">{item.errorReason || "待补充错误原因"}</p></td><td className="px-4 py-4"><span className={`inline-block px-2 py-1 text-xs ${tone(item.status)}`}>{STATUS_LABELS[item.status]}</span><div className="mt-2 h-2 w-28 overflow-hidden rounded-full bg-stone-100"><div className="h-full bg-teal" style={{ width: `${Math.min(100, item.masteryScore || 0)}%` }} /></div><div className="mt-1 text-xs text-stone-500">{Math.round(item.masteryScore || 0)} 分</div></td><td className="px-4 py-4 text-xs leading-6 text-stone-500">错 {item.mistakeCount} 次<br />最近 {formatDate(item.lastWrongAt)}<br />练习 {item._count?.attempts || 0} 次</td><td className="px-4 py-4"><div className="flex gap-1"><button title="查看详情" onClick={() => openWrong(item.id)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-stone-100"><Eye size={17} /></button><button title="编辑错题信息" onClick={() => setEditingWrong(item)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-stone-100"><Edit size={17} /></button><button title="删除或归档" onClick={() => removeWrong(item)} className="grid h-9 w-9 place-items-center rounded-lg text-accent"><Trash size={17} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={BookX} title="还没有错题" detail="请在 WorkBuddy 中让孩子作答，并明确说“把这道错题同步到禾芽”。WorkBuddy 会通过家庭专属 MCP 写入题目、错误原因与作答证据。" />)}

      {!loading && tab === "mastery" && (wrongQuestions.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{wrongQuestions.map((item) => { const evidence = item.masteryEvidence || {}; return <button key={item.id} onClick={() => openWrong(item.id)} className="border border-stone-200 bg-panel p-5 text-left hover:border-teal"><div className="flex items-start justify-between gap-3"><div><div className="text-xs text-stone-500">{item.child.name} · {item.subject}</div><div className="mt-1 font-semibold">{item.questionType.name}</div></div><span className={`shrink-0 px-2 py-1 text-xs ${tone(item.status)}`}>{STATUS_LABELS[item.status]}</span></div><p className="mt-4 line-clamp-2 text-sm leading-6 text-stone-600">{item.question.stem}</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full bg-teal" style={{ width: `${Math.min(100, item.masteryScore || 0)}%` }} /></div><div className="mt-2 flex justify-between text-xs text-stone-500"><span>{Math.round(item.masteryScore || 0)} 分</span><span>下次复习 {formatDate(item.nextReviewAt)}</span></div><div className="mt-4 grid grid-cols-3 gap-2 border-t border-stone-200 pt-3 text-center text-xs"><div><b className="block text-base text-ink">{evidence.independentCorrectVariants || 0}</b>独立变式</div><div><b className="block text-base text-ink">{evidence.sessions || 0}</b>练习会话</div><div><b className="block text-base text-ink">{evidence.delayedReviewPassed ? "通过" : "未通过"}</b>延迟复测</div></div></button>; })}</div> : <EmptyState icon={Target} title="还没有掌握进度" detail="错题同步并产生订正、变式练习和延迟复测后，这里会显示每个学生独立的掌握证据。" />)}

      {!loading && tab === "papers" && (papers.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{papers.map((paper) => <article key={paper.id} className="border-t-2 border-gold bg-panel p-5"><div className="flex items-start justify-between gap-3"><div className="text-xs text-stone-500">{paper.child.name} · {paper.subject || "综合"}</div><span className={`px-2 py-1 text-xs ${tone(paper.status)}`}>{PAPER_STATUS_LABELS[paper.status] || paper.status}</span></div><h3 className="mt-3 text-lg font-bold">{paper.title}</h3><p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-600">{paper.objective || paper.diagnosisSummary || "针对错题薄弱点生成的练习"}</p><div className="mt-4 flex gap-4 border-y border-stone-200 py-3 text-xs text-stone-500"><span>{paper._count?.questions || 0} 道题</span><span>{paper.estimatedMinutes || "-"} 分钟</span><span>{paper.totalScore || "-"} 分</span></div><div className="mt-4 flex justify-between"><button onClick={() => openPaper(paper.id)} className="inline-flex items-center gap-1 text-sm text-teal">查看与打印<ChevronRight size={16} /></button><button title="删除或归档试卷" onClick={() => archivePaper(paper)} className="text-accent"><Trash size={17} /></button></div></article>)}</div> : <EmptyState icon={FileText} title="还没有针对性试卷" detail="WorkBuddy 读取错题练习上下文、生成并校验题目后，可以将完整试卷同步到这里供家长查看与打印。" />)}

      {!loading && tab === "plans" && (plans.length ? <div className="space-y-4">{plans.map((plan) => <button key={plan.id} onClick={() => openPlan(plan.id)} className="grid w-full gap-4 border border-stone-200 bg-panel p-5 text-left md:grid-cols-[1fr_auto] md:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className={`px-2 py-1 text-xs ${tone(plan.status)}`}>{PLAN_STATUS_LABELS[plan.status] || plan.status}</span><span className="text-xs text-stone-500">{plan.child.name} · {plan.subject || "综合"}</span></div><h3 className="mt-3 text-lg font-bold">{plan.title}</h3><p className="mt-2 text-sm text-stone-500">{formatDate(plan.startDate)} 至 {formatDate(plan.endDate)} · {plan._count?.tasks || 0} 个任务</p></div><ChevronRight className="text-teal" /></button>)}</div> : <EmptyState icon={GraduationCap} title="还没有错题教学规划" detail="WorkBuddy 可依据错题证据、题型规则和学生掌握度生成分阶段教学任务，并同步到这里追踪执行。" />)}

      {loading && <div className="grid min-h-48 place-items-center text-sm text-stone-500">正在读取家庭错题数据...</div>}

      {selectedWrong && <Modal title="错题详情" onClose={() => setSelectedWrong(null)} wide><div className="space-y-7"><div className="flex flex-wrap items-center gap-2"><span className="bg-teal/10 px-3 py-1 text-sm text-teal">{selectedWrong.child.name}</span><span className="bg-stone-100 px-3 py-1 text-sm">{selectedWrong.subject} · {selectedWrong.questionType.name}</span><span className={`px-3 py-1 text-sm ${tone(selectedWrong.status)}`}>{STATUS_LABELS[selectedWrong.status]}</span><div className="ml-auto flex gap-2"><button onClick={() => setEditingWrong(selectedWrong)} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-sm"><Edit size={16} />编辑</button><button onClick={() => setStatusWrong(selectedWrong)} className="rounded-lg border border-teal px-3 py-2 text-sm text-teal">调整状态</button></div></div><section><div className="text-xs font-bold text-stone-400">原题</div><div className="mt-3 whitespace-pre-wrap border-l-4 border-gold bg-white px-5 py-5 text-lg font-semibold leading-8">{selectedWrong.question.stem}</div>{selectedWrong.question.options && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap bg-white p-4 text-sm">{pretty(selectedWrong.question.options)}</pre>}</section><div className="grid gap-4 md:grid-cols-2"><section className="border-t-2 border-accent bg-white p-5"><div className="font-semibold text-accent">当时的错误</div><div className="mt-4 text-xs font-semibold text-stone-400">错误答案</div><pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-7">{pretty(selectedWrong.latestWrongAnswer)}</pre><div className="mt-4 text-xs font-semibold text-stone-400">错误原因</div><p className="mt-2 text-sm leading-7">{selectedWrong.errorReason || "待补充"}</p><p className="mt-2 text-xs text-stone-500">分类：{selectedWrong.errorCategory || "待分类"}</p></section><section className="border-t-2 border-teal bg-white p-5"><div className="font-semibold text-teal">正确理解</div><div className="mt-4 text-xs font-semibold text-stone-400">标准答案</div><pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-7">{pretty(selectedWrong.question.answer)}</pre><div className="mt-4 text-xs font-semibold text-stone-400">解题解析</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{selectedWrong.question.solution || "未填写解析"}</p></section></div><section className="grid gap-4 md:grid-cols-3"><div className="border-t-2 border-gold bg-white p-4"><div className="text-xs font-semibold text-stone-400">WorkBuddy 分析</div><p className="mt-3 text-sm leading-6">{selectedWrong.workbuddyAnalysis || "待补充"}</p></div><div className="border-t-2 border-teal bg-white p-4"><div className="text-xs font-semibold text-stone-400">订正方法</div><p className="mt-3 text-sm leading-6">{selectedWrong.correctionMethod || "待补充"}</p></div><div className="border-t-2 border-accent bg-white p-4"><div className="text-xs font-semibold text-stone-400">关键学习点</div><p className="mt-3 text-sm leading-6">{selectedWrong.keyLearningPoint || "待补充"}</p></div></section><section><div className="flex items-end justify-between"><div><h3 className="font-semibold">掌握证据</h3><p className="mt-1 text-xs text-stone-500">单次答对不会自动判定掌握</p></div><strong className="text-2xl text-teal">{Math.round(selectedWrong.masteryScore || 0)} 分</strong></div><div className="mt-3 h-3 overflow-hidden rounded-full bg-stone-100"><div className="h-full bg-teal" style={{ width: `${Math.min(100, selectedWrong.masteryScore || 0)}%` }} /></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">{[["原题订正", selectedWrong.masteryEvidence?.originalCorrectionPassed ? "已通过" : "未通过"], ["独立变式", `${selectedWrong.masteryEvidence?.independentCorrectVariants || 0}/3`], ["练习会话", `${selectedWrong.masteryEvidence?.sessions || 0}/2`], ["迁移题", selectedWrong.masteryEvidence?.transferPassed ? "已通过" : "未通过"], ["延迟复测", selectedWrong.masteryEvidence?.delayedReviewPassed ? "已通过" : "未通过"]].map(([label, value]) => <div key={label} className="bg-white p-3"><div className="text-xs text-stone-400">{label}</div><div className="mt-1 font-semibold">{value}</div></div>)}</div></section><section><h3 className="font-semibold">练习时间线</h3>{selectedWrong.attempts?.length ? <div className="mt-3 border-l-2 border-stone-200 pl-5">{[...selectedWrong.attempts].reverse().map((attempt: any) => <div key={attempt.id} className="relative border-b border-dashed border-stone-200 py-3 before:absolute before:-left-[25px] before:top-5 before:h-2 before:w-2 before:rounded-full before:bg-teal"><div className="flex flex-wrap items-center gap-2 text-sm"><span className={attempt.isCorrect ? "font-semibold text-teal" : "font-semibold text-accent"}>{attempt.isCorrect ? "答对" : "答错"}</span><span>{attempt.isOriginalCorrection ? "原题订正" : attempt.variationType || attempt.question?.variationType || "练习"}</span><span className="text-stone-400">{formatDate(attempt.attemptedAt)}</span></div><p className="mt-1 text-xs text-stone-500">{attempt.evaluation || attempt.errorReason || "无补充评价"}</p></div>)}</div> : <p className="mt-3 text-sm text-stone-500">尚无订正或变式练习记录。</p>}</section><div className="flex flex-wrap justify-between gap-3 border-t border-stone-200 pt-4"><div className="text-xs leading-6 text-stone-500">首次出错 {formatDate(selectedWrong.firstWrongAt)} · 累计 {selectedWrong.mistakeCount} 次<br />下次复习 {formatDate(selectedWrong.nextReviewAt)}</div><div className="flex gap-2">{selectedWrong.manualStatus && <button onClick={() => clearStatus(selectedWrong)} className="rounded-lg border border-stone-200 px-3 py-2 text-sm">恢复自动判定</button>}<button onClick={() => removeWrong(selectedWrong)} className="inline-flex items-center gap-1 rounded-lg border border-accent px-3 py-2 text-sm text-accent"><Archive size={16} />删除或归档</button></div></div></div></Modal>}

      {editingWrong && <Modal title="编辑错题信息" onClose={() => setEditingWrong(null)}><form onSubmit={submitWrongEdit} className="space-y-4"><label className="block text-sm">章节<input name="chapter" defaultValue={editingWrong.chapter || ""} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="block text-sm">知识点<input name="knowledge_points" defaultValue={editingWrong.knowledgePoints?.join("、") || ""} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="block text-sm">错误分类<input name="error_category" defaultValue={editingWrong.errorCategory || ""} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3" /></label><label className="block text-sm">错误原因<textarea name="error_reason" defaultValue={editingWrong.errorReason || ""} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" /></label><label className="block text-sm">WorkBuddy 分析<textarea name="workbuddy_analysis" defaultValue={editingWrong.workbuddyAnalysis || ""} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" /></label><label className="block text-sm">订正方法<textarea name="correction_method" defaultValue={editingWrong.correctionMethod || ""} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" /></label><label className="block text-sm">关键学习点<textarea name="key_learning_point" defaultValue={editingWrong.keyLearningPoint || ""} className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingWrong(null)} className="rounded-lg border border-stone-200 px-4 py-2">取消</button><button className="rounded-lg bg-teal px-5 py-2 text-white">保存</button></div></form></Modal>}

      {statusWrong && <Modal title="调整错题状态" onClose={() => setStatusWrong(null)}><form onSubmit={submitStatus} className="space-y-4"><div className="bg-white p-4"><div className="font-semibold">系统判定：{STATUS_LABELS[statusWrong.calculatedStatus]}</div><div className="mt-1 text-sm text-stone-500">{Math.round(statusWrong.masteryScore || 0)} 分，人工调整不会删除系统证据。</div></div><label className="block text-sm">调整为<select name="status" defaultValue={statusWrong.status} className="mt-1 h-10 w-full rounded-lg border border-stone-200 px-3">{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm">调整原因<textarea name="reason" required className="mt-1 h-24 w-full rounded-lg border border-stone-200 p-3" placeholder="填写观察到的学习表现或调整原因" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setStatusWrong(null)} className="rounded-lg border border-stone-200 px-4 py-2">取消</button><button className="rounded-lg bg-teal px-5 py-2 text-white">保存调整</button></div></form></Modal>}

      {selectedPaper && <Modal title={selectedPaper.title} onClose={() => setSelectedPaper(null)} wide printClass="print-paper"><div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex rounded-lg border border-stone-200 p-1"><button onClick={() => setPaperMode("student")} className={`rounded-md px-3 py-2 text-sm ${paperMode === "student" ? "bg-teal text-white" : ""}`}>学生版</button><button onClick={() => setPaperMode("parent")} className={`rounded-md px-3 py-2 text-sm ${paperMode === "parent" ? "bg-teal text-white" : ""}`}>家长版</button></div><div className="flex gap-2"><button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm text-white"><Printer size={16} />打印</button><button title="删除或归档" onClick={() => archivePaper(selectedPaper)} className="grid h-10 w-10 place-items-center rounded-lg border border-accent text-accent"><Trash size={17} /></button></div></div><div className="mx-auto max-w-4xl bg-white px-5 py-8 text-[#1f2933] print:max-w-none print:px-0"><header className="border-b-2 border-[#23353b] pb-5 text-center"><div className="text-sm tracking-widest">禾芽家庭教务 · 针对性练习</div><h1 className="mt-3 text-2xl font-bold">{selectedPaper.title}</h1><div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm"><span>学生：{selectedPaper.child.name}</span><span>学科：{selectedPaper.subject || "综合"}</span><span>时间：{selectedPaper.estimatedMinutes || "-"} 分钟</span><span>满分：{selectedPaper.totalScore || "-"} 分</span></div></header>{paperMode === "parent" && <section className="my-6 border-l-4 border-gold bg-[#fffaf0] p-4"><h2 className="font-bold">练习目标与诊断</h2><p className="mt-2 text-sm leading-7">{selectedPaper.objective || "巩固错题对应的核心能力"}</p><p className="mt-2 text-sm leading-7 text-stone-600">{selectedPaper.diagnosisSummary || "暂无补充诊断"}</p></section>}<div className="mt-7 space-y-8">{selectedPaper.questions.map((item: any, index: number) => <section key={item.id} className="break-inside-avoid"><div className="flex gap-3"><span className="font-bold">{index + 1}.</span><div className="min-w-0 flex-1"><div className="whitespace-pre-wrap text-base font-medium leading-8">{item.question.stem}</div>{item.question.options && <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-7">{pretty(item.question.options)}</pre>}<div className="mt-6 min-h-20 border-b border-dashed border-stone-300" />{paperMode === "parent" && <div className="mt-4 border-l-3 border-teal bg-[#f2fbf8] p-4 text-sm"><div className="font-bold text-teal">答案与解析</div><pre className="mt-2 whitespace-pre-wrap font-sans leading-7">{pretty(item.question.answer)}</pre><p className="mt-2 whitespace-pre-wrap leading-7">{item.question.solution || "未填写解析"}</p><p className="mt-2 text-xs text-stone-500">目的：{item.purpose || "巩固题型"} · {item.score || "-"} 分</p></div>}</div></div></section>)}</div></div></Modal>}

      {selectedPlan && <Modal title={selectedPlan.title} onClose={() => setSelectedPlan(null)} wide><div className="space-y-7"><div className="flex flex-wrap items-center gap-2"><span className="bg-teal/10 px-3 py-1 text-sm text-teal">{selectedPlan.child.name}</span><span className="bg-stone-100 px-3 py-1 text-sm">{selectedPlan.subject || "综合"}</span><span className={`px-3 py-1 text-sm ${tone(selectedPlan.status)}`}>{PLAN_STATUS_LABELS[selectedPlan.status] || selectedPlan.status}</span><button title="删除或归档" onClick={() => archivePlan(selectedPlan)} className="ml-auto grid h-9 w-9 place-items-center rounded-lg border border-accent text-accent"><Trash size={17} /></button></div><div className="grid gap-4 md:grid-cols-3"><section className="border-t-2 border-accent bg-white p-4"><div className="text-xs font-semibold text-stone-400">诊断</div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-7">{pretty(selectedPlan.diagnosis)}</pre></section><section className="border-t-2 border-teal bg-white p-4"><div className="text-xs font-semibold text-stone-400">教学目标</div><ul className="mt-3 space-y-2 text-sm leading-6">{lines(selectedPlan.objectives).map((line) => <li key={line}>• {line}</li>)}</ul></section><section className="border-t-2 border-gold bg-white p-4"><div className="text-xs font-semibold text-stone-400">执行策略</div><p className="mt-3 text-sm leading-7">{selectedPlan.strategy || "未填写"}</p></section></div><section><div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="font-semibold">教学任务</h3><p className="mt-1 text-xs text-stone-500">{formatDate(selectedPlan.startDate)} 至 {formatDate(selectedPlan.endDate)}</p></div><span className="text-sm text-stone-500">完成 {selectedPlan.tasks.filter((task: any) => task.status === "completed").length}/{selectedPlan.tasks.length}</span></div><div className="mt-4 space-y-3">{selectedPlan.tasks.map((task: any, index: number) => <div key={task.id} className="grid gap-3 border border-stone-200 bg-white p-4 md:grid-cols-[40px_1fr_auto] md:items-center"><span className={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold ${task.status === "completed" ? "bg-teal text-white" : "bg-stone-100"}`}>{task.status === "completed" ? <CheckCircle2 size={18} /> : index + 1}</span><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{task.title}</h4><span className={`px-2 py-1 text-xs ${tone(task.status)}`}>{TASK_STATUS_LABELS[task.status] || task.status}</span></div><p className="mt-1 text-sm leading-6 text-stone-600">{task.description || "无补充说明"}</p><div className="mt-2 text-xs text-stone-400">{task.taskType} · {task.estimatedMinutes || "-"} 分钟 · 截止 {formatDate(task.dueAt)}</div></div><select aria-label="更新任务状态" value={task.status} onChange={(event) => updateTask(task, event.target.value)} className="no-print h-10 rounded-lg border border-stone-200 px-3 text-sm">{Object.entries(TASK_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>)}</div></section></div></Modal>}
    </div>
  );
}
