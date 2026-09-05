import { useEffect, useState } from "react";
import { Badge, ChildTabs, PageHeader, Panel, StatCard } from "./Layout";

type Child = { id: string; name: string; age: number; grade: string; subjects: string[]; textbookVersion?: string };

type Props = {
  token: string;
  children: Child[];
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
};

export default function ParentRelation({ token, children, request }: Props) {
  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id || "");
  const [latest, setLatest] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    setSelectedChildId((current) => current || children[0]?.id || "");
  }, [children]);

  useEffect(() => {
    if (!selectedChildId) return;
    Promise.all([
      request(`/api/v2/children/${selectedChildId}/relationship`, {}, token),
      request(`/api/v2/children/${selectedChildId}/relationship/history?limit=30`, {}, token),
    ])
      .then(([latestData, historyData]) => {
        setLatest(latestData || null);
        setHistory(historyData.items || []);
      })
      .catch(() => {
        setLatest(null);
        setHistory([]);
      });
  }, [selectedChildId, token, request]);

  if (children.length === 0) return <Panel>当前家庭还没有学生档案。</Panel>;

  return (
    <div className="space-y-5">
      <PageHeader title="亲子关系" description="观察亲子互动、沟通状态和家长行动，不给孩子贴人格标签。" />
      <ChildTabs children={children} activeChildId={selectedChildId} onChange={setSelectedChildId} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="关系状态" value={latest?.status || "暂无记录"} note={latest?.communicationNote} tone="teal" />
        <StatCard label="关系评分" value={latest?.score ?? "-"} note="0–100" tone="gold" />
        <StatCard label="本周冲突" value={latest?.conflictCount ?? 0} note="需要关注冲突场景" tone="coral" />
      </div>

      <Panel title="当前家长建议" description="由 WorkBuddy 根据关系证据生成，家长确认后执行">
        <p className="text-sm leading-6 text-stone-600">{latest?.parentAction || "暂无家长行动建议。"}</p>
      </Panel>

      <Panel title="关系变化记录" description="按时间倒序查看">
        <div className="space-y-3">
          {history.length === 0 ? (
            <p className="text-sm text-stone-500">暂无关系记录。</p>
          ) : (
            history.map((item) => (
              <div key={item.id} className="rounded-xl border border-stone-100 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold">{item.status}</div>
                  <Badge tone="teal">{item.score ?? "-"}</Badge>
                </div>
                <p className="mt-1 text-sm text-stone-600">{item.communicationNote || "-"}</p>
                <div className="mt-1 text-xs text-stone-500">{item.generatedAt?.slice(0, 10)} · 冲突 {item.conflictCount} 次</div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
