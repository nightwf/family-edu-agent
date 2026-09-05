import { useEffect, useState } from "react";
import { Badge, ChildTabs, PageHeader, Panel, StatCard } from "./Layout";

type Child = { id: string; name: string; age: number; grade: string; subjects: string[]; textbookVersion?: string };

type Props = {
  token: string;
  children: Child[];
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
};

export default function ChildStateDetail({ token, children, request }: Props) {
  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id || "");
  const [state, setState] = useState<any | null>(null);
  const [evidence, setEvidence] = useState<any[]>([]);

  useEffect(() => {
    setSelectedChildId((current) => current || children[0]?.id || "");
  }, [children]);

  useEffect(() => {
    if (!selectedChildId) return;
    Promise.all([
      request(`/api/v2/children/${selectedChildId}/state`, {}, token),
      request(`/api/v2/children/${selectedChildId}/evidence?limit=50`, {}, token),
    ])
      .then(([stateData, evidenceData]) => {
        setState(stateData);
        setEvidence(evidenceData.items || []);
      })
      .catch(() => {
        setState(null);
        setEvidence([]);
      });
  }, [selectedChildId, token, request]);

  if (children.length === 0) return <Panel>当前家庭还没有学生档案。</Panel>;

  const summary = state?.summary || {};

  return (
    <div className="space-y-5">
      <PageHeader title="孩子状态详情" description="查看结构化证据、统计和趋势，避免只凭单次表现判断。" />
      <ChildTabs children={children} activeChildId={selectedChildId} onChange={setSelectedChildId} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="近 7 天证据" value={summary.evidence_7d ?? 0} note="系统自动汇总" />
        <StatCard label="本阶段证据" value={summary.evidence_42d ?? 0} note="4–8 周内" />
        <StatCard label="待确认" value={summary.pending_confirmation ?? 0} note="需要家长校准" tone="gold" />
        <StatCard label="已确认" value={summary.confirmed ?? 0} note="可回溯证据" tone="teal" />
      </div>

      <Panel title="学习状态趋势" description="正确率、独立完成率、任务完成度">
        <div className="grid h-44 place-items-center rounded-xl bg-gradient-to-br from-teal/10 to-gold/20 text-sm text-stone-500">
          趋势图区域：数据接入后展示
        </div>
      </Panel>

      <Panel title="证据明细" description="按时间倒序查看结构化证据">
        <div className="space-y-3">
          {evidence.length === 0 ? (
            <p className="text-sm text-stone-500">暂无结构化证据。</p>
          ) : (
            evidence.map((item) => (
              <div key={item.id} className="rounded-xl border border-stone-100 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold">{item.type}</div>
                    <p className="mt-1 text-sm text-stone-600">{item.observedBehavior || item.taskDescription || "-"}</p>
                    {item.effectiveStrategy && <p className="mt-1 text-xs text-stone-500">有效策略：{item.effectiveStrategy}</p>}
                  </div>
                  <Badge tone={item.reviewStatus === "CONFIRMED" ? "teal" : item.reviewStatus === "CORRECTED" ? "warn" : "muted"}>
                    {item.reviewStatus}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
