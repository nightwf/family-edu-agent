import type { ReactNode } from "react";
import {
  BookMarked,
  BookOpen,
  BookX,
  ClipboardCheck,
  LayoutDashboard,
  Library,
  Menu,
  LogOut,
  Settings,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

export type PageId =
  | "home"
  | "subject"
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
  | "tutor"
  | "settings";

type NavChild = { id: PageId; label: string };
type NavItem = {
  id: PageId;
  label: string;
  icon: typeof LayoutDashboard;
  children?: NavChild[];
  /** 只在这个设备形态下出现，见 lib/tutor.ts 的入口判定。 */
  apkOnly?: boolean;
};

/**
 * 导航以小程序为基准：只保留首页 / 学生 / 成长 / 学习 / 我的五个一级入口，
 * 计划、孩子状态、亲子关系和学习资料都是二级入口。
 * 小程序里二级页在页面内跳转，电脑端屏幕更宽，就在侧边栏直接展开，避免功能被藏起来。
 */
const NAV_GROUPS: Array<{ title?: string; items: NavItem[] }> = [
  {
    items: [
      {
        id: "home",
        label: "首页",
        icon: LayoutDashboard,
        children: [
          { id: "plan", label: "学习计划" },
          { id: "child-state", label: "孩子状态" },
          { id: "relation", label: "亲子关系" },
        ],
      },
      { id: "students", label: "学生", icon: Users },
      { id: "reports", label: "成长", icon: TrendingUp },
    ],
  },
  {
    title: "学习",
    items: [
      { id: "tutor", label: "学习私教", icon: Sparkles, apkOnly: true },
      { id: "homework", label: "作业", icon: ClipboardCheck },
      { id: "wrong-book", label: "错题本", icon: BookX },
      { id: "questions", label: "题库", icon: BookMarked },
      { id: "textbooks", label: "教材", icon: BookOpen },
      { id: "knowledge", label: "知识库", icon: Library },
    ],
  },
  {
    title: "我的",
    items: [{ id: "settings", label: "设置", icon: Settings }],
  },
];

export function Sidebar({
  page,
  onNavigate,
  onLogout,
  showTutorEntry = false,
  className = "hidden lg:flex",
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
  /** 私教入口只在安卓 APK 端出现，由调用方按 UA 判定后传入。 */
  showTutorEntry?: boolean;
  className?: string;
}) {
  const groups = showTutorEntry
    ? NAV_GROUPS
    : NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !item.apkOnly) }));
  return (
    <aside className={`h-screen w-60 shrink-0 flex-col border-r border-line bg-panel px-3 py-5 ${className}`}>
      <div className="mb-7 flex items-center gap-3 px-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-lg font-black text-teal-deep">禾</span>
        <div>
          <div className="font-black text-ink">禾芽家庭教务</div>
          <div className="text-xs text-muted">家庭 AI 私教</div>
        </div>
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {groups.map((group, groupIndex) => (
          <div key={group.title || `group-${groupIndex}`}>
            {group.title && (
              <div className="mb-2 px-3 text-[11px] font-bold tracking-wider text-muted">{group.title}</div>
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = page === item.id;
                const childActive = Boolean(item.children?.some((child) => child.id === page));
                return (
                  <div key={item.id}>
                    <button
                      onClick={() => onNavigate(item.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                        active
                          ? "bg-teal font-bold text-white shadow-[0_8px_18px_rgba(15,118,110,0.22)]"
                          : childActive
                            ? "font-bold text-teal"
                            : "text-ink-soft hover:bg-teal-soft hover:text-teal"
                      }`}
                    >
                      <Icon size={17} />
                      {item.label}
                    </button>
                    {item.children && (
                      <div className="mt-1 space-y-0.5 pl-9">
                        {item.children.map((child) => (
                          <button
                            key={child.id}
                            onClick={() => onNavigate(child.id)}
                            className={`block w-full rounded-lg px-3 py-1.5 text-left text-[13px] transition ${
                              page === child.id ? "bg-teal-soft font-bold text-teal" : "text-muted hover:text-teal"
                            }`}
                          >
                            {child.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button onClick={onLogout} className="mt-5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted hover:bg-accent-soft hover:text-accent">
        <LogOut size={17} />退出登录
      </button>
    </aside>
  );
}

export function Topbar({
  title,
  familyName,
  childName,
  onOpenNav,
}: {
  title: string;
  familyName?: string;
  childName?: string;
  onOpenNav?: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-cream/85 px-3 backdrop-blur md:px-7">
      <div className="flex min-w-0 items-center gap-2">
        {onOpenNav && (
          <button
            type="button"
            aria-label="打开导航"
            onClick={onOpenNav}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-panel text-teal lg:hidden"
          >
            <Menu size={18} />
          </button>
        )}
        <div className="truncate text-lg font-black text-ink">{title}</div>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
        {familyName && (
          <span className="hidden max-w-[160px] truncate rounded-full border border-line bg-panel px-3 py-1.5 sm:inline-block">
            家庭：{familyName}
          </span>
        )}
        {childName && (
          <span className="max-w-[110px] truncate rounded-full border border-line bg-panel px-3 py-1.5">{childName}</span>
        )}
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
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>}
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
  bare = false,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** 去掉边框、圆角、阴影和内边距，交给外层容器当背景板用（浮窗里避免卡片套卡片）。 */
  bare?: boolean;
}) {
  return (
    <section
      className={
        bare
          ? `bg-panel ${className}`
          : `rounded-2xl border border-line bg-panel p-4 shadow-[0_12px_32px_rgba(38,52,59,0.06)] md:p-5 ${className}`
      }
    >
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-extrabold text-ink">{title}</h2>}
            {description && <p className="mt-1 text-xs leading-5 text-muted">{description}</p>}
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
    default: "bg-panel border-line",
    gold: "bg-gold/15 border-amber-200",
    coral: "bg-orange-50 border-orange-200",
    teal: "bg-teal/10 border-teal/20",
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-2 text-2xl font-black text-ink">{value}</div>
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
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
            activeChildId === child.id ? "bg-teal text-white" : "border border-line bg-white text-ink-soft hover:border-teal/40"
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
    muted: "bg-line-soft text-muted",
  }[tone];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${classes}`}>{children}</span>;
}
