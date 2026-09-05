import type { ReactNode } from "react";
import {
  BookMarked,
  BookOpen,
  BookX,
  ClipboardCheck,
  LayoutDashboard,
  Library,
  LogOut,
  Settings,
  TrendingUp,
  Users,
} from "lucide-react";

export type PageId =
  | "home"
  | "plan"
  | "child-state"
  | "relation"
  | "students"
  | "reports"
  | "textbooks"
  | "questions"
  | "wrong-book"
  | "homework"
  | "knowledge"
  | "settings";

type NavItem = { id: PageId; label: string; icon: typeof LayoutDashboard };

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "围绕孩子",
    items: [
      { id: "home", label: "孩子总览", icon: LayoutDashboard },
      { id: "plan", label: "计划", icon: TrendingUp },
      { id: "child-state", label: "孩子状态", icon: TrendingUp },
      { id: "relation", label: "亲子关系", icon: Users },
      { id: "students", label: "学生", icon: Users },
      { id: "reports", label: "报告成长", icon: TrendingUp },
    ],
  },
  {
    title: "学习资源",
    items: [
      { id: "textbooks", label: "教材", icon: BookOpen },
      { id: "questions", label: "题库", icon: BookMarked },
      { id: "wrong-book", label: "错题本", icon: BookX },
      { id: "homework", label: "作业", icon: ClipboardCheck },
      { id: "knowledge", label: "知识库", icon: Library },
    ],
  },
  {
    title: "账号与配置",
    items: [{ id: "settings", label: "设置", icon: Settings }],
  },
];

export function Sidebar({
  page,
  onNavigate,
  onLogout,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
}) {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-[#23353b] px-3 py-5 text-white">
      <div className="mb-7 flex items-center gap-3 px-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-lg font-black text-ink">禾</span>
        <div>
          <div className="font-bold">禾芽家庭教务</div>
          <div className="text-xs text-white/55">家庭 AI 私教</div>
        </div>
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-white/45">{group.title}</div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = page === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      active ? "bg-teal font-bold text-white" : "text-white/72 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon size={17} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button onClick={onLogout} className="mt-5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/65 hover:bg-white/10 hover:text-white">
        <LogOut size={17} />退出登录
      </button>
    </aside>
  );
}

export function Topbar({
  title,
  familyName,
  childName,
}: {
  title: string;
  familyName?: string;
  childName?: string;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-cream/70 px-5 backdrop-blur md:px-7">
      <div className="text-lg font-bold">{title}</div>
      <div className="flex items-center gap-2 text-xs text-stone-500">
        {familyName && <span className="rounded-full border border-stone-200 bg-white/70 px-3 py-1.5">家庭：{familyName}</span>}
        {childName && <span className="rounded-full border border-stone-200 bg-white/70 px-3 py-1.5">{childName}</span>}
      </div>
    </header>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-black tracking-normal text-ink md:text-[28px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-panel p-4 shadow-[0_12px_32px_rgba(38,52,59,0.06)] md:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-extrabold text-ink">{title}</h2>}
            {description && <p className="mt-1 text-xs leading-5 text-stone-500">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: "default" | "gold" | "coral" | "teal";
}) {
  const toneClass = {
    default: "bg-panel border-stone-200",
    gold: "bg-gold/15 border-amber-200",
    coral: "bg-orange-50 border-orange-200",
    teal: "bg-teal/10 border-teal/20",
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-ink">{value}</div>
      {note && <div className="mt-1 text-xs text-stone-500">{note}</div>}
    </div>
  );
}

export function ChildTabs({
  children,
  activeChildId,
  onChange,
}: {
  children: Array<{ id: string; name: string }>;
  activeChildId?: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {children.map((child) => (
        <button
          key={child.id}
          onClick={() => onChange(child.id)}
          className={`rounded-full px-4 py-2 text-sm font-bold transition ${
            activeChildId === child.id ? "bg-teal text-white" : "border border-stone-200 bg-white text-stone-600 hover:border-teal/40"
          }`}
        >
          {child.name}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "teal" }: { children: ReactNode; tone?: "teal" | "warn" | "coral" | "muted" }) {
  const classes = {
    teal: "bg-teal/10 text-teal",
    warn: "bg-amber-100 text-amber-700",
    coral: "bg-orange-100 text-accent",
    muted: "bg-stone-100 text-stone-500",
  }[tone];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${classes}`}>{children}</span>;
}
