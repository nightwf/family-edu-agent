import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";

type Props = {
  token: string;
  childId: string;
  childName: string;
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
  onClose: () => void;
  onSaved?: () => void;
};

type SkillRow = {
  skill_id: string;
  name: string;
  child_overrides: string[];
  effective_settings: { philosophy?: string; communicationStyle?: string; strictness?: string; parentGoals?: string[] };
  inherited_from_family: { philosophy?: string; communicationStyle?: string; strictness?: string; parentGoals?: string[] };
  profile?: { notes?: string | null } | null;
  inherits_family: boolean;
};

const PHILOSOPHIES = ["以引导和鼓励为主", "兴趣优先", "习惯优先", "成绩与能力并重", "自主探索"];
const COMMUNICATION_STYLES = ["温和直接", "鼓励为主", "简洁明确", "陪伴讨论"];
const STRICTNESS = ["宽松", "适中", "严格"];

const SKILL_LABELS: Record<string, string> = {
  "growth-analysis": "成长分析",
  "homework-planner": "作业规划",
  "parent-coach": "家长沟通",
  "reading-coach": "阅读引导",
  "writing-coach": "写作指导",
};

const OVERRIDE_LABELS: Record<string, string> = {
  philosophy: "教育理念",
  communicationStyle: "沟通风格",
  strictness: "严格程度",
  parentGoals: "家长目标",
};

/**
 * 孩子的教育方式（二级面板）。
 * 家庭设置是全家默认值，这里只写这个孩子的差异；留空即继续继承家庭设置。
 */
