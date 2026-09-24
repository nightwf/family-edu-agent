import { describe, expect, it } from "vitest";
import {
  allowedToolNames,
  filterChildrenResult,
  isToolAllowed,
  normalizePersona,
  sanitizeToolArguments,
} from "./tool-policy.js";

describe("工具授权表", () => {
  it("默认拒绝：未列出的工具不可用", () => {
    expect(isToolAllowed("child_tutor", "delete_child")).toBe(false);
    expect(isToolAllowed("child_tutor", "update_family_policy")).toBe(false);
    expect(isToolAllowed("child_tutor", "create_weekly_plan")).toBe(false);
  });

  it("孩子端只给只读工具，变更类一律不给", () => {
    const names = allowedToolNames("child_tutor");
    expect(names).toContain("get_wrong_question");
    expect(names).toContain("get_child_state");
    expect(names).not.toContain("save_wrong_question");
    expect(names).not.toContain("record_question_attempt");
    expect(names).not.toContain("delete_wrong_question");
  });

  it("家长端才允许写入类工具", () => {
    const names = allowedToolNames("parent_coach");
    expect(names).toContain("save_wrong_question");
    expect(names).toContain("record_question_attempt");
    expect(names).not.toContain("delete_child");
  });

  it("未知 persona 收敛到孩子端，不获得额外授权", () => {
    expect(normalizePersona("something_else")).toBe("child_tutor");
    expect(normalizePersona(null)).toBe("child_tutor");
    expect(isToolAllowed("hacker", "save_wrong_question")).toBe(false);
  });
});

describe("工具参数净化", () => {
  it("会话钉住孩子时，覆盖模型传入的 child_id", () => {
    const args = sanitizeToolArguments("get_child_state", { child_id: "别的孩子" }, { pinnedChildId: "child-1" });
    expect(args.child_id).toBe("child-1");
  });

  it("模型没传 child_id 时也补上钉住的值", () => {
    const args = sanitizeToolArguments("get_child_state", {}, { pinnedChildId: "child-1" });
    expect(args.child_id).toBe("child-1");
  });

  it("家庭级会话保留模型指定的孩子（家长可看多个孩子，跨家庭由各工具守卫拦下）", () => {
    const args = sanitizeToolArguments("get_child_state", { child_id: "child-1" }, { pinnedChildId: null });
    expect(args.child_id).toBe("child-1");
  });

  it("丢弃 family_id，家庭只能由服务端会话决定", () => {
    const args = sanitizeToolArguments("list_children", { family_id: "别家" }, { pinnedChildId: "child-1" });
    expect(args.family_id).toBeUndefined();
  });

  it("工具不声明 child_id 时不注入该参数", () => {
    const args = sanitizeToolArguments("get_family_policy", {}, { pinnedChildId: "child-1" }, false);
    expect(args.child_id).toBeUndefined();
  });

  it("工具不声明 child_id 时，模型硬塞的也会被剔除", () => {
    const args = sanitizeToolArguments("get_family_policy", { child_id: "child-1" }, { pinnedChildId: "child-1" }, false);
    expect(args.child_id).toBeUndefined();
  });
});

describe("孩子列表收敛", () => {
  it("孩子模式只返回钉住的那一个孩子", () => {
    const payload = {
      children: [
        { child_id: "child-1", name: "JOJO" },
        { child_id: "child-2", name: "妹妹" },
      ],
    };
    const filtered: any = filterChildrenResult("child_tutor", "child-1", payload);
    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].child_id).toBe("child-1");
  });

  it("家长模式不收敛，能看到全部孩子", () => {
    const payload = { children: [{ child_id: "child-1" }, { child_id: "child-2" }] };
    const filtered: any = filterChildrenResult("parent_coach", "child-1", payload);
    expect(filtered.children).toHaveLength(2);
  });
});
