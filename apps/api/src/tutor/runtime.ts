import { env } from "../env.js";
import type { ChatProvider, ChatMessage } from "./llm/types.js";
import type { TutorToolset } from "./mcp-tools.js";
import { recordSafetyEvent, scanInput, scanOutput, validateReferences } from "./safety.js";
import { normalizePersona } from "./tool-policy.js";

/**
 * Agent 循环：模型 ⇄ 工具。
 * 硬约束：工具轮次上限、单轮超时、结果截断（截断在 toolset 里做）。
 * 这里是"编排层"，自己写；工具协议与模型通信都来自现成的库。
 */

export type TutorEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; ok: boolean }
  | { type: "replace"; reason: string }
  | { type: "done"; usage: { promptTokens: number; completionTokens: number }; toolCalls: { name: string; ok: boolean }[] }
  | { type: "error"; message: string; retryable: boolean; detail?: string };

/**
 * 供应商错误转成家长能看懂的一句话。
 * 家长端直接显示 message，所以不能把上游英文报错、密钥提示或堆栈原文抛出去；
 * 原文放进 detail，只用于排查（前端不显示）。
 */
export function humanizeProviderError(message: string, retryable: boolean): { message: string; retryable: boolean; detail?: string } {
  const raw = (message || "").trim();
  const text = raw.toLowerCase();
  let friendly = "私教暂时不可用，稍后再试一次";
  if (/timeout|timed out|超时|etimedout|aborted|abort/.test(text)) {
    friendly = "这次想得有点久，可以再发一次";
  } else if (/rate|429|too many|quota|limit|限流|额度|繁忙/.test(text)) {
    friendly = "现在用的人比较多，过一会儿再试";
  } else if (/401|403|unauthor|invalid[^a-z]*key|api key|密钥|鉴权/.test(text)) {
    friendly = "私教还没配置好，请联系管理员";
  } else if (/network|econnreset|econnrefused|enotfound|socket|fetch failed|网络/.test(text)) {
    friendly = "网络不太稳，稍后再试一次";
  } else if (/content|moderation|审核|违规|敏感/.test(text)) {
    friendly = "这条内容我不能回答，换个说法试试";
  }
  return { message: friendly, retryable, detail: raw && raw !== friendly ? raw : undefined };
}

export type TutorTurnInput = {
  familyId: string;
  childId?: string | null;
  conversationId?: string | null;
  persona: string;
  systemPrompt: string;
  /** 历史轮次，已按上下文窗口裁剪，按时间正序。 */
  history: ChatMessage[];
  userMessage: string;
  /** 图片：data URL 或可访问 URL。 */
  images?: string[];
  provider: ChatProvider;
  toolset: TutorToolset;
  model: string;
  maxToolRounds?: number;
  timeoutMs?: number;
  /** 外部中断信号（孩子插话打断）。和单轮超时谁先到谁生效。 */
  signal?: AbortSignal;
};

/**
 * 单轮超时 + 外部打断合并成一个信号。
 * 两个来源都要能中止请求，所以不能在外部信号上再挂 timeout，
 * 得各建一个再串起来。
 */
