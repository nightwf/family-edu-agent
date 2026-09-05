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
import ChildOverview from "./components/ChildOverview";
import GoalPlan from "./components/GoalPlan";
import ChildStateDetail from "./components/ChildStateDetail";
import ParentRelation from "./components/ParentRelation";
import {
  Badge,
  ChildTabs,
  PageHeader,
  Panel,
  Sidebar,
  StatCard,
  Topbar,
  type PageId,
} from "./components/Layout";

type Child = { id: string; name: string; age: number; grade: string; subjects: string[]; textbookVersion?: string };
type Homework = { id: string; childId: string; subject?: string; title: string; dueDate?: string; status: string };
type Knowledge = { id: string; childId: string; kind: string; title: string; content: string; createdAt: string };
type Textbook = { id: string; childId: string; title: string; subject?: string; publisher?: string; version?: string; status: string };
type HomeData = { children: Child[]; reports: any[]; textbooks: Textbook[]; knowledge: Knowledge[]; homework: Homework[]; stats: any };
type SettingsData = {
  workbuddy_open_platform?: {
    connector_name: string;
    expert_name: string;
    minimum_workbuddy_version: string;
    install_steps: string[];
  };
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
  const [page, setPage] = useState<PageId>("home");
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
  const [v2EducationMethods, setV2EducationMethods] = useState<any[]>([]);
  const [familyPolicy, setFamilyPolicy] = useState<any>({});
  const [memberships, setMemberships] = useState<any>({});

  async function load() {
    if (!token) return;
    const [data, settingData, policyData, changeData, familyPolicyData, membershipData] = await Promise.all([
      request("/api/home", {}, token),
      request("/api/settings", {}, token),
      request("/api/policies", {}, token),
      request("/api/policy-changes", {}, token),
      request("/api/v2/family/policy", {}, token),
      request("/api/family/memberships", {}, token),
    ]);
    setHome(data);
    setSettings(settingData);
    setPolicies(policyData);
    setPolicyChanges(changeData);
    setFamilyPolicy(familyPolicyData || {});
    setMemberships(membershipData || {});
    const [educationData, v2MethodData] = await Promise.all([
      request("/api/education-settings", {}, token),
      request("/api/v2/education-methods", {}, token),
    ]);
    setEducationSettings(educationData || {});
    setV2EducationMethods(Array.isArray(v2MethodData) ? v2MethodData : []);
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

  async function saveFamilyPolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request("/api/v2/family/policy", {
      method: "PUT",
      body: JSON.stringify({
        weekly_time_budget: Number(form.get("weekly_time_budget") || 0) || null,
        priority_subjects: String(form.get("priority_subjects") || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
        pressure_boundary: form.get("pressure_boundary"),
        parent_goals: String(form.get("parent_goals") || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      }),
    }, token);
    await load();
  }

  async function switchFamily(familyId: string) {
    const data = await request("/api/family/switch", {
      method: "POST",
      body: JSON.stringify({ familyId }),
    }, token);
    saveToken(data.token);
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
    <div className="flex min-h-screen bg-cream">
      <Sidebar page={page} onNavigate={setPage} onLogout={logout} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={
            page === "home" ? "孩子总览" :
            page === "plan" ? "计划" :
            page === "child-state" ? "孩子状态" :
            page === "relation" ? "亲子关系" :
            page === "students" ? "学生" :
            page === "reports" ? "报告成长" :
            page === "textbooks" ? "教材" :
            page === "questions" ? "题库" :
            page === "wrong-book" ? "错题本" :
            page === "homework" ? "作业" :
            page === "knowledge" ? "知识库" : "设置"
          }
          familyName={settings?.family?.name || home?.stats?.familyName}
          childName={home?.children?.[0]?.name}
        />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-7">
          <div className="mx-auto max-w-[1180px] space-y-5">

          {page === "home" && home && (
            <ChildOverview token={token} children={home.children} home={home} request={request} />
          )}

          {page === "plan" && home && (
            <GoalPlan token={token} children={home.children} request={request} />
          )}

          {page === "child-state" && home && (
            <ChildStateDetail token={token} children={home.children} request={request} />
          )}

          {page === "relation" && home && (
            <ParentRelation token={token} children={home.children} request={request} />
          )}

          {page === "students" && home && (
            <Panel
              title="学生档案"
              description="管理家庭里的孩子基础信息。编辑和删除操作保留在每一行右侧。"
              actions={<button onClick={() => { setEditingChild(null); setChildDialog(true); }} className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-bold text-white"><Plus size={16} />新建孩子</button>}
            >
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
            </Panel>
          )}

          {page === "questions" && home && (
            <div className="space-y-5">
              <PageHeader title="题库" description="家庭题库、题型规则和学生掌握证据。" />
              <QuestionBank token={token} children={home.children} request={request} />
            </div>
          )}

          {page === "wrong-book" && home && (
            <div className="space-y-5">
              <PageHeader title="错题本" description="学生错题、掌握证据和针对性练习。" />
              <WrongBook token={token} children={home.children} request={request} />
            </div>
          )}

          {page === "textbooks" && home && (
            <Panel
              title="教材库"
              description="教材由 WorkBuddy 导入，这里查看来源、版本和处理状态。"
              actions={<button onClick={() => setTextbookDialog(true)} className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-bold text-white"><Plus size={16} />导入教材</button>}
            >
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
            </Panel>
          )}

          {page === "homework" && home && (
            <Panel title="家庭作业" description="查看 WorkBuddy 同步的作业和完成状态" actions={<button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm"><RefreshCw size={16} />刷新</button>}>
              <div className="space-y-3">
                {home.homework.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-white p-3">
                    <div><div className="font-semibold">{item.title}</div><div className="text-sm text-stone-500">{childName(home.children, item.childId)} · {item.dueDate || "-"}</div></div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs ${item.status === "done" ? "bg-teal/10 text-teal" : "bg-amber-100 text-amber-700"}`}>{item.status === "done" ? "已完成" : "待完成"}</span>
                      {item.status !== "done" && <button onClick={() => completeHomework(item.id)} className="text-teal">完成</button>}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {page === "knowledge" && home && (
            <Panel title="知识库" description="家庭积累的结构化知识和来源" actions={<button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm"><RefreshCw size={16} />刷新</button>}>
              <div className="space-y-4">
                {home.knowledge.map((item) => (
                  <div key={item.id} className="rounded-xl border border-stone-100 bg-white p-3">
                    <div className="flex items-center justify-between"><div className="font-semibold">{item.title}</div><span className="text-xs text-teal">{childName(home.children, item.childId)}</span></div>
                    <p className="mt-2 text-sm text-stone-600">{item.content}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {page === "settings" && (
            <Panel title="账号设置" description="管理家庭、连接和数据边界">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-stone-500">登录邮箱</span><span>{settings?.user?.email || "-"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">家庭编号</span><span>{settings?.family?.id || "-"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">家庭角色</span><span>{settings?.member?.role === "owner" ? "创建者" : "管理者"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">孩子数量</span><span>{settings?.child_count || 0} 个</span></div>
              </div>
              <div className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
                <h3 className="font-semibold">家庭边界</h3>
                <form onSubmit={saveFamilyPolicy} className="mt-4 space-y-3">
                  <input name="weekly_time_budget" type="number" defaultValue={familyPolicy.weeklyTimeBudget ?? ""} className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="每周学习时间预算（分钟）" />
                  <input name="priority_subjects" defaultValue={(familyPolicy.prioritySubjects || []).join("、")} className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="优先学科，多个用顿号分隔" />
                  <input name="pressure_boundary" defaultValue={familyPolicy.pressureBoundary || ""} className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="压力边界，例如：不通过催促完成学习" />
                  <input name="parent_goals" defaultValue={(familyPolicy.parentGoals || []).join("、")} className="w-full rounded-lg border border-stone-200 px-3 py-2" placeholder="家长目标，多个用顿号分隔" />
                  <button className="rounded-lg bg-teal px-4 py-2 text-white">保存家庭边界</button>
                </form>
              </div>
              {memberships.memberships?.length > 1 && (
                <div className="mt-5 rounded-lg border border-stone-200 bg-white p-4">
                  <h3 className="font-semibold">我的家庭</h3>
                  <div className="mt-3 space-y-2">
                    {memberships.memberships.map((item: any) => (
                      <div key={item.family.id} className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 p-3">
                        <div>
                          <div className="font-medium">{item.family.name}</div>
                          <div className="text-xs text-stone-500">{item.role === "owner" ? "创建者" : "管理者"}</div>
                        </div>
                        {memberships.current_family_id === item.family.id ? (
                          <span className="rounded-full bg-teal/10 px-3 py-1 text-xs text-teal">当前家庭</span>
                        ) : (
                          <button onClick={() => switchFamily(item.family.id)} className="rounded-lg border border-teal px-3 py-1 text-sm text-teal">切换</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                  <div>
                    <h3 className="font-semibold">WorkBuddy 开放平台连接</h3>
                    <p className="mt-1 text-sm text-stone-500">安装连接器后只需配置一次家庭 Token，Expert 会自动读取禾芽规范。</p>
                  </div>
                  <button onClick={() => copyAgentPrompt(settings?.mcp_token, "mcp-token")} className="inline-flex shrink-0 items-center gap-1 text-teal"><Copy size={16} />{copyStatus === "mcp-token" ? "已复制" : "复制 Token"}</button>
                </div>
                {settings?.mcp_token && (
                  <div className="mb-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
                    <div className="mb-1 font-semibold text-stone-500">家庭专属 Token</div>
                    <code className="break-all">{settings.mcp_token}</code>
                  </div>
                )}
                <ol className="space-y-2 text-sm leading-6 text-stone-600">
                  {(settings?.workbuddy_open_platform?.install_steps || []).map((step, index) => <li key={step}>{index + 1}. {step}</li>)}
                </ol>
                <div className="mt-4 border-t border-stone-100 pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-stone-600">手动连接备用提示词</h4>
                    <button onClick={() => copyAgentPrompt(settings?.workbuddy_prompt, "workbuddy")} className="inline-flex items-center gap-1 text-teal"><Copy size={16} />{copyStatus === "workbuddy" ? "已复制" : "复制备用配置"}</button>
                  </div>
                  <textarea readOnly value={settings?.workbuddy_prompt || ""} className="h-40 w-full rounded-lg border border-stone-200 p-3 text-sm" />
                </div>
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
                <h3 className="font-semibold">教育方法库</h3>
                <p className="mt-1 text-sm text-stone-500">公共方法由禾芽统一维护，家庭只设置边界；这里只展示方法用途和证据强度。</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {v2EducationMethods.map((method: any) => (
                    <div key={method.id} className="rounded-lg border border-stone-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold">{method.name}</div>
                        <span className="rounded-full bg-teal/10 px-2 py-1 text-xs text-teal">{method.category}</span>
                      </div>
                      <p className="mt-2 text-sm text-stone-600">{method.description}</p>
                      <div className="mt-2 text-xs text-stone-500">证据强度：{method.evidenceLevel} · 版本 {method.version}</div>
                    </div>
                  ))}
                </div>
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
            </Panel>
          )}

          {page === "reports" && (
            <Panel title="报告与成长轨迹" description="查看成长记录、周报和阶段报告">
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
            </Panel>
          )}
          </div>
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
