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

const home = {
  children: [
    { id: "c1", name: "JOJO", age: 10, grade: "四年级", gender: "male", subjects: ["语文", "数学", "英语", "科学"], textbookVersion: "人教版" },
  ],
  stats: { familyName: "验证家庭", childCount: 1, recordCount: 12, reportCount: 3, homeworkCount: 2 },
};

const stubs = [
  [/\/api\/home(\?|$)/, () => home],
  [/\/api\/settings(\?|$)/, () => ({ family: { name: "验证家庭", code: "123456" }, mcp_token: "stub-token", workbuddy_prompt: "示例提示词", doubao_prompt: "示例提示词" })],
  [/\/api\/policies(\?|$)/, () => []],
  [/\/api\/policy-changes(\?|$)/, () => []],
  [/\/api\/v2\/family\/policy(\?|$)/, () => ({})],
  [/\/api\/family\/memberships(\?|$)/, () => []],
  [/\/api\/education-settings(\?|$)/, () => ({})],
  [/\/api\/v2\/education-methods(\?|$)/, () => []],
];

const viewports = [
  { name: "pad-landscape", width: 1366, height: 940, expectSidebar: true },
  { name: "pad-portrait", width: 800, height: 1200, expectSidebar: false },
  { name: "phone", width: 393, height: 851, expectSidebar: false },
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
          firstItems: nav.slice(0, 4).map((el) => el.textContent.trim()),
        };
      });
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-drawer.png`), fullPage: false });
    }

    report.push({ viewport: viewport.name, ...before, drawer, errors: [...new Set(errors)].slice(0, 4) });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(JSON.stringify(report, null, 2));
