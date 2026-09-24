import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatProvider, StreamEvent } from "./llm/types.js";
import type { TutorToolset } from "./mcp-tools.js";
import { humanizeProviderError, runTutorTurn } from "./runtime.js";

// 安全事件与引用校验都落库，测试里打桩，只关心 runtime 的行为
const recordSafetyEvent = vi.fn();
const validateReferences = vi.fn().mockResolvedValue({ ok: true });

vi.mock("./safety.js", () => ({
  scanInput: (text: string) => {
    if (!String(text || "").trim()) return { ok: false, reason: "消息不能为空", action: "blocked" };
    if (String(text).includes("自杀")) return { ok: false, reason: "自伤相关表达", action: "blocked" };
    return { ok: true, action: "pass" };
  },
  scanOutput: (text: string) => {
    if (String(text).includes("你真笨")) return { ok: false, reason: "羞辱或比较式表达", action: "replaced", text: "我们换个说法" };
    return { ok: true, action: "pass", text };
  },
  validateReferences: (...args: unknown[]) => validateReferences(...args),
  recordSafetyEvent: (...args: unknown[]) => recordSafetyEvent(...args),
  moderationConfigured: () => true,
}));

/** 按轮次吐事件的假供应商。 */
function providerFromRounds(rounds: StreamEvent[][]): ChatProvider {
  let index = 0;
  return {
    name: "test",
    supportsVision: true,
    async *streamChat() {
      const events = rounds[Math.min(index, rounds.length - 1)] || [];
      index += 1;
      for (const event of events) yield event;
    },
  };
}

