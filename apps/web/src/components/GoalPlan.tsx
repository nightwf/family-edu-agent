import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { Badge, ChildTabs, PageHeader, Panel } from "./Layout";

type Child = { id: string; name: string; age: number; grade: string; subjects: string[]; textbookVersion?: string };

type Props = {
  token: string;
  children: Child[];
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
};

export default function GoalPlan({ token, children, request }: Props) {
  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id || "");
  const [goals, setGoals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelectedChildId((current) => current || children[0]?.id || "");
  }, [children]);

  useEffect(() => {
    if (!selectedChildId) return;
    setLoading(true);
    request(`/api/v2/children/${selectedChildId}/goals`, {}, token)
      .then((data) => setGoals(data.items || []))
      .catch(() => setGoals([]))
      .finally(() => setLoading(false));
  }, [selectedChildId, token, request]);

  async function confirmGoal(goalId: string, action: "confirm" | "reject") {
    await request(`/api/v2/goals/${goalId}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }, token);
    const data = await request(`/api/v2/children/${selectedChildId}/goals`, {}, token);
    setGoals(data.items || []);
  }

  if (children.length === 0) {
    return <Panel>当前家庭还没有学生档案。</Panel>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="计划"
        description="围绕一个 4–8 周目标安排每周任务，到期通过复测判断是否改善。"
      />
      <div className="flex flex-wrap items-center gap-3">
        <ChildTabs children={children} activeChildId={selectedChildId} onChange={setSelectedChildId} />
        <button onClick={() => {
          const data = request(`/api/v2/children/${selectedChildId}/goals`, {}, token);
          data.then((result) => setGoals(result.items || []));
        }} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-sm">
          <RefreshCw size={15} />刷新
        </button>
      </div>

      {loading ? (
        <p className="text-stone-500">加载中...</p>
      ) : goals.length === 0 ? (
        <Panel className="border-dashed">
          暂无阶段目标。阶段目标由 WorkBuddy 读取孩子状态后生成，家长在这里确认。
        </Panel>
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => (
            <Panel key={goal.id} title={goal.title} actions={<Badge tone={goal.status === "PROPOSED" ? "warn" : "teal"}>{goal.status}</Badge>}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="mt-1 text-sm text-stone-600">{goal.objective}</p>
                  <div className="mt-2 text-xs text-stone-500">{goal.startDate?.slice(0, 10)} 至 {goal.endDate?.slice(0, 10)}</div>
                </div>
              </div>
              {goal.status === "PROPOSED" && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => confirmGoal(goal.id, "confirm")} className="inline-flex items-center gap-1 rounded-lg bg-teal px-3 py-2 text-sm text-white">
                    <Check size={15} />确认目标
                  </button>
                  <button onClick={() => confirmGoal(goal.id, "reject")} className="rounded-lg border border-stone-200 px-3 py-2 text-sm">
                    拒绝
                  </button>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
