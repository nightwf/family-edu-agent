import { BookOpen, CalendarDays, ClipboardCheck, FileText, MessageSquareText, StickyNote, X } from "lucide-react";

type RecordDetailProps = {
  record: any;
  childName: string;
  onClose: () => void;
};

const templates: Record<string, {
  label: string;
  icon: typeof FileText;
  accentText: string;
  accentBg: string;
  accentLine: string;
  contentLabel: string;
  noteLabel: string;
  showScore: boolean;
}> = {
  writing: {
    label: "写作记录",
    icon: FileText,
    accentText: "text-[#c24f35]",
    accentBg: "bg-[#fde8e0]",
    accentLine: "bg-[#e47a5f]",
    contentLabel: "作文 / 日记内容",
    noteLabel: "AI 点评",
    showScore: true,
  },
  reading: {
    label: "阅读记录",
    icon: BookOpen,
    accentText: "text-[#1f7a67]",
    accentBg: "bg-[#e1f1eb]",
    accentLine: "bg-[#2c9c8a]",
    contentLabel: "复述内容",
    noteLabel: "阅读点评",
    showScore: true,
  },
  homework: {
    label: "作业记录",
    icon: ClipboardCheck,
    accentText: "text-[#9a6a17]",
    accentBg: "bg-[#fbf1cf]",
    accentLine: "bg-[#d7a84a]",
    contentLabel: "作业说明",
    noteLabel: "完成记录 / 备注",
    showScore: true,
  },
  parent_note: {
    label: "家长笔记",
    icon: StickyNote,
    accentText: "text-[#4b5563]",
    accentBg: "bg-[#f1f2ee]",
    accentLine: "bg-[#8a9188]",
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
  });
}

export default function RecordDetail({ record, childName, onClose }: RecordDetailProps) {
  const template = templates[record.type] || templates.parent_note;
  const Icon = template.icon;
  const primaryContent = record.content || record.notes || "暂无内容";
  const secondaryContent = record.content ? record.notes : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <article
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-stone-200 bg-[#fffdf7] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`h-1.5 ${template.accentLine}`} />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white text-stone-500 shadow-sm hover:text-stone-900"
          aria-label="关闭"
        >
          <X size={18} />
        </button>

        <div className="px-6 pb-7 pt-5 md:px-8 md:pb-8">
          <div className="mb-5 flex items-start gap-4">
            <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${template.accentBg} ${template.accentText}`}>
              <Icon size={24} />
            </div>
            <div className="min-w-0">
              <div className={`text-xs font-bold uppercase tracking-[0.16em] ${template.accentText}`}>{template.label}</div>
              <h2 className="mt-1 break-words font-serif text-2xl font-bold leading-tight text-[#26343b] md:text-3xl">
                {record.title || "未命名记录"}
              </h2>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
              <div className="text-xs text-stone-500">记录日期</div>
              <div className="mt-1 text-sm font-semibold text-[#26343b]">{formatDate(record.date)}</div>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
              <div className="text-xs text-stone-500">孩子</div>
              <div className="mt-1 text-sm font-semibold text-[#26343b]">{childName || "-"}</div>
            </div>
            {template.showScore && (
              <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                <div className="text-xs text-stone-500">评分</div>
                <div className={`mt-1 text-sm font-bold ${template.accentText}`}>
                  {typeof record.score === "number" ? `${record.score} / 100` : "-"}
                </div>
              </div>
            )}
          </div>

          <section className="rounded-2xl border border-stone-200 bg-[#faf8f0] p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#26343b]">
              <MessageSquareText size={17} />
              {template.contentLabel}
            </div>
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-stone-700">{primaryContent}</p>
          </section>

          {secondaryContent ? (
            <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-5">
              <div className={`mb-2 text-sm font-bold ${template.accentText}`}>{template.noteLabel}</div>
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-stone-600">{secondaryContent}</p>
            </section>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-2 text-xs text-stone-400">
            <CalendarDays size={14} />
            <span>该记录仅当前家庭账号可见</span>
          </div>
        </div>
      </article>
    </div>
  );
}
