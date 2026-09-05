import { useEffect, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { Badge, ChildTabs, PageHeader, Panel, StatCard } from "./Layout";

type Child = { id: string; name: string; age: number; grade: string; subjects: string[]; textbookVersion?: string };

type Props = {
  token: string;
  children: Child[];
  home?: any;
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
};

export default function ChildOverview({ token, children, home, request }: Props) {
  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id || "");
  const [state, setState] = useState<any | null>(null);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [relationship, setRelationship] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelectedChildId((current) => current || children[0]?.id || "");
  }, [children]);

  useEffect(() => {
    if (!selectedChildId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      request(`/api/v2/children/${selectedChildId}/state`, {}, token),
      request(`/api/v2/children/${selectedChildId}/evidence?limit=20`, {}, token),
      request(`/api/v2/children/${selectedChildId}/relationship`, {}, token),
    ])
      .then(([stateData, evidenceData, relationshipData]) => {
        if (cancelled) return;
        setState(stateData);
        setEvidence(evidenceData.items || []);
        setRelationship(relationshipData || null);
      })
      .catch(() => {
        if (!cancelled) {
          setState(null);
          setEvidence([]);
          setRelationship(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChildId, token, request]);

  async function reviewEvidence(evidenceId: string, action: "confirm" | "correct") {
    await request(`/api/v2/evidence/${evidenceId}/review`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }, token);
    const evidenceData = await request(`/api/v2/children/${selectedChildId}/evidence?limit=20`, {}, token);
    setEvidence(evidenceData.items || []);
  }

  if (children.length === 0) {
    return <Panel>当前家庭还没有学生档案。</Panel>;
  }

  const summary = state?.summary || {};
  const selectedChild = children.find((child) => child.id === selectedChildId);
  const homework = (home?.homework || []).filter((item: any) => item.childId === selectedChildId);
  const pendingEvidence = evidence.filter((item) => item.reviewStatus === "PENDING_CONFIRMATION");
  const confirmedEvidence = evidence.filter((item) => item.reviewStatus === "CONFIRMED");

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${selectedChild?.name || ""} 最近怎么样了？`}
        description="先看当前目标和证据，再决定本周要做什么。"
        actions={<button className="rounded-lg bg-teal px-4 py-2 text-sm font-bold text-white">生成本周计划</button>}
      />
      <ChildTabs children={children} activeChildId={selectedChildId} onChange={setSelectedChildId} />

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl bg-teal p-5 text-white shadow-[0_18px_40px_rgba(15,118,110,0.18)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-white/60">孩子当前状态</div>
              <div className="mt-2 text-xl font-black">{state?.active_goal?.title || "还没有设定阶段目标"}</div>
              <p className="mt-2 text-sm leading-6 text-white/75">
                {state?.active_goal?.objective || "让 WorkBuddy 读取孩子状态后生成候选目标，你在这里确认。"}
              </p>
            </div>
            <Badge tone="gold">4–8 周</Badge>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-white">
            <div><div className="text-xs text-white/60">待确认</div><div className="text-2xl font-black">{summary.pending_confirmation ?? 0}</div></div>
            <div><div className="text-xs text-white/60">本周任务</div><div className="text-2xl font-black">{homework.length}</div></div>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-gold/15 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-amber-700">亲子关系状态</div>
              <div className="mt-2 text-xl font-black">{relationship?.status || "暂无记录"}</div>
              <p className="mt-2 text-sm leading-6 text-stone-600">{relationship?.communicationNote || "还没有亲子关系记录。"}</p>
            </div>
            <Badge tone="coral">评分 {relationship?.score ?? "-"}</Badge>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div><div className="text-xs text-stone-500">本周冲突</div><div className="text-2xl font-black">{relationship?.conflictCount ?? 0}</div></div>
            <div><div className="text-xs text-stone-500">家长行动</div><div className="text-2xl font-black">{relationship?.parentAction ? 1 : 0}</div></div>
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <Panel
          title="本周重点"
          description="优先看截止时间近、需要家长参与的任务"
          actions={<button onClick={() => setLoading(true)} className="inline-flex items-center gap-1 text-sm text-teal"><RefreshCw size={15} />刷新</button>}
        >
          {homework.length === 0 ? (
            <p className="text-sm text-stone-500">本周暂无作业或计划任务。</p>
          ) : (
            <div className="space-y-3">
              {homework.slice(0, 4).map((item: any) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-white p-3">
                  <div className="min-w-0">
                    <div className="font-bold">{item.title}</div>
                    <div className="mt-1 text-xs text-stone-500">{item.subject || "学习任务"} · {item.dueDate?.slice(0, 10) || "未设置截止时间"}</div>
                  </div>
                  <Badge tone={item.status === "done" ? "teal" : "warn"}>{item.status === "done" ? "已完成" : "待完成"}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="需要家长确认"
          description="这些推断会影响后续计划，请确认或纠正"
          actions={<Badge tone={pendingEvidence.length ? "coral" : "muted"}>{pendingEvidence.length} 条</Badge>}
        >
          {pendingEvidence.length === 0 ? (
            <p className="text-sm text-stone-500">暂时没有需要确认的推断。</p>
          ) : (
            <div className="space-y-3">
              {pendingEvidence.map((item) => (
                <div key={item.id} className="rounded-xl border border-amber-100 bg-white p-3">
                  <div className="font-bold">{item.type}</div>
                  <p className="mt-1 text-sm text-stone-600">{item.observedBehavior || item.taskDescription || "-"}</p>
                  {item.effectiveStrategy && <p className="mt-1 text-xs text-stone-500">有效策略：{item.effectiveStrategy}</p>}
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => reviewEvidence(item.id, "confirm")} className="inline-flex items-center gap-1 rounded-lg bg-teal px-3 py-1.5 text-xs font-bold text-white"><Check size={14} />确认</button>
                    <button onClick={() => reviewEvidence(item.id, "correct")} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold"><X size={14} />纠正</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="最近动态" description="最近确认的学习证据，按时间倒序">
        {loading ? (
          <p className="text-sm text-stone-500">加载中...</p>
        ) : confirmedEvidence.length === 0 ? (
          <p className="text-sm text-stone-500">暂无已确认的动态。</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {confirmedEvidence.slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-xl border border-stone-100 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold">{item.type}</div>
                  <Badge tone="teal">已确认</Badge>
                </div>
                <p className="mt-1 text-sm text-stone-600">{item.observedBehavior || item.taskDescription || "-"}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
