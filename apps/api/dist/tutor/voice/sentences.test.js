import { describe, expect, it } from "vitest";
import { cleanForSpeech, splitSentences } from "./sentences.js";
describe("朗读文本清理", () => {
    it("去掉标题、列表与加粗记号", () => {
        expect(cleanForSpeech("## 先想一步\n- 读出题意\n**重点**是单位")).toBe("先想一步\n读出题意\n重点是单位");
    });
    it("保留数字与运算符，念出来的内容不丢", () => {
        expect(cleanForSpeech("45-15+45 实际等于 75")).toBe("45-15+45 实际等于 75");
    });
    it("代码块换成一句说明", () => {
        expect(cleanForSpeech("看这里\n```js\nx=1\n```")).toContain("看屏幕");
    });
    it("链接只留文字", () => {
        expect(cleanForSpeech("看[课本](https://x.com)第 3 页")).toBe("看课本第 3 页");
    });
});
describe("切句", () => {
    it("按句末标点切开，并保留标点", () => {
        expect(splitSentences("先读题。再看条件！最后列式？")).toEqual(["先读题。", "再看条件！", "最后列式？"]);
    });
    it("换行也当作句子边界", () => {
        expect(splitSentences("第一步\n第二步")).toEqual(["第一步", "第二步"]);
    });
    it("分号可以断句", () => {
        expect(splitSentences("先算加法；再算减法。")).toEqual(["先算加法；", "再算减法。"]);
    });
    it("短句里的逗号不断开，语气才连贯", () => {
        expect(splitSentences("先读题，再看条件。")).toEqual(["先读题，再看条件。"]);
    });
    it("长句才允许在逗号处断开", () => {
        const long = "先读一遍题目里的已知条件，再想想要求的那个数到底跟哪两个量有关系，最后才动笔列式。";
        const parts = splitSentences(long);
        expect(parts.length).toBeGreaterThan(1);
        expect(parts.join("")).toBe(long);
    });
    it("超长句子按硬上限切开，不丢字符", () => {
        const long = "甲".repeat(300);
        const parts = splitSentences(long);
        expect(parts.every((part) => part.length <= 120)).toBe(true);
        expect(parts.join("")).toBe(long);
    });
    it("空内容不产生句子", () => {
        expect(splitSentences("")).toEqual([]);
        expect(splitSentences("   \n  ")).toEqual([]);
    });
    it("纯符号不产生句子，避免合成出空音频", () => {
        expect(splitSentences("---\n***\n===")).toEqual([]);
    });
    it("中文回答整体不丢字", () => {
        const text = "# 语文\n\n孩子把「一共」漏掉了。\n\n先让他复述一遍题意；再一起数一数有几个量。";
        expect(splitSentences(text).join("").replace(/\s/g, "")).toBe("语文孩子把「一共」漏掉了。先让他复述一遍题意；再一起数一数有几个量。");
    });
});
