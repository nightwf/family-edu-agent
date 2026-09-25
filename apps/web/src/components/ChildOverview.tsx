import { useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { PageId } from "./Layout";
import { buildPlanningCard, type PlanningCard } from "../lib/planning";
import { dailyScene, formatDate, stateAsset } from "../lib/presentation";
import { mapOverall, mapSubjectRows, pickCharacterState, subjectTone, type SubjectRow } from "../lib/subjects";

type Child = { id: string; name: string; gender?: string; age: number; grade: string; subjects: string[]; textbookVersion?: string };

type Props = {
  token: string;
  children: Child[];
  home?: any;
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
  onNavigate: (page: PageId) => void;
  onOpenSubject: (target: { childId: string; subject: string }) => void;
  familyName?: string;
};

/**
 * 电脑端首页，信息结构以小程序首页为基准：
 * 1. 孩子整体状态（结论 + 关键数字 + 形象）
 * 2. 各学科情况（主体，可进入学科详情看后续规划建议）
 * 3. 学习计划待规划提示与最近学习任务（次要）
 * 亲子关系、待确认证据这类内容放在二级页面，不在首页堆叠。
 */
export default function ChildOverview({ token, children, home, request, onNavigate, onOpenSubject, familyName }: Props) {
  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id || "");
  const [detail, setDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planningError, setPlanningError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setSelectedChildId((current) => (children.some((child) => child.id === current) ? current : children[0]?.id || ""));
  }, [children]);

  useEffect(() => {
    if (!selectedChildId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setImageFailed(false);
    request(`/api/home?child_id=${selectedChildId}`, {}, token)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setDetail(null);
          setError((err as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChildId, token, request, reloadKey]);

  const activeChild = useMemo(
    () => children.find((child) => child.id === selectedChildId) || children[0] || null,
    [children, selectedChildId],
  );

  const overview = detail?.subject_overview || null;
  const rawSubjects = (overview?.subjects || []) as any[];
  const subjects = useMemo(() => mapSubjectRows(rawSubjects), [detail]);
  const evidenceCount = detail?.child_state?.summary?.evidence_7d ?? null;
  const overall = useMemo(() => mapOverall(overview?.overall, evidenceCount), [detail]);
  const characterImage = useMemo(
    () => stateAsset(pickCharacterState(rawSubjects), activeChild?.gender),
    [detail, activeChild?.gender],
  );
  const scene = useMemo(() => dailyScene(activeChild?.id, new Date()), [activeChild?.id]);
  const planningCard: PlanningCard | null = useMemo(
    () => buildPlanningCard(activeChild, detail?.learning_priorities, detail?.planning_request),
    [activeChild, detail],
  );
  const pendingTasks = useMemo(() => {
    const rows = (detail?.homework || home?.homework || []).filter(
      (item: any) => !activeChild || item.childId === activeChild.id,
    );
    return rows.filter((item: any) => !["done", "cancelled"].includes(item.status)).slice(0, 3);
  }, [detail, home, activeChild]);

  async function generatePlan() {
    if (!planningCard?.canGenerate || planningBusy) return;
    setPlanningBusy(true);
    setPlanningError("");
    try {
      await request(`/api/v2/planning-requests/${planningCard.id}/generate-ai`, { method: "POST" }, token);
      setReloadKey((value) => value + 1);
    } catch (err) {
      setPlanningError((err as Error).message);
    } finally {
      setPlanningBusy(false);
    }
  }

  async function confirmPlan() {
    if (!planningCard?.canConfirm || planningBusy) return;
    if (!window.confirm("确认后，这份阶段目标和本周任务会正式开始执行。是否确认？")) return;
    setPlanningBusy(true);
    setPlanningError("");
    try {
      await request(`/api/v2/planning-requests/${planningCard.id}/confirm-ai`, { method: "POST" }, token);
      setReloadKey((value) => value + 1);
    } catch (err) {
      setPlanningError((err as Error).message);
    } finally {
      setPlanningBusy(false);
    }
  }

  if (children.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-panel p-8 text-center">
        <div className="font-bold text-ink">还没有学生档案</div>
        <p className="mt-2 text-sm text-muted">先添加孩子，学习记录才能准确归到同一个孩子名下。</p>
        <button
          onClick={() => onNavigate("students")}
          className="mt-4 rounded-lg bg-teal px-4 py-2 text-sm font-bold text-white"
        >
          添加学生
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted">{formatDate(new Date())}</div>
          <h1 className="mt-1 text-2xl font-black text-ink md:text-[28px]">{familyName || "禾芽家庭教务"}</h1>
        </div>
        <div className="flex items-center gap-2">
          {children.length > 1 ? (
            <select
              aria-label="切换孩子"
              value={selectedChildId}
              onChange={(event) => setSelectedChildId(event.target.value)}
              className="rounded-full border border-[#d7e7e2] bg-white/85 px-3 py-2 text-sm font-bold text-teal"
            >
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name} · {child.grade || "未设置年级"}
                </option>
              ))}
            </select>
          ) : (
            <span className="rounded-full border border-line bg-white/70 px-3 py-2 text-sm font-bold text-[#58716f]">
              {activeChild?.name}
            </span>
          )}
          <button
            onClick={() => setReloadKey((value) => value + 1)}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-white/70 px-3 py-2 text-sm text-teal"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />刷新
          </button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-orange-200 bg-accent-soft px-4 py-3 text-sm text-accent">{error}</div>}

      <section
        data-testid="child-hero"
        className="relative overflow-hidden rounded-[28px] bg-[#d9eee7] bg-cover bg-center shadow-[0_24px_54px_rgba(37,75,70,0.16)]"
        style={{ backgroundImage: `url('${scene}')` }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(12,58,55,0.94)_0%,rgba(16,70,66,0.88)_44%,rgba(26,86,79,0.46)_100%)]" />
        <div className="relative z-[2] flex min-h-[340px] flex-col justify-between gap-4 p-5 md:min-h-[360px] md:p-8">
          <div className="flex items-stretch gap-4">
            <div className="w-[60%] text-white md:w-[58%]">
              <div className="text-xs font-extrabold text-[#cfe7e2]">孩子整体状态</div>
              <h2 className="mt-2 text-xl font-black leading-snug md:text-[30px]">{overall.conclusion}</h2>
              {overall.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {overall.tags.map((tag: string) => (
                    <span key={tag} className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* 人物形象单独占一列，绝对不会压到左侧结论或下方指标条 */}
            <div className="relative min-h-[150px] flex-1 md:min-h-[220px]">
              <img
                src={characterImage}
                alt=""
                aria-hidden="true"
                onError={() => setImageFailed(true)}
                className={`pointer-events-none absolute inset-0 h-full w-full object-contain object-bottom ${
                  imageFailed ? "hidden" : ""
                } ${loading ? "" : "motion-safe:animate-[child-breathe_3.6s_ease-in-out_infinite]"}`}
              />
            </div>
          </div>
          <div data-testid="child-hero-metrics" className="hero-metrics-grid rounded-2xl bg-white/15 px-2 py-3 md:px-3 md:py-4">
            {overall.metrics.map((metric) => (
              <div key={metric.label} className="text-center text-white">
                <div className="text-xl font-black text-gold md:text-[28px]">{metric.value}</div>
                <div className="mt-1 text-[10px] leading-tight text-[#dceceb] md:text-[11px]">{metric.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section data-testid="subject-section">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-black text-ink">各学科情况</h2>
          <button onClick={() => onNavigate("child-state")} className="text-sm font-bold text-teal">
            学习诊断
          </button>
        </div>
        {subjects.length === 0 ? (
          <div className="rounded-2xl border border-line bg-panel p-5 text-sm text-muted">
            还没有学科记录。让 WorkBuddy 同步一次作业或错题后，这里会显示每一科的情况。
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {subjects.map((row: SubjectRow) => (
              <SubjectCard
                key={row.subject}
                row={row}
                onOpen={() => activeChild && onOpenSubject({ childId: activeChild.id, subject: row.subject })}
              />
            ))}
          </div>
        )}
      </section>

      {planningCard && (
        <section className="rounded-2xl border border-line bg-panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-extrabold text-accent">学习计划</div>
            <span className="rounded-full bg-gold-soft px-3 py-1 text-xs font-bold text-[#7d5a12]">{planningCard.statusText}</span>
          </div>
          <div className="mt-3 rounded-2xl bg-gold-soft p-4">
            <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-base font-black text-ink">{planningCard.focusText}</div>
              <div className="mt-1.5 text-sm leading-6 text-[#7d5a12]">{planningCard.reason}</div>
            </div>
            {(planningCard.canGenerate || planningCard.canConfirm) && (
              <button
                onClick={planningCard.canConfirm ? confirmPlan : generatePlan}
                disabled={planningBusy}
                className="shrink-0 rounded-lg bg-teal px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {planningBusy ? "处理中..." : planningCard.actionText}
              </button>
            )}
            </div>
            {planningCard.draft && (
              <div className="mt-4 border-t border-[#ead9aa] pt-4">
                <div className="text-sm font-bold text-ink">{planningCard.draft.summary}</div>
                <div className="mt-1 text-xs leading-5 text-muted">{planningCard.draft.rationale}</div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {(planningCard.draft.week_items || []).map((item: any, index: number) => (
                    <div key={item.id || index} className="rounded-xl bg-white/75 px-3 py-2.5">
                      <div className="text-sm font-bold text-ink">{index + 1}. {item.title}</div>
                      <div className="mt-1 text-xs text-muted">约 {item.estimated_minutes || "-"} 分钟</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(planningCard.error || planningError) && (
              <div className="mt-3 text-sm text-accent">{planningError || planningCard.error}</div>
            )}
          </div>
        </section>
      )}

      {pendingTasks.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-black text-ink">最近学习任务</h2>
            <button onClick={() => onNavigate("homework")} className="text-sm font-bold text-teal">
              全部
            </button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-panel">
            {pendingTasks.map((item: any) => (
              <button
                key={item.id}
                onClick={() => onNavigate("homework")}
                className="flex w-full items-center gap-3 border-b border-line-soft px-4 py-3 text-left last:border-b-0 hover:bg-teal-soft/40"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-soft text-sm font-black text-[#7f5c13]">
                  {String(item.subject || "任").slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{item.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {item.dueDate ? `${formatDate(item.dueDate)} 前` : "未设置截止时间"}
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" />
              </button>
            ))}
          </div>
        </section>
      )}

      {detail?.learning_priorities?.planning_required && !planningCard && (
        <p className="text-sm text-muted">学习记录显示需要重新规划，补充更多练习后可由 AI 直接生成计划草稿。</p>
      )}
    </div>
  );
}

function SubjectCard({ row, onOpen }: { row: SubjectRow; onOpen: () => void }) {
  const tone = subjectTone(row.statusClass);
  return (
    <button data-testid="subject-card" onClick={onOpen} className={`rounded-2xl border p-5 text-left transition hover:shadow-[0_12px_28px_rgba(38,52,59,0.08)] ${tone.card}`}>
      <div className="flex items-center gap-3">
        <span className="text-xl font-black text-ink">{row.subject}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${tone.pill}`}>{row.status_text}</span>
        {row.hasScore && (
          <span className={`ml-auto text-2xl font-black ${tone.score}`}>
            {row.scoreText}
            <span className="ml-0.5 text-xs font-bold text-muted">分</span>
          </span>
        )}
      </div>
      {row.hasScore && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eef2f0]">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${row.scorePercent}%` }} />
        </div>
      )}
      <div className="mt-3 text-xs text-muted">{row.metaText}</div>
      {row.change_text && <div className="mt-2 text-sm leading-6 text-ink-soft">{row.change_text}</div>}
      <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-3 text-sm font-bold text-teal">
        {row.enterText}
        <ChevronRight size={16} className="text-muted" />
      </div>
    </button>
  );
}
