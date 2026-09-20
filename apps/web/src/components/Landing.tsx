import {
  ArrowRight,
  BookX,
  Brain,
  ClipboardList,
  GitBranch,
  Plug,
  ShieldCheck,
  Target,
  Workflow,
} from "lucide-react";

/** 站点部署在子路径下，静态资源统一走构建基址，避免出现 404。 */
const asset = (name: string) => `${import.meta.env.BASE_URL}brand/${name}`;

/** 首页：先说清产品是什么，再解释 AI 为什么能懂孩子，最后给接入方式。 */

const HERO_POINTS = [
  {
    icon: Plug,
    title: "接入你在用的智能体",
    text: "WorkBuddy、豆包等支持 MCP 的智能体连上就能用，不绑定某一家的模型。",
  },
  {
    icon: Brain,
    title: "用真实记录做规划",
    text: "先读孩子的错题、掌握度和学科情况，再决定这周练什么，而不是给所有孩子同一套建议。",
  },
  {
    icon: ShieldCheck,
    title: "换智能体不用重来",
    text: "孩子的档案、证据和家庭偏好一直留在你家里，换工具不影响历史记录。",
  },
];

const DIFFERENCES = [
  {
    common: "每次对话都从零开始，不知道孩子上周错在哪、这学期学过什么",
    ours: "AI 连上禾芽先读孩子的真实记录，再开口给建议",
  },
  {
    common: "只会说“多练习”“注意审题”，不知道该练什么",
    ours: "指出具体到哪个知识点，说明判断依据和证据",
  },
  {
    common: "题目做完没有下文，无法判断到底会不会",
    ours: "给出通过标准与复测安排，用变式、迁移题和延迟复测验证",
  },
  {
    common: "换个 AI 工具，之前的对话和数据就断了",
    ours: "数据留在家庭档案里，任何智能体接上来都能继续",
  },
];

const AGENTS = [
  {
    name: "WorkBuddy",
    tag: "已上架连接器与专家",
    text: "在 WorkBuddy 里连接禾芽连接器并扫码授权，对话中即可读取孩子档案、错题掌握情况，并把计划与练习结果写回禾芽。",
  },
  {
    name: "豆包",
    tag: "支持 MCP 接入",
    text: "通过 MCP 协议接入同一个禾芽服务，用豆包做讲解与出题，数据同样落回孩子的家庭档案。",
  },
];

const STEPS = [
  {
    icon: ClipboardList,
    title: "记录真实学习事件",
    text: "作业、错题、练习结果写进禾芽，每道错题都带上错误原因，而不是只记一个分数。",
  },
  {
    icon: Target,
    title: "算出该先管什么",
    text: "按学科汇总掌握度、薄弱知识点和复测到期情况，排出优先级：先补前置知识，再处理重复出错。",
  },
  {
    icon: GitBranch,
    title: "生成计划与练习",
    text: "智能体读取这些事实，制定阶段目标与本周安排，说明练几道、预计多久、什么标准算过。",
  },
  {
    icon: BookX,
    title: "复测验证是否掌握",
    text: "单次答对不算掌握。要有多种变式、迁移题和 24 小时后的延迟复测，掌握了再进入下一个知识点。",
  },
];

const START_STEPS = [
  { title: "微信扫码登录", text: "自动绑定你的家庭，家里多位家长可以共同管理同一份数据。" },
  { title: "让智能体同步记录", text: "在 WorkBuddy 或豆包里把作业、错题和练习结果写进禾芽，也可以手动补充。" },
  { title: "看学科情况与规划", text: "首页按学科给出状态与下一步建议，点进去能看到要解决的问题和通过标准。" },
];

