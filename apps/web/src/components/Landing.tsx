import { ArrowRight, BookX, GitBranch, LineChart, ShieldCheck, Workflow } from "lucide-react";

/** 站点部署在子路径下，静态资源统一走构建基址，避免出现 404。 */
const asset = (name: string) => `${import.meta.env.BASE_URL}brand/${name}`;

/**
 * 网站首页：面向家长介绍系统做什么，右上角提供登录入口。
 * 文案只讲产品事实，不承诺分数或效果。
 */

const FEATURES = [
  {
    icon: LineChart,
    title: "学科视角的学情",
    text: "按孩子档案里的关注学科逐科汇总掌握度、薄弱知识点和复测到期情况，先说清哪一科需要先管。",
  },
  {
    icon: BookX,
    title: "从错题到掌握的证据链",
    text: "每道错题记录错误原因，经过变式、迁移题和延迟复测才判定为掌握，单次答对不算。",
  },
  {
    icon: GitBranch,
    title: "题型对应教材知识点",
    text: "题型关联到教材知识点和前置依赖，能找到真正卡住的地方，而不是只看分数高低。",
  },
  {
    icon: Workflow,
    title: "和 WorkBuddy 协同",
    text: "对话、讲解、出题交给 WorkBuddy；禾芽负责保存真实记录、计算优先级并验证是否真的掌握。",
  },
];

const STEPS = [
  { title: "微信扫码登录", text: "用微信扫码进入，自动绑定你的家庭，家里多位家长可以共同管理。" },
  { title: "同步真实记录", text: "让 WorkBuddy 把作业、错题和练习结果写进来，也可以手动补充。" },
  { title: "查看学科情况", text: "首页按学科给出状态与下一步建议，点进去能看到具体要解决的问题和通过标准。" },
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
              <div className="text-[11px] text-muted">孩子的成长，值得被看见</div>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <a href="#features" className="hidden rounded-lg px-3 py-2 text-ink-soft hover:bg-white/70 md:block">系统做什么</a>
            <a href="#screens" className="hidden rounded-lg px-3 py-2 text-ink-soft hover:bg-white/70 md:block">界面预览</a>
            <a href="#start" className="hidden rounded-lg px-3 py-2 text-ink-soft hover:bg-white/70 md:block">如何开始</a>
            <button onClick={onLogin} className="flex items-center gap-2 rounded-xl bg-teal px-4 py-2 font-bold text-white hover:bg-teal-deep">
              登录 <ArrowRight size={15} />
            </button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <img src={asset("scene-home.webp")} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0b3a37]/95 via-[#0f4b45]/88 to-[#14655c]/55" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-10 px-5 py-16 md:flex-row md:items-center md:py-20">
          <div className="max-w-xl text-white">
            <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-[#d6ebe8]">家庭 AI 私教</span>
            <h1 className="mt-5 text-[34px] font-black leading-tight md:text-[46px]">
              把孩子的学习变化，放进同一个家庭档案
            </h1>
            <p className="mt-5 text-[15px] leading-7 text-[#d9ebe8]">
              记录每天真实的作业、错题和练习结果。系统自动汇总每个学科的掌握情况，指出现在最该解决的问题，
              并说明用什么方式练、练到什么程度算过、什么时候复测。
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button onClick={onLogin} className="flex items-center gap-2 rounded-xl bg-gold px-5 py-3 font-black text-teal-deep hover:bg-[#e8bd52]">
                微信扫码登录
              </button>
              <a href="#features" className="rounded-xl border border-white/35 px-5 py-3 font-bold text-white hover:bg-white/10">系统做什么</a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-xs text-[#c7e2dd]">
              <ShieldCheck size={14} /> 家庭数据仅当前家庭的管理者可见，不做医学或心理诊断
            </p>
          </div>
          <div className="relative mx-auto w-full max-w-[260px] md:mx-0 md:ml-auto md:max-w-[300px]">
            <img src={asset("child-boy.png")} alt="禾芽学生形象" className="mx-auto w-40 drop-shadow-[0_18px_30px_rgba(0,0,0,0.25)] md:w-52" />
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-black md:text-[30px]">系统做什么</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
          禾芽不替孩子做题，也不给分数排名。它把散落在每天的作业、错题和练习变成可追溯的证据，回答一个问题：这个孩子下一步该学什么。
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {FEATURES.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="card p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-soft text-teal">
                  <Icon size={19} />
                </span>
                <h3 className="mt-4 text-base font-extrabold">{item.title}</h3>
                <p className="mt-2 text-sm leading-7 text-ink-soft">{item.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="screens" className="border-y border-line/70 bg-white/45">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-black md:text-[30px]">界面预览</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
            手机端负责随时查看，电脑端负责整理和配置，两端是同一份数据。下面是手机端的首页与学科详情。
          </p>
          <div className="mt-8 flex flex-wrap items-start gap-8">
            <figure className="w-[240px]">
              <div className="rounded-[28px] border border-line bg-panel p-2 shadow-[0_18px_40px_rgba(32,50,56,0.14)]">
                <img src={asset("preview-home.png")} alt="手机端首页：整体状态与各学科情况" className="w-full rounded-[22px]" />
              </div>
              <figcaption className="mt-3 text-xs leading-6 text-muted">首页：孩子整体状态与各学科情况</figcaption>
            </figure>
            <figure className="w-[240px]">
              <div className="rounded-[28px] border border-line bg-panel p-2 shadow-[0_18px_40px_rgba(32,50,56,0.14)]">
                <img src={asset("preview-subject.png")} alt="手机端学科详情：问题与规划建议" className="w-full rounded-[22px]" />
              </div>
              <figcaption className="mt-3 text-xs leading-6 text-muted">学科详情：需要先解决的问题与规划建议</figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section id="start" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-black md:text-[30px]">如何开始</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
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
            <div className="text-xl font-black">登录后查看孩子当前的学科情况</div>
            <div className="mt-2 text-sm text-[#cfe4e0]">微信扫码即可进入，家里多位家长可以共同管理同一个家庭。</div>
          </div>
          <button onClick={onLogin} className="flex items-center gap-2 rounded-xl bg-gold px-5 py-3 font-black text-teal-deep hover:bg-[#e8bd52]">
            登录 <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-5 py-8 text-xs leading-6 text-muted">
        禾芽家庭教务 · 家庭数据仅当前家庭的管理者可见 · 不替孩子完成作业，不做医学或心理诊断
      </footer>
    </div>
  );
}
