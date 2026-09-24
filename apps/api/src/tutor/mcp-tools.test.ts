import { afterEach, describe, expect, it, vi } from "vitest";

const childFindFirst = vi.fn();
const childFindMany = vi.fn();

/** 未显式打桩的模型一律返回空值：本测试关心的是授权与身份覆盖，不是各工具的业务逻辑。 */
function anyModel() {
  return new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === "then"
          ? undefined
          : vi.fn().mockResolvedValue(prop === "count" ? 0 : prop === "findFirst" ? null : []),
    },
  );
}

vi.mock("../prisma.js", () => ({
  prisma: new Proxy(
    {
      child: {
        findFirst: (...args: unknown[]) => childFindFirst(...args),
        findMany: (...args: unknown[]) => childFindMany(...args),
      },
    } as Record<string, unknown>,
    { get: (target, prop) => (prop in target ? (target as any)[prop] : anyModel()) },
  ),
}));

const { createTutorToolset } = await import("./mcp-tools.js");

let closeAll: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closeAll?.();
  closeAll = undefined;
});

async function open(persona: "child_tutor" | "parent_coach", pinnedChildId?: string | null) {
  const toolset = await createTutorToolset("family-1", persona, pinnedChildId);
  closeAll = () => toolset.close();
  return toolset;
}

describe("私教工具集（与真实 MCP 服务器对接）", () => {
  it("只暴露授权表里的工具，删除类工具不在其中", async () => {
    const toolset = await open("child_tutor", "child-1");
    const names = toolset.schemas.map((tool) => tool.name);

    expect(names).toContain("get_child_state");
    expect(names).toContain("list_wrong_questions");
    expect(names).toContain("get_subject_overview");
    expect(names).not.toContain("delete_child");
    expect(names).not.toContain("delete_wrong_question");
    expect(names).not.toContain("update_family_policy");
    expect(names).not.toContain("save_wrong_question");
    // 每个工具都带得出参数定义，模型才能正确调用
    expect(toolset.schemas.every((tool) => tool.inputSchema && tool.description)).toBe(true);
  });

  it("家长端才拿得到写入类工具", async () => {
    const toolset = await open("parent_coach", "child-1");
    const names = toolset.schemas.map((tool) => tool.name);
    expect(names).toContain("save_wrong_question");
    expect(names).not.toContain("delete_wrong_question");
  });

  it("未授权工具即使被调用也拒绝执行", async () => {
    const toolset = await open("child_tutor", "child-1");
    const result = await toolset.callTool("delete_child", { child_id: "child-1" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("未被授权");
  });

  it("孩子身份由服务端覆盖：模型传别的孩子也拿不到别人的数据", async () => {
    childFindFirst.mockResolvedValue({ id: "child-1", familyId: "family-1", name: "JOJO", grade: "三年级", subjects: [] });
    const toolset = await open("child_tutor", "child-1");

    await toolset.callTool("get_child_state", { child_id: "别的孩子" });

    // 守卫收到的是钉住的那个孩子，模型传的值被丢弃
    expect(childFindFirst).toHaveBeenCalledWith({ where: { id: "child-1", familyId: "family-1" } });
  });

  it("家庭级会话不会把孩子的对话粘到某个孩子身上", async () => {
    const toolset = await open("parent_coach", null);
    const result = await toolset.callTool("get_family_policy", { child_id: "child-1" });
    // get_family_policy 不声明 child_id，硬塞的字段会被剔除，调用正常
    expect(result.isError).not.toBe(true);
  });

  it("结果过长会截断，避免整本错题本塞进上下文", async () => {
    childFindMany.mockResolvedValue(
      Array.from({ length: 400 }, (_, index) => ({ id: `child-${index}`, name: `孩子${index}` })),
    );
    const toolset = await open("child_tutor", "child-1");
    const result = await toolset.callTool("list_children", {});
    expect(result.text.length).toBeLessThanOrEqual(6100);
  });

  it("孩子模式下 list_children 只返回自己", async () => {
    childFindMany.mockResolvedValue([
      { child_id: "child-1", id: "child-1", name: "JOJO" },
      { child_id: "child-2", id: "child-2", name: "妹妹" },
    ]);
    const toolset = await open("child_tutor", "child-1");
    const result = await toolset.callTool("list_children", {});
    expect(result.text).toContain("child-1");
    expect(result.text).not.toContain("妹妹");
  });
});
