import { describe, expect, it } from "vitest";
import { renderWorksheet } from "./worksheet.js";

describe("私教讲义排版", () => {
  it("只有真实对话文本，问题和讲解各归各位", () => {
    const html = renderWorksheet({
      childName: "JOJO",
      conversationTitle: "两步应用题",
      messages: [
        { role: "user", content: "小明有 45 颗糖，比小红多 15 颗，两人一共多少颗？" },
        { role: "assistant", content: "先别急着算总数。\n\n你能先算出小红有多少颗吗？" },
      ],
    });

    expect(html).toContain("JOJO");
    expect(html).toContain("两步应用题");
    expect(html).toContain("小明有 45 颗糖");
    expect(html).toContain("你能先算出小红有多少颗吗？");
    // 空行分段：两段各自成 <p>
    expect(html.match(/<p>先别急着算总数。<\/p>/)).toBeTruthy();
    expect(html.match(/<p>你能先算出小红有多少颗吗？<\/p>/)).toBeTruthy();
    // 报告边界写清楚：证据要家长确认
    expect(html).toContain("需要家长确认");
  });

  it("转义用户输入，避免把对话文本当标签渲染", () => {
    const html = renderWorksheet({
      childName: '<script>alert(1)</script>',
      messages: [{ role: "user", content: '<img src=x onerror="alert(2)"> 这题怎么做' }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("图片提问没有文字时标注清楚，不假装有题干", () => {
    const html = renderWorksheet({ messages: [{ role: "user", content: null }] });
    expect(html).toContain("（图片提问）");
  });

  it("空对话给空状态，不编造题目", () => {
    const html = renderWorksheet({ messages: [] });
    expect(html).toContain("这一轮还没有提问记录");
    expect(html).toContain("这一轮还没有讲解内容");
    // 没有孩子信息时如实写"未指定"
    expect(html).toContain("学生：未指定");
  });

  it("系统/工具消息不进讲义", () => {
    const html = renderWorksheet({
      childName: "苗苗",
      messages: [
        { role: "system", content: "内部提示词不该出现" },
        { role: "tool", content: "工具原始返回不该出现" },
        { role: "user", content: "这道题我不会" },
      ],
    });
    expect(html).not.toContain("内部提示词不该出现");
    expect(html).not.toContain("工具原始返回不该出现");
    expect(html).toContain("这道题我不会");
  });

  it("标题为空时用默认标题，不显示 null", () => {
    const html = renderWorksheet({ conversationTitle: null, messages: [] });
    expect(html).toContain("<h1>私教讲义</h1>");
    expect(html).not.toContain("null");
  });
});
