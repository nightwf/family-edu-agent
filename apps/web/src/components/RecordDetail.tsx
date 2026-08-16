import { BookOpen, CalendarDays, ClipboardCheck, FileText, LockKeyhole, MessageSquareText, Sparkles, StickyNote, UserRound, X } from "lucide-react";

type RecordDetailProps = {
  record: any;
  childName: string;
  onClose: () => void;
};

type Template = {
  label: string;
  englishLabel: string;
  icon: typeof FileText;
  primary: string;
  deep: string;
  soft: string;
  ring: string;
  contentLabel: string;
  noteLabel: string;
  showScore: boolean;
};

const templates: Record<string, Template> = {
  writing: {
    label: "写作记录",
    englishLabel: "Writing Journal",
    icon: FileText,
    primary: "#d85b3f",
    deep: "#7e2f20",
    soft: "#fbe9e2",
    ring: "#e78463",
    contentLabel: "作文 / 日记正文",
    noteLabel: "AI 点评与训练建议",
    showScore: true,
  },
  reading: {
    label: "阅读记录",
    englishLabel: "Reading Note",
    icon: BookOpen,
    primary: "#2f8f78",
    deep: "#174c40",
    soft: "#e6f3ed",
    ring: "#4aae93",
    contentLabel: "阅读复述内容",
    noteLabel: "理解点评",
    showScore: true,
  },
  homework: {
    label: "作业记录",
    englishLabel: "Homework Log",
    icon: ClipboardCheck,
    primary: "#c58a1e",
    deep: "#75500f",
    soft: "#fbf0d2",
    ring: "#dcab42",
    contentLabel: "作业内容与要求",
    noteLabel: "完成情况与备注",
    showScore: true,
  },
  parent_note: {
    label: "家长笔记",
    englishLabel: "Parent Note",
    icon: StickyNote,
    primary: "#6d7a76",
    deep: "#37423f",
    soft: "#eef1ed",
    ring: "#8b9792",
    contentLabel: "家长记录",
    noteLabel: "补充说明",
    showScore: false,
  },
};

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function formatShortDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function RecordDetail({ record, childName, onClose }: RecordDetailProps) {
  const template = templates[record.type] || templates.parent_note;
  const Icon = template.icon;
  const primaryContent = record.content || record.notes || "暂无内容";
  const secondaryContent = record.content ? record.notes : "";
  const score = typeof record.score === "number" ? Math.max(0, Math.min(100, record.score)) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101815]/65 p-4 backdrop-blur-md" onClick={onClose}>
      <article
        className="relative grid max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[28px] bg-[#fffaf0] shadow-[0_30px_90px_rgba(0,0,0,.34)] md:grid-cols-[250px_minmax(0,1fr)]"
        onClick={(event) => event.stopPropagation()}
      >
        <aside
          className="relative hidden overflow-hidden p-7 text-white md:flex md:flex-col md:justify-between"
          style={{ backgroundColor: template.deep }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.16) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div className="relative">
            <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/30 bg-white/10">
              <Icon size={27} />
            </div>
            <div className="mt-10 text-[11px] font-bold uppercase tracking-[0.22em] text-white/65">
              {template.englishLabel}
            </div>
            <h2 className="mt-2 font-serif text-4xl font-bold leading-tight">{template.label}</h2>
          </div>

          <div className="relative space-y-4 border-t border-white/15 pt-5 text-sm">
            <div className="flex items-start gap-3">
              <UserRound size={17} className="mt-0.5 shrink-0 text-white/70" />
              <div>
                <div className="text-[11px] text-white/50">孩子</div>
                <div className="font-semibold">{childName || "-"}</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CalendarDays size={17} className="mt-0.5 shrink-0 text-white/70" />
              <div>
                <div className="text-[11px] text-white/50">记录日期</div>
                <div className="font-semibold">{formatShortDate(record.date)}</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="relative max-h-[92vh] overflow-y-auto bg-[#fffaf0]">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full border border-stone-200 bg-white text-stone-500 shadow-sm hover:text-stone-900"
            aria-label="关闭"
          >
            <X size={19} />
          </button>

          <div className="px-6 pb-10 pt-7 md:px-11 md:pb-12 md:pt-10">
            <div className="mb-7 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: template.soft, color: template.deep }}>
                <Icon size={15} />
                {template.label}
              </span>
              <span className="text-xs text-stone-400">{formatDate(record.date)}</span>
            </div>

            <h1 className="max-w-3xl font-serif text-3xl font-black leading-[1.18] tracking-tight text-[#24342e] md:text-5xl">
              {record.title || "未命名记录"}
            </h1>
            <div className="mt-4 h-px w-24" style={{ backgroundColor: template.primary }} />

            <div className="mt-8 flex flex-col gap-5 md:flex-row md:items-center">
              {template.showScore && score !== null ? (
                <div className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${template.ring} ${score * 3.6}deg, #eee6d8 0deg)` }}>
                  <div className="grid h-[88px] w-[88px] place-items-center rounded-full bg-[#fffaf0]">
                    <div>
                      <div className="text-center font-serif text-3xl font-black" style={{ color: template.deep }}>{score}</div>
                      <div className="text-center text-[10px] font-bold uppercase tracking-[0.15em] text-stone-400">Score</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full border border-dashed border-stone-300">
                  <Sparkles size={26} style={{ color: template.primary }} />
                </div>
              )}

              <div className="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white p-5">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-stone-700">
                  <MessageSquareText size={17} style={{ color: template.primary }} />
                  {template.contentLabel}
                </div>
                <p className="whitespace-pre-wrap text-[15px] leading-7 text-stone-700 first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-5xl first-letter:font-black first-letter:leading-[0.85]" style={{ color: "#3f4945" }}>
                  {primaryContent}
                </p>
              </div>
            </div>

            {secondaryContent ? (
              <section className="mt-6 overflow-hidden rounded-2xl border border-stone-200 bg-white">
                <div className="flex items-center gap-3 border-b border-stone-100 px-5 py-4" style={{ backgroundColor: template.soft }}>
                  <Sparkles size={18} style={{ color: template.primary }} />
                  <h3 className="font-serif text-lg font-bold" style={{ color: template.deep }}>{template.noteLabel}</h3>
                </div>
                <blockquote className="border-l-4 px-6 py-5 text-[15px] leading-7 text-stone-700" style={{ borderColor: template.primary }}>
                  {secondaryContent}
                </blockquote>
              </section>
            ) : null}

            <footer className="mt-8 flex items-center justify-between border-t border-stone-200 pt-5 text-xs text-stone-400">
              <div className="flex items-center gap-2">
                <LockKeyhole size={14} />
                <span>仅当前家庭账号可见</span>
              </div>
              <div className="font-serif text-sm tracking-[0.18em]" style={{ color: template.deep }}>
                {template.englishLabel}
              </div>
            </footer>
          </div>
        </div>
      </article>
    </div>
  );
}
