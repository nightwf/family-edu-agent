import { describe, expect, it } from "vitest";
import { parseStringList } from "./list-input.js";

describe("多值表单解析", () => {
  it("按顿号拆分电脑端表单回填的学科串", () => {
    expect(parseStringList("英语、数学、语文")).toEqual(["英语", "数学", "语文"]);
  });

  it("兼容逗号、中文逗号与混用分隔符", () => {
    expect(parseStringList("英语,数学，语文、科学")).toEqual(["英语", "数学", "语文", "科学"]);
  });

  it("丢弃空白项并去掉首尾空格", () => {
    expect(parseStringList(" 数学 、 、语文，")).toEqual(["数学", "语文"]);
  });

  it("数组入参保持原顺序并清理空值", () => {
    expect(parseStringList(["数学", " ", "语文"])).toEqual(["数学", "语文"]);
  });

  it("空值与单值都能得到可用的数组", () => {
    expect(parseStringList("")).toEqual([]);
    expect(parseStringList(undefined)).toEqual([]);
    expect(parseStringList("数学")).toEqual(["数学"]);
  });
});
