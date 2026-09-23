import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { PageId } from "./Layout";
import { Badge, Panel } from "./Layout";
import { formatDate } from "../lib/presentation";

type Props = {
  token: string;
  childId: string;
  subject: string;
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
  onNavigate: (page: PageId) => void;
};

/**
 * 学科详情（二级页）：回答「这一科现在什么水平、先解决什么、接下来怎么练、练到什么程度算过」。
 * 内容全部来自服务端规则计算，页面不做判断，口径与小程序 subject-detail 页一致。
 */
export default function SubjectDetail({ token, childId, subject, request, onNavigate }: Props) {
  const [detail, setDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!childId || !subject) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    request(`/api/mobile/subject-detail?child_id=${childId}&subject=${encodeURIComponent(subject)}`, {}, token)
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
  }, [childId, subject, token, request]);

  const scoreText = useMemo(() => {
    const score = detail?.mastery_score;
    return score === null || score === undefined ? "—" : String(Math.round(Number(score)));
  }, [detail]);

  const adviceRows = useMemo(() => {
    const advice = detail?.advice;
    if (!advice) return [] as Array<{ label: string; value: string }>;
    return [
      { label: "本次安排", value: advice.action },
      { label: "教学方式", value: advice.method },
      { label: "通过标准", value: advice.pass_criteria },
      { label: "复测安排", value: advice.retest },
      { label: "判断依据", value: advice.basis },
    ].filter((item) => Boolean(item.value));
  }, [detail]);

  return (
    <div className="space-y-5">
      <button onClick={() => onNavigate("home")} className="inline-flex items-center gap-2 text-sm font-bold text-teal">
        <ArrowLeft size={16} />返回首页
      </button>

      {loading ? (
        <Panel>正在整理这一科的情况...</Panel>
      ) : error ? (
        <div className="rounded-xl border border-orange-200 bg-accent-soft px-4 py-3 text-sm text-accent">{error}</div>
      ) : (
        <>
          <section className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-black text-ink">{detail?.subject || subject}</h2>
              <span className="rounded-full bg-gold-soft px-3 py-1 text-xs font-bold text-[#80601a]">{detail?.status_text}</span>
              <span className="ml-auto text-2xl font-black text-teal">
                {scoreText}
                <span className="ml-0.5 text-xs font-bold text-muted">分</span>
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-ink-soft">{detail?.judgement}</p>
          </section>

          <Panel title="需要先解决的问题" description="按优先级排列，先解决上面的">
            {(detail?.gaps || []).length === 0 ? (
              <p className="text-sm text-muted">这一科暂时没有确认的薄弱点，继续按当前节奏练习即可。</p>
            ) : (
              <div className="space-y-3">
                {(detail?.gaps || []).map((gap: any) => (
                  <div key={`${gap.type}-${gap.name}`} className="rounded-xl border border-line-soft bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-bold text-ink">{gap.name}</div>
                      {gap.mastery_score !== null && gap.mastery_score !== undefined && (
                        <span className="text-lg font-black text-accent">{Math.round(Number(gap.mastery_score))}</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-ink-soft">{gap.why}</p>
                    {gap.evidence && <p className="mt-1 text-xs text-muted">证据：{gap.evidence}</p>}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {detail?.advice && (
            <Panel
              title="后续规划建议"
              description="由题型的掌握判定规则生成，可直接交给 WorkBuddy 执行"
              actions={
                <button onClick={() => onNavigate("wrong-book")} className="text-sm font-bold text-teal">
                  查看错题
                </button>
              }
            >
              <div className="rounded-xl bg-teal-soft p-4 text-base font-black text-teal-deep">{detail.advice.action}</div>
              <dl className="mt-4 grid gap-3 md:grid-cols-2">
                {adviceRows.map((row) => (
                  <div key={row.label} className="rounded-xl border border-line-soft bg-white p-3">
                    <dt className="text-xs font-bold text-muted">{row.label}</dt>
                    <dd className="mt-1 text-sm leading-6 text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {detail.advice.estimated_minutes ? (
                <p className="mt-3 text-xs text-muted">预计用时 {detail.advice.estimated_minutes} 分钟</p>
              ) : null}
            </Panel>
          )}

          {(detail?.tasks || []).length > 0 && (
            <Panel title="这一科的最近任务" description="截止时间近的排在前面">
              <div className="space-y-2">
                {(detail?.tasks || []).map((task: any) => (
                  <div key={task.title} className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-white p-3">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-ink">{task.title}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        {task.due_date ? `${formatDate(task.due_date)} 前` : "未设置截止时间"}
                        {task.estimated_minutes ? ` · 预计 ${task.estimated_minutes} 分钟` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {detail?.planning_required && <Badge tone="coral">这一科的情况建议重新规划学习计划</Badge>}
        </>
      )}
    </div>
  );
}