export function Landing({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="app-bg min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-cream/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-lg font-black text-teal-deep">禾</span>
            <div>
              <div className="font-black tracking-normal">禾芽家庭教务</div>
              <div className="text-[11px] text-muted">家庭 AI 私教</div>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <a href="#why" className="hidden rounded-lg px-3 py-2 text-ink-soft hover:bg-white/70 lg:block">为什么更懂孩子</a>
            <a href="#agents" className="hidden rounded-lg px-3 py-2 text-ink-soft hover:bg-white/70 lg:block">接入智能体</a>
            <a href="#how" className="hidden rounded-lg px-3 py-2 text-ink-soft hover:bg-white/70 lg:block">AI 怎么规划</a>
            <button onClick={onLogin} className="flex items-center gap-2 rounded-xl bg-teal px-4 py-2 font-bold text-white hover:bg-teal-deep">
              登录 <ArrowRight size={15} />
            </button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <img src={asset("scene-home.webp")} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0b3a37]/96 via-[#0f4b45]/90 to-[#14655c]/58" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-10 px-5 py-16 md:flex-row md:items-center md:py-20">
          <div className="max-w-2xl text-white">
            <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-[#d6ebe8]">禾芽家庭教务 · 家庭 AI 私教</span>
            <h1 className="mt-5 text-[36px] font-black leading-tight md:text-[50px]">
              家庭 AI 私教
            </h1>
            <p className="mt-4 text-lg font-bold text-[#eaf5f2] md:text-xl">让 AI 比你更懂孩子，再开始教。</p>
            <p className="mt-4 text-[15px] leading-7 text-[#d9ebe8]">
              把孩子每天的作业、错题和练习沉淀成一份可追溯的档案。你正在用的 AI 智能体接上禾芽之后，
              会先读懂孩子现在的位置，再规划下一步学什么、怎么练、什么时候复测。
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button onClick={onLogin} className="flex items-center gap-2 rounded-xl bg-gold px-5 py-3 font-black text-teal-deep hover:bg-[#e8bd52]">
                微信扫码登录
              </button>
              <a href="#agents" className="rounded-xl border border-white/35 px-5 py-3 font-bold text-white hover:bg-white/10">接入我的智能体</a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-xs text-[#c7e2dd]">
              <ShieldCheck size={14} /> 家庭数据仅当前家庭的管理者可见 · 不替孩子完成作业 · 不做医学或心理诊断
            </p>
          </div>
          <div className="relative mx-auto w-full max-w-[260px] md:mx-0 md:ml-auto md:max-w-[300px]">
            <img src={asset("child-boy.png")} alt="禾芽学生形象" className="mx-auto w-40 drop-shadow-[0_18px_30px_rgba(0,0,0,0.25)] md:w-52" />
          </div>
        </div>
      </section>

      <section className="border-b border-line/70 bg-white/55">
        <div className="mx-auto grid max-w-6xl gap-5 px-5 py-10 md:grid-cols-3">
          {HERO_POINTS.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-soft text-teal">
                  <Icon size={20} />
                </span>
                <div>
                  <div className="font-extrabold text-ink">{item.title}</div>
                  <p className="mt-1.5 text-sm leading-7 text-ink-soft">{item.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section id="why" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-black md:text-[30px]">为什么 AI 能更懂孩子</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
          通用的聊天式 AI 能力已经足够强，缺的不是模型，而是关于你孩子的事实。
          禾芽专门负责把这些事实留全、留准，让任何智能体接上来都能像带过他很久一样说话。
        </p>
        <div className="mt-8 overflow-hidden rounded-[18px] border border-line bg-panel">
          <div className="grid grid-cols-1 border-b border-line-soft bg-cream/60 text-xs font-bold text-muted md:grid-cols-2">
            <div className="px-5 py-3">只用聊天式 AI</div>
            <div className="border-t border-line-soft px-5 py-3 text-teal md:border-l md:border-t-0">禾芽 + 你的智能体</div>
          </div>
          {DIFFERENCES.map((row) => (
            <div key={row.common} className="grid grid-cols-1 border-b border-line-soft last:border-b-0 md:grid-cols-2">
              <div className="px-5 py-4 text-sm leading-7 text-muted">{row.common}</div>
              <div className="border-t border-line-soft px-5 py-4 text-sm font-semibold leading-7 text-ink-soft md:border-l md:border-t-0">{row.ours}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="agents" className="border-y border-line/70 bg-white/45">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-black md:text-[30px]">接入你正在用的智能体</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
            禾芽采用 MCP 标准协议对外提供能力，不锁定某一家的模型。智能体负责对话、讲解和出题，禾芽负责孩子的数据、判断依据和掌握验证，
            两边各做擅长的事。
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {AGENTS.map((agent) => (
              <article key={agent.name} className="card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-black">{agent.name}</h3>
                  <span className="rounded-full bg-teal-soft px-3 py-1 text-xs font-bold text-teal">{agent.tag}</span>
                </div>
                <p className="mt-3 text-sm leading-7 text-ink-soft">{agent.text}</p>
              </article>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
            <span className="flex items-center gap-2"><Plug size={14} /> MCP 标准协议，支持 OAuth 扫码授权</span>
            <span className="flex items-center gap-2"><ShieldCheck size={14} /> 家庭数据按家庭隔离，撤销授权后立即失效</span>
            <span className="flex items-center gap-2"><Workflow size={14} /> 换智能体不影响已有记录</span>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-black md:text-[30px]">AI 怎么规划孩子的学习</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
          规划不是凭感觉生成的。每一步都基于前面的真实记录，最终由复测结果来验证这套安排到底有没有用。
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-teal text-sm font-black text-white">{index + 1}</span>
                  <Icon size={18} className="text-teal" />
                  <h3 className="text-base font-extrabold">{step.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-7 text-ink-soft">{step.text}</p>
              </article>
            );
          })}
        </div>
        <p className="mt-5 text-xs leading-6 text-muted">
          单次答对不会被判定为掌握；人工修正的判断优先于系统自动计算，系统只提供依据，不替你下结论。
        </p>
      </section>

      <section id="start" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-black md:text-[30px]">如何开始</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {START_STEPS.map((step, index) => (
            <div key={step.title} className="card p-5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-teal text-sm font-black text-white">{index + 1}</span>
              <h3 className="mt-4 text-base font-extrabold">{step.title}</h3>
              <p className="mt-2 text-sm leading-7 text-ink-soft">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-teal-deep">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-5 py-12 text-white">
          <div>
            <div className="text-xl font-black">先让 AI 了解你的孩子，再开始教</div>
            <div className="mt-2 text-sm text-[#cfe4e0]">微信扫码即可登录，家里多位家长可以共同管理同一个家庭。</div>
          </div>
          <button onClick={onLogin} className="flex items-center gap-2 rounded-xl bg-gold px-5 py-3 font-black text-teal-deep hover:bg-[#e8bd52]">
            登录 <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-5 py-8 text-xs leading-6 text-muted">
        禾芽家庭教务 · 家庭 AI 私教 · 家庭数据仅当前家庭的管理者可见 · 不替孩子完成作业，不做医学或心理诊断
      </footer>
    </div>
  );
}
