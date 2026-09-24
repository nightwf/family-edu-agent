#!/usr/bin/env node
/**
 * 生成一张"作业照"用于验证拍图链路。
 *
 * 为什么不用真照片：真实的儿童手写作业需要 jojo 拍照，这里先解决另一件事 ——
 * 证明「上传 → 存储 → 视觉模型读到图里的字 → 回答引用真实数字」这条链路是通的。
 * 用渲染出来的题目图，数字是已知的，可以直接断言模型有没有真读到。
 *
 * 用法：node scripts/make-vision-probe-image.mjs [输出路径]
 */
import { chromium } from "playwright";
import path from "node:path";

const out = process.argv[2] || path.join(process.env.TMPDIR || "/tmp", "tutor-vision-probe.png");

// 数字是断言依据，改这里要同步改 verify-tutor-vision.mjs
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  body { margin:0; width:720px; padding:40px; background:#fff;
         font-family:"PingFang SC","Noto Sans CJK SC",sans-serif; color:#1a1a1a; }
  h1 { font-size:22px; margin:0 0 6px; font-weight:600; }
  .meta { font-size:14px; color:#888; margin-bottom:22px; }
  .q { font-size:26px; line-height:1.9; }
  .blank { display:inline-block; width:120px; border-bottom:2px solid #333; }
  .work { font-size:22px; line-height:2.6; color:#333; margin-top:26px; letter-spacing:3px; }
</style></head>
<body>
  <h1>数学作业 · 第 3 题</h1>
  <div class="meta">姓名：JOJO　　日期：9 月 24 日</div>
  <div class="q">
    小明有 <b>45</b> 颗糖，比小红多 <b>15</b> 颗。<br>
    两人一共有多少颗糖？<span class="blank"></span>
  </div>
  <div class="work">
    45 - 15 = 30（颗）<br>
    45 + 30 = <span class="blank" style="width:90px"></span>（颗）
  </div>
</body></html>`;

// 用系统 Chrome：Playwright 自带的 headless shell 未必装过，验证脚本也是这么起的
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 800, height: 560 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(`已生成：${out}`);
