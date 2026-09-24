/**
 * 校验电脑端 / 平板端 / 手机端的响应式布局。
 *
 * 作用：安卓客户端只是承载线上站点，所以手机与平板能不能用，
 * 取决于网页本身在窄屏下的表现。这里用真实浏览器渲染，
 * 接口用桩数据，避免碰生产数据。
 *
 * 用法：node scripts/verify-web-responsive.mjs [预览端口]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const liveUrlArg = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : null;
const port = Number(process.argv[2] || 4199);
const baseUrl = liveUrlArg || `http://127.0.0.1:${port}/family-edu/`;
const outDir = path.join(process.cwd(), "designs");
fs.mkdirSync(outDir, { recursive: true });

// 桩数据故意让「数学」有记录、其余三科只有声明没有记录，
// 用来验证「声明的学科即使没数据也要展示」和「空数据用真实空状态」这两条要求。
const home = {
  children: [
    { id: "c1", name: "JOJO", age: 10, grade: "四年级", gender: "male", subjects: ["语文", "数学", "英语", "科学"], textbookVersion: "人教版" },
  ],
  active_child: { id: "c1", name: "JOJO", age: 10, grade: "四年级", gender: "male", subjects: ["语文", "数学", "英语", "科学"], textbookVersion: "人教版" },
  subject_overview: {
    child: { child_id: "c1", name: "JOJO", grade: "四年级" },
    overall: {
      conclusion: "整体需要关注，数学是目前最需要优先处理的一科",
      tags: ["3 个薄弱知识点", "1 项复测到期", "2 条待处理信号"],
      metrics: { subject_count: 1, mastery_average: 58, review_due_count: 1 },
    },
    subjects: [
      {
        subject: "数学", status: "focus", status_text: "需重点", mastery_score: 58,
        weak_count: 2, review_due_count: 1, attempts_7d: 3,
        change_text: "两步应用题重复出错 2 次，建议本周单独安排。",
      },
      { subject: "语文", status: "thin", status_text: "材料不足", mastery_score: null, weak_count: 0, review_due_count: 0, attempts_7d: 0, change_text: "还没有足够的作答记录，无法判断这一科的水平，先补一次练习。" },
      { subject: "英语", status: "thin", status_text: "材料不足", mastery_score: null, weak_count: 0, review_due_count: 0, attempts_7d: 0, change_text: "还没有足够的作答记录，无法判断这一科的水平，先补一次练习。" },
      { subject: "科学", status: "thin", status_text: "材料不足", mastery_score: null, weak_count: 0, review_due_count: 0, attempts_7d: 0, change_text: "还没有足够的作答记录，无法判断这一科的水平，先补一次练习。" },
    ],
  },
  learning_priorities: {
    top: { label: "两步应用题", subject: "数学", reason: "同一题型两周内重复出错 2 次" },
    priorities: [{ label: "两步应用题", subject: "数学", reason: "同一题型两周内重复出错 2 次" }],
    signal_count: 2,
    planning_required: true,
  },
  planning_request: { id: "plan-1", status: "pending", trigger_reason: "数学出现重复错误，需要重新安排下一阶段重点" },
  child_state: {
    summary: { evidence_7d: 4, evidence_42d: 9, pending_confirmation: 1, confirmed: 6, corrected: 1 },
    recent_evidence: [],
    active_goal: null,
  },
  relationship: { status: "平稳", score: 78, communicationNote: "最近一周沟通顺畅。", conflictCount: 0 },
  wrong_questions: { items: [], total: 0 },
  mastery: { items: [], total: 0 },
  homework: [
    { id: "h1", childId: "c1", subject: "数学", title: "练习册 P12 应用题", dueDate: "2026-09-25T00:00:00.000Z", status: "pending" },
    { id: "h2", childId: "c1", subject: "语文", title: "朗读课文并复述", dueDate: "2026-09-26T00:00:00.000Z", status: "pending" },
  ],
  stats: { familyName: "验证家庭", childCount: 1, recordCount: 12, reportCount: 3, homeworkCount: 2 },
};

const stubs = [
  [/\/api\/home(\?|$)/, () => home],
  [
    /\/api\/mobile\/subject-detail(\?|$)/,
    () => ({
      child: { child_id: "c1" },
      subject: "数学",
      status: "focus",
      status_text: "需重点",
      mastery_score: 58,
      judgement: "数学整体掌握度 58 分，两步应用题重复出错，本周需要重点安排。",
      gaps: [{ name: "两步应用题", mastery_score: 52, type: "REPEATED_ERROR", why: "同一题型两周内重复出错 2 次", evidence: "练习 4 次 · 独立作答 2 次 · 覆盖 1 种变式" }],
      advice: { action: "先讲清两步之间的依赖关系，再做同型变式", method: "先示范一次，再让孩子独立复述步骤", pass_criteria: "连续 3 次独立做对且能说出中间量", retest: "24 小时后复测一次", basis: "题型掌握判定标准：独立作答 5 次、覆盖 3 种变式", estimated_minutes: 20 },
      tasks: [{ title: "练习册 P12 应用题", due_date: "2026-09-25T00:00:00.000Z", estimated_minutes: 15 }],
      planning_required: true,
    }),
  ],
  [/\/api\/settings(\?|$)/, () => ({ family: { name: "验证家庭", code: "123456" }, mcp_token: "stub-token", workbuddy_prompt: "示例提示词", doubao_prompt: "示例提示词" })],
  [/\/api\/policies(\?|$)/, () => []],
  [/\/api\/policy-changes(\?|$)/, () => []],
  [/\/api\/v2\/family\/policy(\?|$)/, () => ({})],
  [/\/api\/family\/memberships(\?|$)/, () => []],
  [/\/api\/education-settings(\?|$)/, () => ({})],
  [/\/api\/v2\/education-methods(\?|$)/, () => []],
  // 私教接口：只用于验证安卓端入口与聊天页骨架，不触发任何真实模型调用。
  [/\/api\/tutor\/status(\?|$)/, () => ({ enabled: true, ready: true, model_configured: true, quota: { message_limit: 60, used_messages: 0, left_messages: 60 } })],
  [/\/api\/tutor\/voice\/status(\?|$)/, () => ({ asr: true, tts: true })],
  [/\/api\/tutor\/conversations\/[^/?]+\/messages(\?|$)/, () => ({ messages: [] })],
  [
    /\/api\/tutor\/conversations(\?|$)/,
    () => ({ conversations: [{ id: "conv-1", childId: "c1", persona: "child_tutor", status: "active" }], conversation: { id: "conv-1", childId: "c1", persona: "child_tutor", status: "active" } }),
  ],
  [/\/api\/tutor\/quota(\?|$)/, () => ({ allowed: true, used_messages: 0, message_limit: 60, left_messages: 60 })],
];

const viewports = [
  { name: "pad-landscape", width: 1366, height: 940, expectSidebar: true },
  { name: "pad-portrait", width: 800, height: 1200, expectSidebar: false },
  { name: "phone", width: 393, height: 851, expectSidebar: false },
  // 安卓 APK 是 WebView 承载同一个站点，MainActivity 在 UA 里附加 HeYaAndroid/1.0。
  // 用同一个 UA 跑一遍，验证私教入口只在这个形态下出现、且聊天页在窄屏下不溢出。
  { name: "apk-webview", width: 393, height: 851, expectSidebar: false, apk: true },
];

// 本地起一个只读静态服务，把构建产物挂在 /family-edu/ 下（与线上路径一致）
const distDir = path.join(process.cwd(), "apps/web/dist");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  let relative = url.pathname.replace(/^\/family-edu\/?/, "");
  if (relative === "" || !path.extname(relative)) relative = "index.html";
  const filePath = path.join(distDir, relative);
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath)) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
});
if (!liveUrlArg) {
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

const browser = await chromium.launch({ channel: "chrome" });
const report = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      ...(viewport.apk
        ? {
            userAgent:
              "Mozilla/5.0 (Linux; Android 14; V2312A Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HeYaAndroid/1.0",
          }
        : {}),
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message).slice(0, 160)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 160));
    });

    if (liveUrlArg) console.log(`检查线上地址：${baseUrl}`);
    await page.route("**/api/**", async (route) => {
      if (liveUrlArg) {
        await route.continue();
        return;
      }
      const url = route.request().url();
      const match = stubs.find(([pattern]) => pattern.test(url));
      const body = match ? match[1]() : {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });
    });

    // 线上检查用一个无效口令：接口会返回 401，但页面外壳（导航、顶栏）照常渲染，
    // 正好用来验证骨架在小屏下的表现，且不触碰任何真实家庭数据。
    await page.addInitScript(() => localStorage.setItem("familyEduToken", "responsive-check-token"));
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const measure = async () => page.evaluate(() => {
      const sidebar = document.querySelector("aside");
      const nav = document.querySelector("header button[aria-label='打开导航']");
      return {
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        sidebarVisible: !!sidebar && sidebar.offsetParent !== null,
        hamburgerVisible: !!nav && nav.offsetParent !== null,
        title: document.querySelector("header div")?.textContent?.trim() || "",
      };
    });

    const before = await measure();

    // 首页信息结构与小程序对齐：整体状态 → 各学科情况 → 学习计划 → 最近学习任务。
    // 线上模式用的是无效口令，只能验证骨架，所以结构断言只在桩数据模式跑。
    let homeLayout = null;
    if (!liveUrlArg) {
      homeLayout = await page.evaluate(() => {
        const navButtons = [...document.querySelectorAll("aside nav button")];
        // 只看正文：侧边栏里也有「学习计划」这类字样，混进来会算错顺序
        const text = document.querySelector("main")?.innerText || "";
        const headingPos = (label) => text.indexOf(label);
        return {
          primaryNav: navButtons.filter((button) => button.querySelector("svg")).map((button) => button.textContent.trim()),
          secondaryNav: navButtons.filter((button) => !button.querySelector("svg")).map((button) => button.textContent.trim()),
          hasHero: !!document.querySelector('[data-testid="child-hero"]'),
          // 私教入口是设备形态开关：非安卓端不该出现在导航里
          tutorInNav: (document.querySelector("aside")?.innerText || "").includes("学习私教"),
          subjectCards: document.querySelectorAll('[data-testid="subject-card"]').length,
          subjectNamesOnCard: [...document.querySelectorAll('[data-testid="subject-card"]')].map((card) => card.textContent.trim().slice(0, 2)),
          declaredSubjectsShown: ["语文", "数学", "英语", "科学"].every((subject) => text.includes(subject)),
          order: {
            overall: headingPos("孩子整体状态"),
            subjects: headingPos("各学科情况"),
            planning: headingPos("学习计划"),
            tasks: headingPos("最近学习任务"),
          },
          emptyStateShown: text.includes("材料不足"),
          // 人物形象是绝对定位的，最容易压到文案或指标条，这里量真实几何位置
          hero: (() => {
            const hero = document.querySelector('[data-testid="child-hero"]');
            const image = hero?.querySelector("img");
            const title = hero?.querySelector("h2");
            const copy = title?.parentElement;
            const metrics = hero?.querySelector('[data-testid="child-hero-metrics"]');
            const rect = (el) => (el ? el.getBoundingClientRect() : null);
            const overlaps = (a, b) =>
              a && b ? !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) : null;
            return {
              heroBox: rect(hero) ? { w: Math.round(rect(hero).width), h: Math.round(rect(hero).height) } : null,
              imageBox: rect(image) ? { w: Math.round(rect(image).width), h: Math.round(rect(image).height) } : null,
              copyBox: rect(copy) ? { w: Math.round(rect(copy).width), h: Math.round(rect(copy).height) } : null,
              metricsBox: rect(metrics) ? { w: Math.round(rect(metrics).width), h: Math.round(rect(metrics).height) } : null,
              imageLoaded: image ? image.naturalWidth > 0 : false,
              imageInsideHero:
                rect(image) && rect(hero)
                  ? rect(image).right <= rect(hero).right + 1 && rect(image).bottom <= rect(hero).bottom + 1
                  : null,
              titleOverlapsImage: !overlaps(rect(title), rect(image)),
              imageOverlapsMetrics: overlaps(rect(image), rect(metrics)) === false,
            };
          })(),
        };
      });
      homeLayout.checks = {
        heroFirst:
          homeLayout.order.overall >= 0 &&
          homeLayout.order.overall < homeLayout.order.subjects &&
          homeLayout.order.subjects < homeLayout.order.planning &&
          homeLayout.order.subjects < homeLayout.order.tasks,
        allDeclaredSubjects: homeLayout.subjectCards === 4 && homeLayout.declaredSubjectsShown,
        honestEmptyState: homeLayout.emptyStateShown,
        tutorNavMatchesDevice: viewport.apk ? homeLayout.tutorInNav === true : homeLayout.tutorInNav === false,
        // 窄屏下侧边栏是收起来的抽屉，导航结构留到抽屉那块再核对
        fivePrimaryAreas: viewport.expectSidebar
          ? homeLayout.primaryNav.length === 9 && homeLayout.secondaryNav.length === 3
          : null,
        heroComposed:
          homeLayout.hero.imageLoaded &&
          homeLayout.hero.imageInsideHero === true &&
          homeLayout.hero.titleOverlapsImage === true &&
          homeLayout.hero.imageOverlapsMetrics === true,
      };
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-home.png`), fullPage: true });
    }

    // 二级页链路：学科卡片 → 后续规划建议；孩子状态 → 整体状态/原因/下一步
    let pageProbe = null;
    if (!liveUrlArg && viewport.expectSidebar) {
      await page.locator('[data-testid="subject-card"]').first().click();
      await page.waitForTimeout(400);
      const subjectPage = await page.evaluate(() => ({
        heading: document.querySelector("header div")?.textContent?.trim() || "",
        hasAdvice: document.body.innerText.includes("后续规划建议"),
        hasGaps: document.body.innerText.includes("需要先解决的问题"),
        hasJudgement: document.body.innerText.includes("整体掌握度"),
      }));
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-subject.png`), fullPage: true });

      await page.getByRole("button", { name: "孩子状态", exact: true }).first().click();
      await page.waitForTimeout(400);
      const statePage = await page.evaluate(() => {
        const text = document.querySelector("main")?.innerText || "";
        return {
          hasHero: !!document.querySelector('img[alt=""]'),
          steps: ["观察证据", "系统判断", "家长下一步"].map((label) => ({ label, at: text.indexOf(label) })),
          hasRelationship: text.includes("亲子关系状态"),
        };
      });
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-child-state.png`), fullPage: true });

      pageProbe = {
        subjectPage,
        statePage,
        checks: {
          subjectDetailReached: subjectPage.hasAdvice && subjectPage.hasGaps && subjectPage.hasJudgement,
          stateStepsOrdered:
            statePage.steps.every((step) => step.at >= 0) &&
            statePage.steps[0].at < statePage.steps[1].at &&
            statePage.steps[1].at < statePage.steps[2].at,
          relationshipOnStatePage: statePage.hasRelationship,
        },
      };
      await page.getByRole("button", { name: "首页", exact: true }).first().click();
      await page.waitForTimeout(300);
    }

    // 私教入口：只在安卓 APK 形态下出现，且聊天页在窄屏下要能正常输入。
    let tutorProbe = null;
    if (viewport.apk) {
      await page.click("header button[aria-label='打开导航']");
      await page.waitForTimeout(400);
      // 桌面侧边栏和移动抽屉都渲染在 aside 里，窄屏下只有抽屉可见，所以要按可见性取。
      const tutorNav = page.locator("aside nav button:visible", { hasText: "学习私教" }).first();
      const entryVisible = await tutorNav.isVisible();
      await tutorNav.click();
      await page.waitForTimeout(600);
      const tutor = await page.evaluate(() => {
        const composer = document.querySelector('textarea[placeholder="说说你卡在哪一步"]');
        const sendButton = document.querySelector('button[aria-label="发送"]');
        const heading = document.querySelector("header div")?.textContent?.trim() || "";
        const rect = (el) => (el ? el.getBoundingClientRect() : null);
        const send = rect(sendButton);
        return {
          heading,
          hasComposer: !!composer,
          hasSend: !!sendButton,
          hasWorksheetButton: !!document.querySelector('button[aria-label="打印讲义"]'),
          // 发送键必须完整落在视口内，不能被裁掉
          sendInsideViewport: send ? send.left >= 0 && send.right <= window.innerWidth + 1 : false,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          emptyHint: (document.querySelector("main")?.innerText || "").includes("拍一张错题照片"),
          evidenceNote: (document.querySelector("main")?.innerText || "").includes("要你确认后才进成长记录"),
        };
      });
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-tutor.png`), fullPage: true });
      tutorProbe = {
        ...tutor,
        entryVisible,
        checks: {
          entryOnlyOnApk: entryVisible,
          chatReachable: tutor.heading === "学习私教" && tutor.hasComposer && tutor.hasSend,
          composerFits: tutor.sendInsideViewport && tutor.overflowX <= 0,
          worksheetPrintable: tutor.hasWorksheetButton,
          honestEvidenceBoundary: tutor.evidenceNote,
        },
      };
      await page.keyboard.press("Escape").catch(() => {});
    }

    await page.screenshot({ path: path.join(outDir, `web-${viewport.name}.png`), fullPage: false });

    let drawer = null;
    if (!viewport.expectSidebar) {
      await page.click("header button[aria-label='打开导航']");
      await page.waitForTimeout(450);
      drawer = await page.evaluate(() => {
        const nav = [...document.querySelectorAll("aside nav button")].filter((el) => el.offsetParent !== null);
        return {
          drawerNavItems: nav.length,
          bodyOverflow: document.body.style.overflow,
          primaryNav: nav.filter((el) => el.querySelector("svg")).map((el) => el.textContent.trim()),
          secondaryNav: nav.filter((el) => !el.querySelector("svg")).map((el) => el.textContent.trim()),
          firstItems: nav.slice(0, 4).map((el) => el.textContent.trim()),
        };
      });
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-drawer.png`), fullPage: false });
    }

    report.push({ viewport: viewport.name, ...before, homeLayout, pageProbe, tutorProbe, drawer, errors: [...new Set(errors)].slice(0, 4) });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(JSON.stringify(report, null, 2));