function withTimeout(ms: number, external?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

/** 把模型请求的工具调用参数解析成对象；解析失败按空对象处理并计入审计。 */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

export async function* runTutorTurn(input: TutorTurnInput): AsyncGenerator<TutorEvent> {
  const maxRounds = input.maxToolRounds ?? env.TUTOR_MAX_TOOL_ROUNDS;
  const timeoutMs = input.timeoutMs ?? env.TUTOR_REQUEST_TIMEOUT_MS;
  const persona = normalizePersona(input.persona);

  // L1 输入侧
  const verdict = scanInput(input.userMessage);
  if (!verdict.ok) {
    await recordSafetyEvent({
      familyId: input.familyId,
      childId: input.childId,
      conversationId: input.conversationId,
      stage: "input",
      reason: verdict.reason || "输入被拦截",
      excerpt: input.userMessage,
      action: "blocked",
    });
    yield { type: "error", message: verdict.reason || "这条消息我不能处理", retryable: false };
    return;
  }

  const userContent: ChatMessage["content"] = input.images?.length
    ? [
        { type: "text" as const, text: input.userMessage },
        ...input.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ]
    : input.userMessage;

  const messages: ChatMessage[] = [
    { role: "system", content: input.systemPrompt },
    ...input.history,
    { role: "user", content: userContent },
  ];

  const tools = input.toolset.schemas.length ? input.toolset.schemas : undefined;
  const executed: { name: string; ok: boolean }[] = [];
  const wrongQuestionIds: string[] = [];
  const questionIds: string[] = [];
  let answerText = "";
  let usage = { promptTokens: 0, completionTokens: 0 };
  let rounds = 0;

  while (rounds <= maxRounds) {
    // 被打断就不再往下走：既不再请求模型，也不再调工具
    if (input.signal?.aborted) return;
    const guard = withTimeout(timeoutMs, input.signal);
    const calls: { id: string; name: string; arguments: string }[] = [];
    let roundText = "";
    let failed = false;

    try {
      for await (const event of input.provider.streamChat(
        { model: input.model, messages, tools, temperature: 0.4 },
        guard.signal,
      )) {
        if (event.type === "text") {
          roundText += event.delta;
          answerText += event.delta;
          yield { type: "text", delta: event.delta };
        } else if (event.type === "tool_call") {
          calls.push({ id: event.id, name: event.name, arguments: event.arguments });
        } else if (event.type === "done") {
          usage = {
            promptTokens: usage.promptTokens + (event.usage?.promptTokens || 0),
            completionTokens: usage.completionTokens + (event.usage?.completionTokens || 0),
          };
        } else if (event.type === "error") {
          failed = true;
          yield { type: "error", ...humanizeProviderError(event.message, event.retryable) };
        }
      }
    } finally {
      guard.clear();
    }

    if (failed) return;
    if (!calls.length) break;

    // 把模型的工具请求与本轮文本回灌，形成完整的 assistant 轮次
    messages.push({
      role: "assistant",
      content: roundText,
      toolCalls: calls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
    });

    for (const call of calls) {
      const args = parseArguments(call.arguments);
      const result = await input.toolset.callTool(call.name, args);
      executed.push({ name: call.name, ok: !result.isError });
      yield { type: "tool", name: call.name, ok: !result.isError };

      // 收集引用，供 L3 校验
      const asRecord = (args || {}) as Record<string, unknown>;
      if (typeof asRecord.wrong_question_id === "string") wrongQuestionIds.push(asRecord.wrong_question_id);
      if (typeof asRecord.question_id === "string") questionIds.push(asRecord.question_id);

      messages.push({
        role: "tool",
        content: result.text,
        toolCallId: call.id,
        name: call.name,
      });
    }

    rounds += 1;
    if (rounds > maxRounds) {
      // 超限：停止调用工具，要求模型基于已有信息收尾
      messages.push({
        role: "user",
        content: "已经查得够多了，请直接用现在掌握的信息给出回答，不要再调用工具。",
      });
    }
  }

  // L3 输出侧
  const output = scanOutput(answerText);
  if (!output.ok) {
    await recordSafetyEvent({
      familyId: input.familyId,
      childId: input.childId,
      conversationId: input.conversationId,
      stage: "output",
      reason: output.reason || "输出被替换",
      excerpt: answerText,
      action: output.action,
    });
    yield { type: "replace", reason: output.reason || "内容不合适" };
  }

  const refs = await validateReferences(input.familyId, { wrongQuestionIds, questionIds });
  if (!refs.ok) {
    await recordSafetyEvent({
      familyId: input.familyId,
      childId: input.childId,
      conversationId: input.conversationId,
      stage: "output",
      reason: refs.reason || "引用校验失败",
      excerpt: answerText,
      action: "logged",
    });
    yield { type: "replace", reason: refs.reason || "引用校验失败" };
  }

  yield { type: "done", usage, toolCalls: executed };
}
