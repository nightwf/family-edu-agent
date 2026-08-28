import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  BookMarked,
  BookX,
  Check,
  ClipboardCheck,
  Copy,
  Edit,
  LayoutDashboard,
  Library,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  Trash,
  TrendingUp,
  Users,
} from "lucide-react";
import RecordDetail from "./components/RecordDetail";
import QuestionBank from "./components/QuestionBank";
import WrongBook from "./components/WrongBook";

type Child = { id: string; name: string; age: number; grade: string; subjects: string[]; textbookVersion?: string };
type Homework = { id: string; childId: string; subject?: string; title: string; dueDate?: string; status: string };
type Knowledge = { id: string; childId: string; kind: string; title: string; content: string; createdAt: string };
type Textbook = { id: string; childId: string; title: string; subject?: string; publisher?: string; version?: string; status: string };
type HomeData = { children: Child[]; reports: any[]; textbooks: Textbook[]; knowledge: Knowledge[]; homework: Homework[]; stats: any };
type SettingsData = {
  workbuddy_prompt?: string;
  doubao_prompt?: string;
  mcp_token?: string;
  user?: any;
  family?: any;
  member?: any;
  members?: any[];
  invites?: any[];
  child_count?: number;
};

const PAGES = [
  { id: "home", label: "首页", icon: LayoutDashboard },
  { id: "students", label: "学生", icon: Users },
  { id: "reports", label: "报告成长", icon: TrendingUp },
  { id: "textbooks", label: "教材", icon: BookOpen },
  { id: "questions", label: "题库", icon: BookMarked },
  { id: "wrong-book", label: "错题本", icon: BookX },
  { id: "homework", label: "作业", icon: ClipboardCheck },
  { id: "knowledge", label: "知识库", icon: Library },
  { id: "settings", label: "设置", icon: Settings },
];

const apiBase = location.pathname.startsWith("/family-edu/") ? "/family-edu" : "";

