import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import type { PageId } from "./Layout";
import { Badge, ChildTabs, PageHeader, Panel, StatCard } from "./Layout";
import { deriveChildPresentation, formatDate } from "../lib/presentation";

type Child = { id: string; name: string; gender?: string; age: number; grade: string; subjects: string[]; textbookVersion?: string };

type Props = {
  token: string;
  children: Child[];
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
  onNavigate: (page: PageId) => void;
};

const EVIDENCE_TONE: Record<string, "teal" | "warn" | "muted"> = {
  CONFIRMED: "teal",
  CORRECTED: "warn",
  PENDING_CONFIRMATION: "muted",
};

const EVIDENCE_LABEL: Record<string, string> = {
  CONFIRMED: "已确认",
  CORRECTED: "已纠正",
  PENDING_CONFIRMATION: "待确认",
};

/**
 * 学习诊断（二级页）：按「整体状态 → 原因 → 下一步」讲清孩子现在怎么样。
 * 数据口径与小程序 child-state 页一致，都用 /api/home 的同一份学情。
 */
export default function ChildStateDetail({ token, children, request, onNavigate }: Props) {
  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id || "");
  const [detail, setDetail] = useState<any | null>(null);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelectedChildId((current) => (children.some((child) => child.id === current) ? current : children[0]?.id || ""));
  }, [children]);

  useEffect(() => {
    if (!selectedChildId) {
      setDetail(null);
      setEvidence([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      request(`/api/home?child_id=${selectedChildId}`, {}, token),
      request(`/api/v2/children/${selectedChildId}/evidence?limit=50`, {}, token),
    ])
      .then(([homeData, evidenceData]) => {
        if (cancelled) return;
        setDetail(homeData);
        setEvidence(evidenceData.items || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setDetail(null);
          setEvidence([]);
          setError((err as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChildId, token, request]);

  const activeChild = children.find((child) => child.id === selectedChildId);
  const hero = useMemo(
    () =>
      deriveChildPresentation({
        child: detail?.active_child,
        childState: detail?.child_state,
        relationship: detail?.relationship,
        wrongQuestions: detail?.wrong_questions,
        mastery: detail?.mastery,
        reports: detail?.reports,
        homework: detail?.homework,
      }),
    [detail],
  );
  const summary = detail?.child_state?.summary || {};
  const relationship = detail?.relationship;
  const pendingEvidence = evidence.filter((item) => item.reviewStatus === "PENDING_CONFIRMATION");
  const recentEvidence = (detail?.child_state?.recent_evidence || []) as any[];

  async function reviewEvidence(evidenceId: string, action: "confirm" | "correct") {
    await request(`/api/v2/evidence/${evidenceId}/review`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }, token);
    const evidenceData = await request(`/api/v2/children/${selectedChildId}/evidence?limit=50`, {}, token);
    setEvidence(evidenceData.items || []);
  }

  if (children.length === 0) return <Panel>当前家庭还没有学生档案。</Panel>;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${activeChild?.name || ""} 学习诊断`}
        description="先看孩子整体状态，再看依据，最后决定家长这一步做什么。"
      />
      <ChildTabs children={children} activeChildId={selectedChildId} onChange={setSelectedChildId} />

      {error && <div className="rounded-xl border border-orange-200 bg-accent-soft px-4 py-3 text-sm text-accent">{error}</div>}

      <section className="flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-panel p-5">
        <img src={hero.image} alt="" aria-hidden="true" className="h-32 w-auto shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-muted">截至当前</div>
          <h2 className="mt-1.5 text-xl font-black text-ink">{hero.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{hero.subtitle}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {hero.tags.map((tag) => (
              <Badge key={tag} tone="teal">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <ReportStep index="01" label="观察证据" text={hero.evidence} />
        <ReportStep index="02" label="系统判断" text={hero.judgment} />
        <ReportStep index="03" label="家长下一步" text={hero.action} highlight />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="近 7 天证据" value={summary.evidence_7d ?? 0} note="系统自动汇总" />
        <StatCard label="本阶段证据" value={summary.evidence_42d ?? 0} note="4–8 周内" />
        <StatCard label="待确认" value={summary.pending_confirmation ?? 0} note="需要家长校准" tone="gold" />
        <StatCard label="已确认" value={summary.confirmed ?? 0} note="可回溯证据" tone="teal" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
        <Panel
          title="需要家长确认"
          description="这些推断会影响后续计划，请确认或纠正"
          actions={<Badge tone={pendingEvidence.length ? "coral" : "muted"}>{pendingEvidence.length} 条</Badge>}
        >
          {pendingEvidence.length === 0 ? (
            <p className="text-sm text-muted">暂时没有需要确认的推断。</p>
          ) : (
            <div className="space-y-3">
              {pendingEvidence.map((item) => (
                <div key={item.id} className="rounded-xl border border-amber-100 bg-white p-3">
                  <div className="font-bold">{item.type}</div>
                  <p className="mt-1 text-sm text-ink-soft">{item.observedBehavior || item.taskDescription || "-"}</p>
                  {item.effectiveStrategy && <p className="mt-1 text-xs text-muted">有效策略：{item.effectiveStrategy}</p>}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => reviewEvidence(item.id, "confirm")}
                      className="inline-flex items-center gap-1 rounded-lg bg-teal px-3 py-1.5 text-xs font-bold text-white"
                    >
                      <Check size={14} />确认
                    </button>
                    <button
                      onClick={() => reviewEvidence(item.id, "correct")}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-bold"
                    >
                      <X size={14} />纠正
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="亲子关系状态"
          description="关系状态会影响孩子愿不愿意配合"
          actions={
            <button onClick={() => onNavigate("relation")} className="text-sm font-bold text-teal">
              查看详情
            </button>
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-black text-ink">{relationship?.status || "暂无记录"}</div>
              <p className="mt-2 text-sm leading-6 text-ink-soft">
                {relationship?.communicationNote || "还没有亲子关系记录。"}
              </p>
            </div>
            <Badge tone="coral">评分 {relationship?.score ?? "-"}</Badge>
          </div>
        </Panel>
      </div>

      <Panel
        title="最近依据"
        description="近 7 天的结构化证据，按时间倒序"
        actions={
          <button onClick={() => onNavigate("reports")} className="text-sm font-bold text-teal">
            全部记录
          </button>
        }
      >
        {loading ? (
          <p className="text-sm text-muted">加载中...</p>
        ) : recentEvidence.length === 0 ? (
          <p className="text-sm text-muted">还没有独立的状态证据，继续同步真实学习记录后再判断。</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {recentEvidence.map((item) => (
              <div key={item.id} className="rounded-xl border border-line-soft bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold">{item.type}</div>
                  <Badge tone={EVIDENCE_TONE[item.reviewStatus] || "muted"}>
                    {EVIDENCE_LABEL[item.reviewStatus] || item.reviewStatus}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{item.observedBehavior || item.taskDescription || "-"}</p>
                <div className="mt-1 text-xs text-muted">{formatDate(item.observedAt)}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function ReportStep({ index, label, text, highlight }: { index: string; label: string; text: string; highlight?: boolean }) {
  return (
    <section className={`rounded-2xl border p-5 ${highlight ? "border-teal/30 bg-teal-soft" : "border-line bg-panel"}`}>
      <div className="flex items-center gap-3">
        <span className="text-lg font-black text-teal/70">{index}</span>
        <span className="text-xs font-bold text-muted">{label}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink">{text}</p>
    </section>
  );
}
