import { describe, expect, it } from "vitest";
import {
  EnumValueError,
  EVIDENCE_TYPES,
  KNOWLEDGE_RELATION_TYPES,
  PLAN_ITEM_STATUSES,
  PLAN_ITEM_TYPES,
  enumHint,
  normalizeEnumValue,
  optionalEnumValue,
  requireEnumValue,
} from "./enum-normalize.js";

describe("枚举取值归一化", () => {
  it("英文枚举键直接通过", () => {
    expect(requireEnumValue(PLAN_ITEM_TYPES, "SCHOOL_HOMEWORK", "type")).toBe("SCHOOL_HOMEWORK");
  });

  it("大小写、空格、中划线与下划线都不敏感", () => {
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "school_homework")).toBe("SCHOOL_HOMEWORK");
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "school-homework")).toBe("SCHOOL_HOMEWORK");
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "School Homework")).toBe("SCHOOL_HOMEWORK");
  });

  it("中文名称可以正确落库", () => {
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "学校作业")).toBe("SCHOOL_HOMEWORK");
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "孩子任务")).toBe("CHILD_TASK");
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "家长行动")).toBe("PARENT_ACTION");
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "AI任务")).toBe("AGENT_TASK");
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "复测")).toBe("RETEST");
  });

  it("常见同义写法也能识别", () => {
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "homework")).toBe("SCHOOL_HOMEWORK");
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "practice")).not.toBeNull();
    expect(normalizeEnumValue(EVIDENCE_TYPES, "观察")).toBe("OBSERVATION");
    expect(normalizeEnumValue(EVIDENCE_TYPES, "作文")).toBe("WRITING");
    expect(normalizeEnumValue(KNOWLEDGE_RELATION_TYPES, "前置知识")).toBe("PREREQUISITE_OF");
    expect(normalizeEnumValue(PLAN_ITEM_STATUSES, "done")).toBe("COMPLETED");
  });

  it("非法取值报错时会列出全部合法值", () => {
    expect(() => requireEnumValue(PLAN_ITEM_TYPES, "布鲁姆-记忆", "周计划任务类型")).toThrow(EnumValueError);
    try {
      requireEnumValue(PLAN_ITEM_TYPES, "布鲁姆-记忆", "周计划任务类型");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("周计划任务类型");
      expect(message).toContain("SCHOOL_HOMEWORK（学校作业）");
      expect(message).toContain("RETEST（复测）");
      expect(message).toContain("中文名称");
    }
  });

  it("空值与无法识别的值区分处理", () => {
    expect(normalizeEnumValue(PLAN_ITEM_TYPES, "")).toBeNull();
    expect(optionalEnumValue(PLAN_ITEM_TYPES, undefined, "type")).toBeUndefined();
    expect(optionalEnumValue(PLAN_ITEM_TYPES, "", "type")).toBeUndefined();
    expect(() => optionalEnumValue(PLAN_ITEM_TYPES, "乱写", "type")).toThrow(/合法值/);
  });

  it("提示文案包含全部取值，便于调用方自我修正", () => {
    const hint = enumHint(PLAN_ITEM_STATUSES);
    expect(hint).toContain("PENDING（待开始）");
    expect(hint).toContain("NEEDS_REVIEW（需复测）");
  });
});
