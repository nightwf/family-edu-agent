import { describe, expect, it } from "vitest";
import { evaluateArithmetic, verifyQuestionAnswer } from "./answer-verification.js";
describe("evaluateArithmetic", () => {
    it("计算四则运算与括号", () => {
        expect(evaluateArithmetic("2+3*4")).toBe(14);
        expect(evaluateArithmetic("(1+2)*3")).toBe(9);
        expect(evaluateArithmetic("10/4")).toBe(2.5);
        expect(evaluateArithmetic("2^3")).toBe(8);
    });
    it("兼容中文与全角运算符", () => {
        expect(evaluateArithmetic("3×4")).toBe(12);
        expect(evaluateArithmetic("8÷2")).toBe(4);
        expect(evaluateArithmetic("（1＋2）×3")).toBe(9);
        expect(evaluateArithmetic("5－2")).toBe(3);
    });
    it("支持一元负号", () => {
        expect(evaluateArithmetic("-3+5")).toBe(2);
        expect(evaluateArithmetic("2*(-3)")).toBe(-6);
    });
    it("遇到字母、未知符号或非法表达式时返回 null 而不是猜结果", () => {
        expect(evaluateArithmetic("x+1")).toBeNull();
        expect(evaluateArithmetic("a²+6a+9")).toBeNull();
        expect(evaluateArithmetic("2+")).toBeNull();
        expect(evaluateArithmetic("2/0")).toBeNull();
    });
});
describe("verifyQuestionAnswer", () => {
    it("单选题答案必须在选项里", () => {
        const ok = verifyQuestionAnswer({ format: "single_choice", answer: "B", options: ["A", "B", "C"] });
        expect(ok.status).toBe("verified");
        expect(ok.method).toBe("option_match");
        const bad = verifyQuestionAnswer({ format: "single_choice", answer: "D", options: ["A", "B", "C"] });
        expect(bad.status).toBe("failed");
        expect(bad.errors.join()).toContain("不在选项中");
    });
    it("支持对象形式的选项并按 key 匹配", () => {
        const result = verifyQuestionAnswer({
            format: "single_choice",
            answer: "A",
            options: [{ key: "A", label: "三角形" }, { key: "B", label: "四边形" }],
        });
        expect(result.status).toBe("verified");
    });
    it("多选题必须有两个以上答案", () => {
        const single = verifyQuestionAnswer({ format: "multiple_choice", answer: ["A"], options: ["A", "B"] });
        expect(single.status).toBe("failed");
        const multi = verifyQuestionAnswer({ format: "multiple_choice", answer: ["A", "C"], options: ["A", "B", "C"] });
        expect(multi.status).toBe("verified");
        expect(multi.verifiedAnswer).toEqual(["A", "C"]);
    });
    it("判断题只接受对错类答案", () => {
        expect(verifyQuestionAnswer({ format: "true_false", answer: "对" }).status).toBe("verified");
        expect(verifyQuestionAnswer({ format: "true_false", answer: "true" }).status).toBe("verified");
        expect(verifyQuestionAnswer({ format: "true_false", answer: "可能吧" }).status).toBe("failed");
    });
    it("填空题做去空格和大小写归一", () => {
        const result = verifyQuestionAnswer({ format: "fill_blank", answer: [" Hello ", "World"] });
        expect(result.status).toBe("verified");
        expect(result.verifiedAnswer).toEqual(["hello", "world"]);
        expect(verifyQuestionAnswer({ format: "fill_blank", answer: [] }).status).toBe("failed");
    });
    it("计算题能核对给出已验证结果", () => {
        const result = verifyQuestionAnswer({ format: "calculation", answer: "2*(3+4)" });
        expect(result.status).toBe("verified");
        expect(result.verifiedAnswer).toEqual([14]);
    });
    it("含有字母的计算题标记为未验证，不冒充已核对", () => {
        const result = verifyQuestionAnswer({ format: "calculation", answer: "x+1" });
        expect(result.status).toBe("unverified");
        expect(result.errors.join()).toContain("无法用四则运算核对");
    });
    it("主观题标记为需要人工或评分量表", () => {
        const missingRubric = verifyQuestionAnswer({ format: "essay", answer: "略" });
        expect(missingRubric.status).toBe("not_applicable");
        expect(missingRubric.errors.length).toBe(1);
        const withRubric = verifyQuestionAnswer({ format: "essay", answer: "略", scoringRubric: { points: ["结构清晰"] } });
        expect(withRubric.status).toBe("not_applicable");
        expect(withRubric.errors).toEqual([]);
    });
    it("缺少标准答案时判为失败", () => {
        expect(verifyQuestionAnswer({ format: "single_choice", answer: null, options: ["A"] }).status).toBe("failed");
    });
});