export default function ChildEducation({ token, childId, childName, request, onClose, onSaved }: Props) {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [philosophy, setPhilosophy] = useState("");
  const [communicationStyle, setCommunicationStyle] = useState("");
  const [strictness, setStrictness] = useState("");
  const [parentGoals, setParentGoals] = useState("");
  const [notes, setNotes] = useState("");

  const active = skills[activeIndex];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    request(`/api/children/${childId}/education-profile`, {}, token)
      .then((data) => {
        if (cancelled) return;
        setSkills(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [childId, token]);

  useEffect(() => {
    if (!active) return;
    const effective = active.effective_settings || {};
    setPhilosophy(effective.philosophy || "");
    setCommunicationStyle(effective.communicationStyle || "");
    setStrictness(effective.strictness || "");
    setParentGoals((effective.parentGoals || []).join("、"));
    setNotes(active.profile?.notes || "");
  }, [activeIndex, skills]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const familyDefaults = active?.inherited_from_family || {};
  const inheritsFamily = active?.inherits_family ?? true;

  const payload = useMemo(
    () => ({
      philosophy: philosophy || undefined,
      communication_style: communicationStyle || undefined,
      strictness: strictness || undefined,
      parent_goals: parentGoals.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      notes: notes || undefined,
    }),
    [philosophy, communicationStyle, strictness, parentGoals, notes],
  );

  async function reload() {
    const data = await request(`/api/children/${childId}/education-profile`, {}, token);
    setSkills(Array.isArray(data) ? data : []);
  }

  async function saveActive() {
    if (!active || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await request(
        `/api/children/${childId}/education-profile`,
        { method: "PATCH", body: JSON.stringify({ skill_id: active.skill_id, ...payload }) },
        token,
      );
      await reload();
      setNotice("已保存，这个孩子将按上面的方式带");
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function applyToAll() {
    if (!skills.length || saving) return;
    if (!window.confirm("把这个孩子的当前设置写入所有教育场景，覆盖各场景已有的单独设置？")) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      for (const skill of skills) {
        await request(
          `/api/children/${childId}/education-profile`,
          { method: "PATCH", body: JSON.stringify({ skill_id: skill.skill_id, ...payload }) },
          token,
        );
      }
      await reload();
      setNotice("已应用到全部教育场景");
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetToFamily() {
    if (!active || saving || active.inherits_family) return;
    if (!window.confirm(`清除「${active.name}」上这个孩子的单独设置，改为跟随家庭统一设置？`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await request(
        `/api/children/${childId}/education-profile`,
        { method: "PATCH", body: JSON.stringify({ skill_id: active.skill_id, clear: true }) },
        token,
      );
      await reload();
      setNotice("已恢复为继承家庭设置");
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 md:items-center">
      <div className="w-full max-w-3xl rounded-lg bg-panel p-5 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{childName} 的教育方式</h2>
            <p className="mt-1 text-sm text-muted">
              {inheritsFamily
                ? `全部场景都跟随家庭统一设置`
                : `${active?.child_overrides.length || 0} 项已按这个孩子单独设置`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-line p-2 text-muted" aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" />正在读取教育方式…
          </div>
        ) : error && !skills.length ? (
          <p className="mt-6 text-sm text-accent">{error}</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {skills.map((skill, index) => (
                <button
                  key={skill.skill_id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${
                    index === activeIndex ? "border-teal bg-teal text-white" : "border-line bg-white text-muted"
                  }`}
                >
                  {SKILL_LABELS[skill.skill_id] || skill.name}
                  {!skill.inherits_family && <span className="h-2 w-2 rounded-full bg-gold" />}
                </button>
              ))}
            </div>

            {active && (
              <div className="mt-5 space-y-4">
                {active.child_overrides.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-teal/5 px-3 py-2 text-xs text-teal">
                    <span>已单独设置：</span>
                    {active.child_overrides.map((key) => (
                      <span key={key} className="rounded-full bg-white px-2 py-1">{OVERRIDE_LABELS[key] || key}</span>
                    ))}
                  </div>
                )}

                <Segmented
                  label="教育理念"
                  options={PHILOSOPHIES}
                  value={philosophy}
                  inherited={familyDefaults.philosophy}
                  onChange={setPhilosophy}
                />
                <Segmented
                  label="沟通风格"
                  options={COMMUNICATION_STYLES}
                  value={communicationStyle}
                  inherited={familyDefaults.communicationStyle}
                  onChange={setCommunicationStyle}
                />
                <Segmented
                  label="严格程度"
                  options={STRICTNESS}
                  value={strictness}
                  inherited={familyDefaults.strictness}
                  onChange={setStrictness}
                />

                <label className="block text-sm">
                  <span className="font-medium text-ink-soft">这个孩子的家长目标</span>
                  <input
                    value={parentGoals}
                    onChange={(event) => setParentGoals(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-line px-3 py-2"
                    placeholder="例如：先建立阅读习惯"
                  />
                  <span className="mt-1 block text-xs text-muted">
                    多个目标用顿号分隔；留空则继续跟随家庭目标
                    {(familyDefaults.parentGoals || []).length ? `（家庭：${(familyDefaults.parentGoals || []).join("、")}）` : ""}
                  </span>
                </label>

                <label className="block text-sm">
                  <span className="font-medium text-ink-soft">这个孩子的学习特点</span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    maxLength={200}
                    className="mt-2 h-24 w-full rounded-lg border border-line px-3 py-2"
                    placeholder="例如：坐不住但动手能力强，先操作再讲解"
                  />
                  <span className="mt-1 block text-xs text-muted">只用于这个孩子，会影响 AI 的讲解顺序和沟通方式</span>
                </label>

                {error && <p className="text-sm text-accent">{error}</p>}
                {notice && <p className="text-sm text-teal">{notice}</p>}

                <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-4">
                  <button
                    type="button"
                    onClick={saveActive}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {saving && <Loader2 size={16} className="animate-spin" />}保存这个孩子的教育方式
                  </button>
                  <button type="button" onClick={applyToAll} disabled={saving} className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-60">
                    应用到全部场景
                  </button>
                  {!active.inherits_family && (
                    <button
                      type="button"
                      onClick={resetToFamily}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg border border-accent px-4 py-2 text-sm text-accent disabled:opacity-60"
                    >
                      <RotateCcw size={16} />恢复为继承家庭设置
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Segmented({
  label,
  options,
  value,
  inherited,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  inherited?: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-ink-soft">{label}</span>
        {inherited && inherited !== value && <span className="text-xs text-muted">家庭默认：{inherited}</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-full border px-4 py-2 ${
              option === value ? "border-teal bg-teal text-white" : "border-line bg-white text-ink"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
