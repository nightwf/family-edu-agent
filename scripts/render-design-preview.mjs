/**
 * 把设计预览 HTML 渲染成 PNG 效果图。
 *
 * 用途：效果图需要精确的中文排版，AI 生图会把文字画错，
 * 所以用浏览器按手机尺寸渲染，得到文字准确的界面图。
 *
 * 用法：node scripts/render-design-preview.mjs <html相对路径> [输出目录]
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const htmlRelative = process.argv[2];
const outputDir = process.argv[3] || "designs";

if (!htmlRelative) {
  console.error("用法：node scripts/render-design-preview.mjs <html相对路径> [输出目录]");
  process.exit(1);
}

const htmlPath = path.resolve(htmlRelative);
if (!fs.existsSync(htmlPath)) {
  console.error(`找不到文件：${htmlPath}`);
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });
  await page.goto(`file://${htmlPath}`);
  // 展开手机屏，让截图包含完整内容而不是被内部滚动裁掉
  await page.addStyleTag({ content: ".screen{height:auto !important;overflow:visible !important}.phone{width:390px !important}.frames{justify-content:flex-start !important}" });
  await page.waitForTimeout(400);

  const labels = await page.locator(".frame-title").allTextContents();
  const frames = page.locator(".phone");
  const count = await frames.count();
  const base = path.basename(htmlPath, ".html");

  for (let index = 0; index < count; index += 1) {
    const name = `${base}-${index + 1}.png`;
    const target = path.join(outputDir, name);
    await frames.nth(index).screenshot({ path: target });
    console.log(`✓ ${target}${labels[index] ? `  (${labels[index]})` : ""}`);
  }

  await page.screenshot({ path: path.join(outputDir, `${base}-full.png`), fullPage: true });
  console.log(`✓ ${path.join(outputDir, `${base}-full.png`)}  (整版)`)
} finally {
  await browser.close();
}