async function request(path: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function childName(children: Child[], childId: string) {
  return children.find((child) => child.id === childId)?.name || "-";
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("familyEduToken") || "");
  const [page, setPage] = useState("home");
  const [home, setHome] = useState<HomeData | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [childDialog, setChildDialog] = useState(false);
  const [editingChild, setEditingChild] = useState<Child | null>(null);
  const [textbookDialog, setTextbookDialog] = useState(false);
  const [reportData, setReportData] = useState<{ records: any[]; reports: any[]; growth: any[] } | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [policies, setPolicies] = useState<any[]>([]);
  const [policyChanges, setPolicyChanges] = useState<any[]>([]);
  const [educationSettings, setEducationSettings] = useState<any>({});
  const [educationMethods, setEducationMethods] = useState<any>(null);

  async function load() {
    if (!token) return;
    const [data, settingData, policyData, changeData] = await Promise.all([
      request("/api/home", {}, token),
      request("/api/settings", {}, token),
      request("/api/policies", {}, token),
      request("/api/policy-changes", {}, token),
    ]);
    setHome(data);
    setSettings(settingData);
    setPolicies(policyData);
    setPolicyChanges(changeData);
    const educationData = await request("/api/education-settings", {}, token);
    setEducationSettings(educationData || {});
    const methodData = await request("/api/education-methods", {}, token);
    setEducationMethods(methodData);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [token]);

  useEffect(() => {
    if (page !== "reports" || !home?.children.length) return;
    const childId = home.children[0].id;
    Promise.all([
      request(`/api/children/${childId}/records`, {}, token),
      request(`/api/children/${childId}/reports`, {}, token),
      request(`/api/children/${childId}/growth`, {}, token),
    ]).then(([records, reports, growth]) => setReportData({ records, reports, growth })).catch(() => {});
  }, [page, home, token]);

  function saveToken(next: string) {
    localStorage.setItem("familyEduToken", next);
    setToken(next);
  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const data = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      saveToken(data.token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const data = await request("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          inviteCode: form.get("inviteCode"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      saveToken(data.token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function logout() {
    await request("/api/auth/logout", { method: "POST" }, token).catch(() => {});
    localStorage.removeItem("familyEduToken");
    setToken("");
  }

  async function copyAgentPrompt(prompt?: string, source = "workbuddy") {
    if (!prompt) return;
    let text = prompt;
    if (settings.mcp_token && !text.includes(settings.mcp_token)) {
      text += `\n\nX-MCP-Token: ${settings.mcp_token}`;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyStatus(source);
    } catch (_error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopyStatus(source);
    }
    setTimeout(() => setCopyStatus(""), 1500);
  }

  async function submitChild(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"),
      age: Number(form.get("age")),
      grade: form.get("grade"),
      subjects: String(form.get("subjects") || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      textbook_version: form.get("textbook_version"),
    };
    if (editingChild) {
      await request(`/api/children/${editingChild.id}`, { method: "PATCH", body: JSON.stringify(payload) }, token);
    } else {
      await request("/api/children", { method: "POST", body: JSON.stringify(payload) }, token);
    }
    setChildDialog(false);
    setEditingChild(null);
    await load();
  }

  async function deleteChild(child: Child) {
    if (!window.confirm(`确定删除“${child.name}”吗？相关记录会同步删除。`)) return;
    await request(`/api/children/${child.id}`, { method: "DELETE" }, token);
    await load();
  }

  async function submitTextbook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      await request("/api/textbooks/upload", { method: "POST", body: form }, token);
    } else {
      await request("/api/textbooks", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      }, token);
    }
    setTextbookDialog(false);
    await load();
  }

  async function completeHomework(id: string) {
    await request(`/api/homework/${id}/complete`, { method: "POST" }, token);
    await load();
  }

  async function deleteTextbook(id: string) {
    if (!window.confirm("确定删除这本教材吗？")) return;
    await request(`/api/textbooks/${id}`, { method: "DELETE" }, token);
    await load();
  }

  async function saveEducationSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request(`/api/education-settings`, {
      method: "PATCH",
      body: JSON.stringify({
        education_philosophy: form.get("education_philosophy"),
        communication_style: form.get("communication_style"),
        strictness: form.get("strictness"),
        parent_goals: String(form.get("parent_goals") || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      }),
    }, token);
    await load();
  }

  async function reviewPolicy(changeId: string, action: "approved" | "ignored") {
    await request(`/api/policy-changes/${changeId}/review`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }, token);
    await load();
  }

  async function createFamilyInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const invite = await request("/api/family/invites", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email") }),
    }, token);
    await navigator.clipboard?.writeText(invite.inviteCode).catch(() => {});
    (event.currentTarget as HTMLFormElement).reset();
    await load();
  }

  async function cancelFamilyInvite(inviteId: string) {
    if (!window.confirm("确定取消这个家庭邀请吗？")) return;
    await request(`/api/family/invites/${inviteId}`, { method: "DELETE" }, token);
    await load();
  }

  async function removeFamilyMember(member: any) {
    if (!window.confirm(`确定移除“${member.user?.email || "这个管理者"}”吗？`)) return;
    await request(`/api/family/members/${member.id}`, { method: "DELETE" }, token);
    await load();
  }

  async function acceptFamilyInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await request("/api/family/invites/accept", {
      method: "POST",
      body: JSON.stringify({ inviteCode: form.get("inviteCode") }),
    }, token);
    saveToken(data.token);
    await load();
  }

  const activePage = PAGES.find((item) => item.id === page)!;
  const ActiveIcon = activePage.icon;

  if (!token) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-stone-200 bg-panel p-6 shadow-sm">
          <div className="flex gap-2">
            <button onClick={() => setAuthMode("login")} className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${authMode === "login" ? "bg-teal text-white" : "bg-stone-100"}`}>登录</button>
            <button onClick={() => setAuthMode("register")} className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${authMode === "register" ? "bg-teal text-white" : "bg-stone-100"}`}>邀请码注册</button>
          </div>
          {authMode === "login" ? (
            <form onSubmit={login} className="mt-5 space-y-4">
              <input name="email" className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="邮箱" />
              <input name="password" type="password" className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="密码" />
              <button className="w-full rounded-lg bg-accent px-4 py-2 text-white">登录</button>
            </form>
          ) : (
            <form onSubmit={register} className="mt-5 space-y-4">
              <input name="inviteCode" defaultValue="HE-2026" className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="邀请码" />
              <input name="email" className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="邮箱" />
              <input name="password" type="password" className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="密码" />
              <button className="w-full rounded-lg bg-accent px-4 py-2 text-white">注册并登录</button>
            </form>
          )}
          {error && <p className="mt-3 text-sm text-accent">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-panel/90 px-4 py-3">
        <div className="flex items-center gap-2 font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-ink">禾</span>
          <span>禾芽家庭教务</span>
        </div>
        <button onClick={logout} className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"><LogOut size={16} />退出登录</button>
      </header>

      <div className="flex flex-col md:flex-row">
        <aside className="grid grid-cols-3 gap-2 border-b border-stone-200 bg-[#23353b] p-3 text-white sm:grid-cols-4 md:flex md:min-h-screen md:w-56 md:flex-col md:border-b-0">
          {PAGES.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setPage(item.id)} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm md:justify-start ${page === item.id ? "bg-teal text-white" : "text-white/75"}`}>
                <Icon size={17} />{item.label}
              </button>
            );
          })}
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold md:text-3xl">{activePage.label}</h1>
          </div>

          {page === "home" && home && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["成长记录", home.stats.records || 0],
                  ["作文完成", `${home.stats.writing || 0} 篇`],
                  ["阅读复述", `${home.stats.reading || 0}%`],
                  ["作业完成度", `${home.stats.homework || 0}%`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-stone-200 bg-panel p-4">
                    <div className="text-sm text-stone-500">{label}</div>
                    <div className="mt-2 text-3xl font-bold">{value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-stone-200 bg-panel p-4">
                <h2 className="mb-3 font-semibold">孩子</h2>
                <div className="space-y-3">
                  {home.children.map((child) => (
                    <div key={child.id} className="flex items-center justify-between gap-3 border-b border-dashed border-stone-200 pb-3">
                      <div>
                        <div className="font-semibold">{child.name}</div>
                        <div className="text-sm text-stone-500">{child.grade} · {child.subjects.join(" / ")}</div>
                      </div>
                      <span className="rounded-full bg-teal/10 px-3 py-1 text-xs text-teal">已建档</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {page === "students" && home && (
            <div className="rounded-lg border border-stone-200 bg-panel p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">学生档案</h2>
                <button onClick={() => { setEditingChild(null); setChildDialog(true); }} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white"><Plus size={16} />新建孩子</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead>
                    <tr className="text-left text-stone-500">
                      <th className="px-2 py-2">孩子</th>
                      <th className="px-2 py-2">年龄 / 年级</th>
                      <th className="px-2 py-2">学科</th>
                      <th className="px-2 py-2">教材版本</th>
                      <th className="px-2 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {home.children.map((child) => (
                      <tr key={child.id} className="border-t border-stone-200">
                        <td className="px-2 py-3 font-semibold">{child.name}</td>
                        <td className="px-2 py-3">{child.age} 岁 / {child.grade}</td>
                        <td className="px-2 py-3">{child.subjects.join("、")}</td>
                        <td className="px-2 py-3">{child.textbookVersion || "未设置"}</td>
                        <td className="px-2 py-3">
                          <button onClick={() => { setEditingChild(child); setChildDialog(true); }} className="text-teal"><Edit size={16} /></button>
                          <button onClick={() => deleteChild(child)} className="ml-2 text-accent"><Trash size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === "questions" && home && (
            <QuestionBank token={token} children={home.children} request={request} />
          )}

          {page === "wrong-book" && home && (
            <WrongBook token={token} children={home.children} request={request} />
          )}

          {page === "textbooks" && home && (
            <div className="rounded-lg border border-stone-200 bg-panel p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">教材库</h2>
                <button onClick={() => setTextbookDialog(true)} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white"><Plus size={16} />导入教材</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead><tr className="text-left text-stone-500"><th className="px-2 py-2">教材</th><th className="px-2 py-2">孩子</th><th className="px-2 py-2">状态</th><th className="px-2 py-2">操作</th></tr></thead>
                  <tbody>
                    {home.textbooks.map((item) => (
                      <tr key={item.id} className="border-t border-stone-200">
                        <td className="px-2 py-3 font-semibold">{item.title}</td>
                        <td className="px-2 py-3">{childName(home.children, item.childId)}</td>
                        <td className="px-2 py-3">{item.status === "ready" ? "已就绪" : "识别中"}</td>
                        <td className="px-2 py-3"><button onClick={() => deleteTextbook(item.id)} className="text-accent"><Trash size={16} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === "homework" && home && (
            <div className="rounded-lg border border-stone-200 bg-panel p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">家庭作业</h2>
                <button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm"><RefreshCw size={16} />刷新</button>
              </div>
              <div className="space-y-3">
                {home.homework.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 border-b border-dashed border-stone-200 pb-3">
                    <div><div className="font-semibold">{item.title}</div><div className="text-sm text-stone-500">{childName(home.children, item.childId)} · {item.dueDate || "-"}</div></div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs ${item.status === "done" ? "bg-teal/10 text-teal" : "bg-amber-100 text-amber-700"}`}>{item.status === "done" ? "已完成" : "待完成"}</span>
                      {item.status !== "done" && <button onClick={() => completeHomework(item.id)} className="text-teal">完成</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {page === "knowledge" && home && (
            <div className="rounded-lg border border-stone-200 bg-panel p-4">
              <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">知识库</h2><button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm"><RefreshCw size={16} />刷新</button></div>
              <div className="space-y-4">
                {home.knowledge.map((item) => (
                  <div key={item.id} className="border-b border-dashed border-stone-200 pb-4">
                    <div className="flex items-center justify-between"><div className="font-semibold">{item.title}</div><span className="text-xs text-teal">{childName(home.children, item.childId)}</span></div>
                    <p className="mt-2 text-sm text-stone-600">{item.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {page === "settings" && (
            <div className="rounded-lg border border-stone-200 bg-panel p-4">
              <h2 className="mb-4 font-semibold">账号设置</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-stone-500">登录邮箱</span><span>{settings?.user?.email || "-"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">家庭编号</span><span>{settings?.family?.id || "-"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">家庭角色</span><span>{settings?.member?.role === "owner" ? "创建者" : "管理者"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">孩子数量</span><span>{settings?.child_count || 0} 个</span></div>
              </div>
              <div className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">家庭管理者</h3>
                    <p className="mt-1 text-sm text-stone-500">多个账号可以共同查看和管理同一个家庭数据。</p>
                  </div>
                  <span className="rounded-full bg-teal/10 px-3 py-1 text-xs text-teal">{settings?.members?.length || 0} 人</span>
                </div>
                <div className="mt-4 divide-y divide-stone-100">
                  {(settings?.members || []).map((member) => (
                    <div key={member.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{member.user?.wechatNickname || member.user?.email || "未命名账号"}</div>
                        <div className="mt-1 text-xs text-stone-500">{member.role === "owner" ? "创建者" : "管理者"} · {member.joinedAt ? member.joinedAt.slice(0, 10) : "待同步"}</div>
                      </div>
                      {settings?.member?.role === "owner" && member.role !== "owner" ? (
                        <button onClick={() => removeFamilyMember(member)} className="shrink-0 rounded-lg border border-accent px-3 py-1 text-sm text-accent">移除</button>
                      ) : (
                        <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-500">{member.role === "owner" ? "创建者" : "管理者"}</span>
                      )}
                    </div>
                  ))}
                </div>
                {settings?.member?.role === "owner" && (
                  <form onSubmit={createFamilyInvite} className="mt-4 grid gap-2 border-t border-stone-100 pt-4 md:grid-cols-[1fr_auto]">
                    <input name="email" className="rounded-lg border border-stone-200 px-3 py-2 text-sm" placeholder="对方邮箱，可不填" />
                    <button className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm text-white"><Plus size={16} />生成家庭邀请码</button>
                  </form>
                )}
                {(settings?.invites || []).length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-stone-100 pt-4">
                    <div className="text-sm font-semibold text-stone-500">待接受邀请</div>
                    {(settings?.invites || []).map((invite) => (
                      <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-stone-50 p-3 text-sm">
                        <div>
                          <code className="font-semibold">{invite.inviteCode}</code>
                          <div className="mt-1 text-xs text-stone-500">{invite.inviteEmail || "未限定邮箱"} · {invite.expiresAt?.slice(0, 10)} 到期</div>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => navigator.clipboard?.writeText(invite.inviteCode)} className="rounded-lg border border-stone-200 px-3 py-1">复制</button>
                          {settings?.member?.role === "owner" && <button type="button" onClick={() => cancelFamilyInvite(invite.id)} className="rounded-lg border border-accent px-3 py-1 text-accent">取消</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <form onSubmit={acceptFamilyInvite} className="mt-4 grid gap-2 border-t border-stone-100 pt-4 md:grid-cols-[1fr_auto]">
                  <input name="inviteCode" className="rounded-lg border border-stone-200 px-3 py-2 text-sm" placeholder="输入别人发来的家庭邀请码" />
                  <button className="rounded-lg border border-teal px-4 py-2 text-sm text-teal">加入对方家庭</button>
                </form>
              </div>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">WorkBuddy 连接提示词</h3>
                  <button onClick={() => copyAgentPrompt(settings?.workbuddy_prompt, "workbuddy")} className="inline-flex items-center gap-1 text-teal"><Copy size={16} />{copyStatus === "workbuddy" ? "已复制" : "复制"}</button>
                </div>
                {settings?.mcp_token && (
                  <div className="mb-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
                    <div className="mb-1 font-semibold text-stone-500">家庭专属 MCP Token</div>
                    <code className="break-all">{settings.mcp_token}</code>
                  </div>
                )}
                <textarea readOnly value={settings?.workbuddy_prompt || ""} className="h-56 w-full rounded-lg border border-stone-200 p-3 text-sm" />
              </div>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">豆包工作连接提示词</h3>
                  <button onClick={() => copyAgentPrompt(settings?.doubao_prompt, "doubao")} className="inline-flex items-center gap-1 text-teal"><Copy size={16} />{copyStatus === "doubao" ? "已复制" : "复制"}</button>
                </div>
                <p className="mb-3 text-sm leading-6 text-stone-500">用于在豆包工作里复用同一套家庭教育规则和家庭专属 MCP Token。</p>
                <textarea readOnly value={settings?.doubao_prompt || ""} className="h-56 w-full rounded-lg border border-stone-200 p-3 text-sm" />
              </div>
              <div className="mt-6">
                <h3 className="font-semibold">家庭教育方式</h3>
                <form onSubmit={saveEducationSettings} className="mt-4 space-y-3">
                  <select name="education_philosophy" defaultValue={educationSettings.educationPhilosophy || "以引导和鼓励为主"} className="w-full rounded-lg border border-stone-200 px-3 py-2">
                    <option value="以引导和鼓励为主">以引导和鼓励为主</option>
                    <option value="兴趣优先">兴趣优先</option>
                    <option value="习惯优先">习惯优先</option>
                    <option value="成绩与能力并重">成绩与能力并重</option>
                    <option value="自主探索">自主探索</option>
                  </select>
                  <select name="communication_style" defaultValue={educationSettings.communicationStyle || "温和直接"} className="w-full rounded-lg border border-stone-200 px-3 py-2">
                    <option value="温和直接">温和直接</option>
                    <option value="鼓励为主">鼓励为主</option>
                    <option value="简洁明确">简洁明确</option>
                    <option value="陪伴讨论">陪伴讨论</option>
                  </select>
                  <select name="strictness" defaultValue={educationSettings.strictness || "适中"} className="w-full rounded-lg border border-stone-200 px-3 py-2">
                    <option value="宽松">宽松</option>
                    <option value="适中">适中</option>
                    <option value="严格">严格</option>
                  </select>
                  <input name="parent_goals" defaultValue={(educationSettings.parentGoals || []).join("、")} className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="家长目标，多个用顿号分隔" />
                  <button className="rounded-lg bg-teal px-4 py-2 text-white">保存教育方式</button>
                </form>
                {educationMethods?.recommended?.length ? (
                  <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
                    <div className="mb-2 text-sm font-semibold text-stone-500">系统将重点使用</div>
                    <div className="flex flex-wrap gap-2">
                      {educationMethods.recommended.map((method: any) => (
                        <span key={method.id} className="rounded-full bg-teal/10 px-3 py-1 text-xs text-teal">
                          {method.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="mt-6">
                <h3 className="font-semibold">优化建议</h3>
                <div className="mt-3 space-y-3">
                  {policyChanges.filter((item) => item.status === "proposed").map((item) => (
                    <div key={item.id} className="rounded-lg border border-stone-200 p-3">
                      <div className="font-medium">{item.summary || item.type}</div>
                      {item.reason && <p className="mt-1 text-sm text-stone-500">{item.reason}</p>}
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => reviewPolicy(item.id, "approved")} className="rounded-lg bg-teal px-3 py-1 text-sm text-white">采纳</button>
                        <button onClick={() => reviewPolicy(item.id, "ignored")} className="rounded-lg border border-stone-200 px-3 py-1 text-sm">忽略</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={logout} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-accent px-4 py-2 text-accent"><LogOut size={16} />退出登录</button>
            </div>
          )}

          {page === "reports" && (
            <div className="rounded-lg border border-stone-200 bg-panel p-4">
              <h2 className="mb-4 font-semibold">报告与成长轨迹</h2>
              {reportData ? (
                <div className="space-y-5">
                  <div>
                    <h3 className="mb-2 font-semibold">成长记录</h3>
                    {reportData.records.map((record) => (
                      <button key={record.id} type="button" onClick={() => setSelectedRecord(record)} className="block w-full border-b border-dashed border-stone-200 py-2 text-left">
                        <div className="font-medium">{record.title}</div>
                        <div className="text-sm text-stone-500">{record.date?.slice(0, 10)} · {record.type} · {record.score}</div>
                      </button>
                    ))}
                  </div>
                  <div>
                    <h3 className="mb-2 font-semibold">报告</h3>
                    {reportData.reports.map((report) => (
                      <div key={report.id} className="border-b border-dashed border-stone-200 py-2">
                        <div className="font-medium">{report.title}</div>
                        <p className="text-sm text-stone-600">{report.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="text-stone-500">暂无数据。</p>}
            </div>
          )}
        </main>
      </div>

      {childDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submitChild} className="w-full max-w-md space-y-3 rounded-lg bg-panel p-5">
            <h2 className="font-bold">{editingChild ? "编辑孩子档案" : "新建孩子"}</h2>
            <input name="name" defaultValue={editingChild?.name} required className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="姓名" />
            <input name="age" type="number" defaultValue={editingChild?.age} required className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="年龄" />
            <input name="grade" defaultValue={editingChild?.grade} required className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="年级" />
            <input name="subjects" defaultValue={editingChild?.subjects.join("、")} className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="学科" />
            <input name="textbook_version" defaultValue={editingChild?.textbookVersion} className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="教材版本" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setChildDialog(false); setEditingChild(null); }} className="rounded-lg border border-stone-200 px-3 py-2">取消</button>
              <button className="rounded-lg bg-accent px-4 py-2 text-white">保存</button>
            </div>
          </form>
        </div>
      )}

      {textbookDialog && home && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submitTextbook} className="w-full max-w-md space-y-3 rounded-lg bg-panel p-5">
            <h2 className="font-bold">导入教材</h2>
            <select name="child_id" className="w-full rounded-lg border border-stone-200 px-3 py-2">
              {home.children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}
            </select>
            <input name="title" required className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="教材名称" />
            <input name="subject" className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="学科" />
            <input name="grade" className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="年级" />
            <input name="publisher" className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="出版社" />
            <input name="version" className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="版本" />
            <input name="file" type="file" className="w-full rounded-lg border border-stone-200 px-3 py-2" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setTextbookDialog(false)} className="rounded-lg border border-stone-200 px-3 py-2">取消</button>
              <button className="rounded-lg bg-accent px-4 py-2 text-white">导入</button>
            </div>
          </form>
        </div>
      )}

      {selectedRecord && (
        <RecordDetail
          record={selectedRecord}
          childName={home ? childName(home.children, selectedRecord.childId) : "-"}
          onClose={() => setSelectedRecord(null)}
        />
      )}
    </div>
  );
}

export default App;
