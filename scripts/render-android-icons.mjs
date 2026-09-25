/**
 * 生成安卓启动图标（自适应图标 + 传统方形图标）。
 *
 * 图标用浏览器按真实字体渲染，保证“禾”字不会变形；AI 生图经常把汉字画错。
 * 用法：node scripts/render-android-icons.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resDir = path.join(root, "android/app/src/main/res");
const tmpDir = path.join(root, "android/build/icon-source");
fs.mkdirSync(tmpDir, { recursive: true });

const GLYPH_HTML = (size, withBackground) => `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html,body{margin:0;padding:0;background:${withBackground ? "transparent" : "transparent"};}
  .icon{
    width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
    ${withBackground
      ? "background:linear-gradient(140deg,#205159 0%,#0F766E 78%,#12857C 100%);border-radius:" + Math.round(size * 0.22) + "px;"
      : ""}
    font-family:"PingFang SC","Noto Sans CJK SC","Hiragino Sans GB",sans-serif;
    box-sizing:border-box;
  }
  .glyph{
    color:#F3C969;font-weight:600;line-height:1;
    font-size:${withBackground ? Math.round(size * 0.62) : Math.round(size * 0.46)}px;
    transform:translateY(-1%);
    text-shadow:${withBackground ? "0 4px 14px rgba(0,0,0,0.18)" : "none"};
  }
</style></head>
<body><div class="icon"><span class="glyph">禾</span></div></body></html>`;

async function render(html, outPath, size) {
  const htmlPath = path.join(tmpDir, path.basename(outPath, ".png") + ".html");
  fs.writeFileSync(htmlPath, html);
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: outPath, omitBackground: true });
  } finally {
    await browser.close();
  }
}

const densities = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];

// 1. 传统方形图标（512 母图，再按密度缩放）
const legacy = path.join(tmpDir, "legacy-512.png");
await render(GLYPH_HTML(512, true), legacy, 512);

// 2. 自适应图标前景（108dp 画布，xxhdpi = 432px）
const foreground = path.join(tmpDir, "foreground-432.png");
await render(GLYPH_HTML(432, false), foreground, 432);

for (const [name, scale] of densities) {
  const dir = path.join(resDir, `mipmap-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const legacySize = Math.round(48 * scale);
  execFileSync("magick", [legacy, "-resize", `${legacySize}x${legacySize}`, path.join(dir, "ic_launcher.png")]);
  execFileSync("magick", [legacy, "-resize", `${legacySize}x${legacySize}`, path.join(dir, "ic_launcher_round.png")]);
  const fgSize = Math.round(108 * scale);
  execFileSync("magick", [foreground, "-resize", `${fgSize}x${fgSize}`, path.join(dir, "ic_launcher_foreground.png")]);
}

// 3. 供 Playwright / 商店展示用的 512 图，放在 designs 便于用户查看
fs.mkdirSync(path.join(root, "designs"), { recursive: true });
execFileSync("magick", [legacy, path.join(root, "designs/android-app-icon.png")]);

console.log("已生成安卓图标：res/mipmap-*/ic_launcher*.png");
