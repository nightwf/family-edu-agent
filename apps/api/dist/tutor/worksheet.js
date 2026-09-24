/**
 * 私教的「输出多模态」：把一轮对话渲染成可打印的讲义。
 *
 * 刻意不用模型生成图片或 PDF 模板：内容全部来自这段对话的真实文本，
 * 服务端只做排版。空对话给空状态，不编造题目，也不放演示数据。
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
/** 段落切分：空行分段，单换行保留为段内换行。 */
function paragraphs(text) {
    return text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);
}
function formatDate(date) {
    const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((value) => String(value).padStart(2, "0"));
    return parts.join("-");
}
export function renderWorksheet(input) {
    const generatedAt = input.generatedAt || new Date();
    const real = input.messages.filter((message) => message.role === "user" || message.role === "assistant");
    const questions = real.filter((message) => message.role === "user");
    const explanations = real.filter((message) => message.role === "assistant" && (message.content || "").trim());
    const childLine = input.childName ? `学生：${escapeHtml(input.childName)}` : "学生：未指定";
    const title = input.conversationTitle?.trim() ? escapeHtml(input.conversationTitle.trim()) : "私教讲义";
    const questionBlock = questions.length
        ? questions
            .map((message, index) => {
            const text = (message.content || "").trim() || "（图片提问）";
            return `<li><span class="index">${index + 1}.</span><div class="body">${paragraphs(text)
                .map((block) => `<p>${escapeHtml(block)}</p>`)
                .join("")}</div></li>`;
        })
            .join("")
        : `<li class="empty">这一轮还没有提问记录。</li>`;
    const explainBlock = explanations.length
        ? explanations
            .map((message) => `<section class="answer">${paragraphs((message.content || "").trim())
            .map((block) => `<p>${escapeHtml(block)}</p>`)
            .join("")}</section>`)
            .join("")
        : `<p class="empty">这一轮还没有讲解内容。</p>`;
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · 禾芽私教讲义</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f1e8; color: #1f2d33; font: 16px/1.8 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
  .sheet { max-width: 820px; margin: 0 auto; background: #fff; padding: 40px 44px 56px; }
  header { border-bottom: 2px solid #1f2d33; padding-bottom: 18px; text-align: center; }
  header .brand { font-size: 13px; letter-spacing: 0.22em; color: #6b7a80; }
  header h1 { margin: 12px 0 0; font-size: 24px; }
  header .meta { margin-top: 14px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 24px; font-size: 14px; color: #46565d; }
  h2 { margin: 34px 0 12px; font-size: 17px; border-left: 4px solid #2f6f63; padding-left: 10px; }
  ol { margin: 0; padding: 0; list-style: none; }
  ol li { display: flex; gap: 8px; margin-bottom: 14px; break-inside: avoid; }
  ol li .index { font-weight: 700; color: #2f6f63; }
  .body p, .answer p { margin: 0 0 8px; white-space: pre-wrap; }
  .answer { margin-bottom: 16px; padding: 14px 16px; background: #f6faf8; border-left: 3px solid #2f6f63; break-inside: avoid; }
  .empty { color: #8a979c; }
  .write-in { margin-top: 10px; }
  .write-in .line { height: 30px; border-bottom: 1px dashed #c3ccc9; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #dde3e1; font-size: 12px; color: #6b7a80; }
  .toolbar { max-width: 820px; margin: 0 auto; padding: 16px 44px; display: flex; justify-content: flex-end; }
  .toolbar button { font: inherit; padding: 8px 18px; border: 1px solid #2f6f63; background: #2f6f63; color: #fff; border-radius: 8px; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .sheet { max-width: none; margin: 0; padding: 0 6mm; }
    @page { margin: 14mm; }
  }
</style>
</head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">打印 / 存成 PDF</button></div>
<main class="sheet">
  <header>
    <div class="brand">禾芽家庭教务 · 私教讲义</div>
    <h1>${title}</h1>
    <div class="meta"><span>${childLine}</span><span>生成日期：${formatDate(generatedAt)}</span></div>
  </header>
  <h2>本次讨论的问题</h2>
  <ol>${questionBlock}</ol>
  <h2>讲题思路与要点</h2>
  ${explainBlock}
  <h2>我的笔记</h2>
  <div class="write-in"><div class="line"></div><div class="line"></div><div class="line"></div></div>
  <footer>由禾芽内置私教整理，内容来自这次对话的真实文本。对话产生的成长证据需要家长确认后才会进入成长记录。</footer>
</main>
</body>
</html>`;
}
