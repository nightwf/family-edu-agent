/**
 * 通过 WebView 调试通道检查安卓客户端里的真实页面状态。
 *
 * 用途：模拟器截图在软件渲染下可能是黑屏，但页面本身是好的。
 * 这个脚本直接连 WebView 的 CDP，读取页面文字、点按钮、截图，
 * 用来证明 App 里的站点真的加载出来了。
 *
 * 用法：
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node scripts/android-webview-probe.mjs <ws-url> [场景: landing|login] [输出目录]
 */
import fs from "node:fs";
import path from "node:path";

const wsUrl = process.argv[2];
const scenario = process.argv[3] || "landing";
const outDir = process.argv[4] || "designs";

if (!wsUrl) {
  console.error("用法：node scripts/android-webview-probe.mjs <ws-url> [landing|login] [输出目录]");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const socket = new WebSocket(wsUrl);
let messageId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = (messageId += 1);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.addEventListener("message", (event) => {
  const data = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(`${data.error.message}`));
    else resolve(data.result);
  }
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
  return result.result?.value;
}

async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const target = path.join(outDir, `${name}.png`);
  fs.writeFileSync(target, Buffer.from(shot.data, "base64"));
  return target;
}

socket.addEventListener("open", async () => {
  try {
    await send("Runtime.enable");
    await send("Page.enable");
    await wait(1500);

    const state = await evaluate(`JSON.stringify({
      title: document.title,
      url: location.href,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      text: document.body.innerText.replace(/\\n{2,}/g, "\\n").slice(0, 600)
    })`);
    console.log("页面状态：", state);
    console.log("截图：", await screenshot(`android-${process.env.PROBE_TAG || scenario}`));

    if (scenario === "layout") {
      // 用一个无效口令进到已登录骨架：接口返回 401，但导航与顶栏会渲染出来，
      // 用来确认 App 在手机 / 平板宽度下用的是抽屉还是固定侧边栏。
      await evaluate(`localStorage.setItem("familyEduToken", "layout-check-token"); location.reload(); "reloading"`);
      await wait(6000);
      const layout = await evaluate(`(() => {
        const sidebar = document.querySelector("aside");
        const nav = document.querySelector("header button[aria-label='打开导航']");
        return {
          viewport: window.innerWidth + "x" + window.innerHeight,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          sidebarVisible: !!sidebar && sidebar.offsetParent !== null,
          hamburgerVisible: !!nav && nav.offsetParent !== null,
        };
      })()`);
      console.log("布局检查：", JSON.stringify(layout));
      console.log("截图：", await screenshot(`android-${process.env.PROBE_TAG || "layout"}`));
      socket.close();
      process.exit(0);
    }

    if (scenario === "login") {
      const clicked = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll("button, a")];
        const visible = buttons.filter((el) => el.offsetParent !== null);
        const target = visible.find((el) => el.textContent.trim() === "登录")
          || visible.find((el) => el.textContent.trim().includes("登录") && !el.textContent.includes("退出"));
        if (!target) return "not-found";
        target.click();
        return "clicked:" + target.textContent.trim();
      })()`);
      console.log("点击登录入口：", clicked);
      await wait(5000);
      const after = await evaluate(`JSON.stringify({
        url: location.href,
        heading: [...document.querySelectorAll("div,h1,h2")].map((el) => el.childElementCount === 0 ? el.textContent.trim() : "").filter((text) => text.includes("扫码")).slice(0, 3),
        images: [...document.querySelectorAll("img")].map((img) => ({ src: img.src.slice(0, 90), naturalWidth: img.naturalWidth, visible: img.offsetParent !== null })),
        text: document.body.innerText.replace(/\\n{2,}/g, "\\n").slice(0, 500)
      })`);
      console.log("登录页状态：", after);
      console.log("截图：", await screenshot("android-pad-login"));
    }

    if (scenario === "qr") {
      // 点开登录，回报二维码图片在页面里的位置。
      // 有了 CSS 像素坐标和 dpr，就能算出设备坐标，再用 adb 做长按验证。
      await evaluate(`localStorage.removeItem("familyEduToken"); location.reload(); "reloading"`);
      await wait(5000);
      const clicked = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll("button, a")].filter((el) => el.offsetParent !== null);
        const target = buttons.find((el) => el.textContent.trim() === "登录")
          || buttons.find((el) => el.textContent.trim().includes("登录") && !el.textContent.includes("退出"));
        if (!target) return "not-found";
        const r = target.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const info = {
          text: target.textContent.trim(),
          cssCenter: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
          dpr,
        };
        target.click();
        return "clicked:" + JSON.stringify(info);
      })()`);
      console.log("点击登录入口：", clicked);
      await wait(6000);
      const qr = await evaluate(`(() => {
        const img = [...document.querySelectorAll("img")].find((el) => el.offsetParent !== null && el.naturalWidth > 100);
        const dpr = window.devicePixelRatio || 1;
        if (!img) return JSON.stringify({ found: false, text: document.body.innerText.slice(0, 300) });
        const rect = img.getBoundingClientRect();
        return JSON.stringify({
          found: true,
          url: img.src,
          naturalWidth: img.naturalWidth,
          alt: img.alt,
          css: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          centerCss: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
          centerDevice: {
            x: Math.round((rect.x + rect.width / 2) * dpr),
            y: Math.round((rect.y + rect.height / 2) * dpr),
          },
          dpr,
          viewport: window.innerWidth + "x" + window.innerHeight,
        });
      })()`);
      console.log("二维码检查：", qr);
      console.log("截图：", await screenshot(`android-${process.env.PROBE_TAG || "qr"}`));
    }

    socket.close();
    process.exit(0);
  } catch (error) {
    console.error("探测失败：", error.message);
    socket.close();
    process.exit(1);
  }
});

socket.addEventListener("error", (event) => {
  console.error("WebSocket 错误：", event.message || event.type);
  process.exit(1);
});
