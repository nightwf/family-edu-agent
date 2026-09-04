import { useEffect, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";

type Child = { id: string; name: string; age: number; grade: string; subjects: string[]; textbookVersion?: string };

type Props = {
  token: string;
  children: Child[];
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
};

export default function ChildOverview({ token, children, request }: Props) {
  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id || "");
  const [state, setState] = useState<any | null>(null);
  const [evidence, setEvidence] = useState<any[]>([]);
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
    ])
      .then(([stateData, evidenceData]) => {
        if (cancelled) return;
        setState(stateData);
        setEvidence(evidenceData.items || []);
      })
      .catch(() => {
        if (!cancelled) {
          setState(null);
          setEvidence([]);
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
    return <div className="rounded-lg border border-stone-200 bg-panel p-5 text-stone-500">当前家庭还没有学生档案。</div>;
  }

  const summary = state?.summary || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {children.map((child) => (
          <button
            key={child.id}
            onClick={() => setSelectedChildId(child.id)}
            className={`rounded-full px-4 py-2 text-sm ${selectedChildId === child.id ? "bg-teal text-white" : "bg-white text-stone-600"}`}
          >
            {child.name}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["近 7 天证据", summary.evidence_7d ?? 0],
          ["本阶段证据", summary.evidence_42d ?? 0],
          ["已确认", summary.confirmed ?? 0],
          ["待确认", summary.pending_confirmation ?? 0],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-stone-200 bg-panel p-4">
            <div className="text-sm text-stone-500">{label}</div>
            <div className="mt-2 text-3xl font-bold">{String(value)}</div>
          </div>
        ))}
      </div>

      {state?.active_goal ? (
        <div className="rounded-lg border border-stone-200 bg-panel p-4">
          <div className="text-sm font-semibold text-stone-500">当前目标</div>
          <div className="mt-2 font-semibold">{state.active_goal.title}</div>
          <p className="mt-1 text-sm text-stone-600">{state.active_goal.objective}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-stone-200 bg-panel p-4 text-sm text-stone-500">
          暂无当前目标。可在“计划”页面查看候选目标或生成新目标。
        </div>
      )}

      <div className="rounded-lg border border-stone-200 bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">最近证据</h2>
          <button onClick={() => setLoading(true)} className="inline-flex items-center gap-1 text-sm text-teal">
            <RefreshCw size={15} />刷新
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-stone-500">加载中...</p>
        ) : evidence.length === 0 ? (
          <p className="text-sm text-stone-500">暂无结构化证据。</p>
        ) : (
          <div className="space-y-3">
            {evidence.map((item) => (
              <div key={item.id} className="rounded-lg border border-stone-100 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{item.type}</div>
                    <p className="mt-1 text-sm text-stone-600">{item.observedBehavior || item.taskDescription || "-"}</p>
                    {item.effectiveStrategy && <p className="mt-1 text-xs text-stone-500">有效策略：{item.effectiveStrategy}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${item.reviewStatus === "CONFIRMED" ? "bg-teal/10 text-teal" : item.reviewStatus === "CORRECTED" ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>
                    {item.reviewStatus === "CONFIRMED" ? "已确认" : item.reviewStatus === "CORRECTED" ? "已纠正" : "待确认"}
                  </span>
                </div>
                {item.reviewStatus === "PENDING_CONFIRMATION" && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => reviewEvidence(item.id, "confirm")} className="inline-flex items-center gap-1 rounded-lg bg-teal px-3 py-1 text-xs text-white">
                      <Check size={14} />确认
                    </button>
                    <button onClick={() => reviewEvidence(item.id, "correct")} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-1 text-xs">
                      <X size={14} />纠正
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