function fakeToolset(overrides: Partial<TutorToolset> = {}): TutorToolset {
  return {
    schemas: [{ name: "get_wrong_question", description: "读错题", inputSchema: { type: "object" } }],
    callTool: vi.fn().mockResolvedValue({ text: '{"title":"错题"}', isError: false }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    familyId: "family-1",
    childId: "child-1",
    conversationId: "conv-1",
    persona: "child_tutor",
    systemPrompt: "你是私教",
    history: [],
    userMessage: "这题怎么做",
    provider: providerFromRounds([[{ type: "text", delta: "先说说你的想法" }, { type: "done", usage: { promptTokens: 10, completionTokens: 5 } }]]),
    toolset: fakeToolset(),
    model: "test-model",
    ...overrides,
  } as any;
}

async function collect(input: any) {
  const events: any[] = [];
  for await (const event of runTutorTurn(input)) events.push(event);
  return events;
}

beforeEach(() => {
  recordSafetyEvent.mockClear();
  validateReferences.mockClear();
  validateReferences.mockResolvedValue({ ok: true });
});

describe("Agent 循环", () => {
  it("正常回答：流式文本与 done 一起产出", async () => {
    const events = await collect(baseInput());
    expect(events.filter((event) => event.type === "text").map((event) => event.delta)).toEqual([
      "先说说你的想法",
    ]);
    const done = events.find((event) => event.type === "done");
    expect(done.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(done.toolCalls).toEqual([]);
  });

  it("需要工具：先调工具，再把结果回灌后继续回答", async () => {
    const toolset = fakeToolset();
    const provider = providerFromRounds([
      [
        { type: "tool_call", id: "c1", name: "get_wrong_question", arguments: '{"wrong_question_id":"w1"}' },
        { type: "done", usage: { promptTokens: 5, completionTokens: 1 } },
      ],
      [
        { type: "text", delta: "这道题考的是进位" },
        { type: "done", usage: { promptTokens: 8, completionTokens: 4 } },
      ],
    ]);
    const events = await collect(baseInput({ provider, toolset }));

    expect(toolset.callTool).toHaveBeenCalledTimes(1);
    expect(toolset.callTool).toHaveBeenCalledWith("get_wrong_question", { wrong_question_id: "w1" });
    expect(events.find((event) => event.type === "tool")).toMatchObject({ name: "get_wrong_question", ok: true });
    expect(events.filter((event) => event.type === "text")).toHaveLength(1);
    const done = events.find((event) => event.type === "done");
    // 两轮用量累加
    expect(done.usage).toEqual({ promptTokens: 13, completionTokens: 5 });
    expect(done.toolCalls).toEqual([{ name: "get_wrong_question", ok: true }]);
  });

  it("工具被拒绝时仍继续，并把失败计入审计", async () => {
    const toolset = fakeToolset({
      callTool: vi.fn().mockResolvedValue({ text: "工具 save_wrong_question 未被授权使用", isError: true }),
    });
    const provider = providerFromRounds([
      [{ type: "tool_call", id: "c1", name: "save_wrong_question", arguments: "{}" }, { type: "done", usage: { promptTokens: 1, completionTokens: 1 } }],
      [{ type: "text", delta: "我记录不了" }, { type: "done", usage: { promptTokens: 1, completionTokens: 1 } }],
    ]);
    const events = await collect(baseInput({ provider, toolset }));
    expect(events.find((event) => event.type === "tool")).toMatchObject({ ok: false });
    const done = events.find((event) => event.type === "done");
    expect(done.toolCalls).toEqual([{ name: "save_wrong_question", ok: false }]);
  });

  it("工具轮次超限会停止调用并要求收尾", async () => {
    const toolset = fakeToolset();
    const alwaysTool: StreamEvent[] = [
      { type: "tool_call", id: "c1", name: "get_wrong_question", arguments: "{}" },
      { type: "done", usage: { promptTokens: 1, completionTokens: 1 } },
    ];
    const events = await collect(baseInput({ provider: providerFromRounds([alwaysTool]), toolset, maxToolRounds: 2 }));

    // 2 轮上限 + 收尾轮 = 最多 3 次调用
    expect((toolset.callTool as any).mock.calls.length).toBeLessThanOrEqual(3);
    expect(events.some((event) => event.type === "done")).toBe(true);
  });

  it("模型报错：直接终止，不留半截回答", async () => {
    const provider = providerFromRounds([[{ type: "error", message: "模型服务连接失败", retryable: true }]]);
    const events = await collect(baseInput({ provider }));
    // 上游原文不直接给家长看，换成友好提示，原文放 detail
    expect(events).toEqual([
      { type: "error", message: "私教暂时不可用，稍后再试一次", retryable: true, detail: "模型服务连接失败" },
    ]);
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("供应商错误按类型给出可读提示：超时、限流、密钥分别不同", () => {
    expect(humanizeProviderError("Request timed out after 45s", true).message).toBe("这次想得有点久，可以再发一次");
    expect(humanizeProviderError("429 Too Many Requests", true).message).toBe("现在用的人比较多，过一会儿再试");
    expect(humanizeProviderError("401 Unauthorized: invalid api key", false).message).toBe("私教还没配置好，请联系管理员");
    expect(humanizeProviderError("fetch failed: ECONNRESET", true).message).toBe("网络不太稳，稍后再试一次");
    // 已经可读的原文不重复包一层，也不塞进 detail
    expect(humanizeProviderError("私教暂时不可用，稍后再试一次", true).detail).toBeUndefined();
  });

  it("输入侧拦截：有害内容不发模型", async () => {
    const provider = providerFromRounds([[{ type: "text", delta: "不该出现" }, { type: "done", usage: { promptTokens: 0, completionTokens: 0 } }]]);
    const events = await collect(baseInput({ provider, userMessage: "我想自杀" }));
    expect(events).toEqual([{ type: "error", message: "自伤相关表达", retryable: false }]);
    expect(recordSafetyEvent).toHaveBeenCalledWith(expect.objectContaining({ stage: "input", action: "blocked" }));
  });

  it("输出侧替换：命中羞辱式表达时给出替代回复", async () => {
    const provider = providerFromRounds([[{ type: "text", delta: "你真笨" }, { type: "done", usage: { promptTokens: 1, completionTokens: 1 } }]]);
    const events = await collect(baseInput({ provider }));
    expect(events.find((event) => event.type === "replace")).toMatchObject({ reason: "羞辱或比较式表达" });
    expect(recordSafetyEvent).toHaveBeenCalledWith(expect.objectContaining({ stage: "output" }));
  });

  it("引用校验失败：降级并记录", async () => {
    validateReferences.mockResolvedValue({ ok: false, reason: "引用了不属于本家庭的错题" });
    const toolset = fakeToolset();
    const provider = providerFromRounds([
      [{ type: "tool_call", id: "c1", name: "get_wrong_question", arguments: '{"wrong_question_id":"w-other"}' }, { type: "done", usage: { promptTokens: 1, completionTokens: 1 } }],
      [{ type: "text", delta: "看这道题" }, { type: "done", usage: { promptTokens: 1, completionTokens: 1 } }],
    ]);
    const events = await collect(baseInput({ provider, toolset }));
    expect(events.find((event) => event.type === "replace")).toMatchObject({ reason: "引用了不属于本家庭的错题" });
    expect(validateReferences).toHaveBeenCalledWith("family-1", { wrongQuestionIds: ["w-other"], questionIds: [] });
  });

  it("图片消息会以多模态格式送进模型", async () => {
    let seen: any;
    const provider: ChatProvider = {
      name: "test",
      supportsVision: true,
      async *streamChat(input) {
        seen = input;
        yield { type: "text", delta: "看到了" };
        yield { type: "done", usage: { promptTokens: 1, completionTokens: 1 } };
      },
    };
    await collect(baseInput({ provider, images: ["data:image/png;base64,AAA"] }));
    const last = seen.messages[seen.messages.length - 1];
    expect(last.content).toEqual([
      { type: "text", text: "这题怎么做" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ]);
  });
});
