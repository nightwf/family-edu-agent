import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";

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
    return <div className="rounded-lg border border-stone-200 bg-panel p-5 text-stone-500">当前家庭还没有学生档案。</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {children.map((child) => (
          <button key={child.id} onClick={() => setSelectedChildId(child.id)} className={`rounded-full px-4 py-2 text-sm ${selectedChildId === child.id ? "bg-teal text-white" : "bg-white text-stone-600"}`}>
            {child.name}
          </button>
        ))}
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
        <div className="rounded-lg border border-dashed border-stone-200 bg-panel p-5 text-sm text-stone-500">
          暂无阶段目标。阶段目标由 WorkBuddy 读取孩子状态后生成，家长在这里确认。
        </div>
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => (
            <div key={goal.id} className="rounded-lg border border-stone-200 bg-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{goal.title}</div>
                  <p className="mt-1 text-sm text-stone-600">{goal.objective}</p>
                  <div className="mt-2 text-xs text-stone-500">{goal.startDate?.slice(0, 10)} 至 {goal.endDate?.slice(0, 10)}</div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs ${goal.status === "PROPOSED" ? "bg-amber-100 text-amber-700" : goal.status === "CONFIRMED" || goal.status === "ACTIVE" ? "bg-teal/10 text-teal" : "bg-stone-100 text-stone-500"}`}>
                  {goal.status}
                </span>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
