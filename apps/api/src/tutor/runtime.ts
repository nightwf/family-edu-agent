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

type AutomaticLookup = { name: string; arguments: Record<string, unknown> };

/**
 * 哪些问题不能只靠模型凭记忆回答，必须先读禾芽里的真实数据。
 *
 * 这里不是做一套意图分类器，只兜住高价值、不可编造的动作。尤其是
 * “按最近错题出题”：模型如果先客套一句“我去看看”却不发工具调用，
 * 当前回合就会直接结束。把第一步查询放到编排层，能保证它真的查过数据。
 */
export function planAutomaticLookups(userMessage: string): AutomaticLookup[] {
  const text = String(userMessage || "").replace(/\s+/g, "");
  const mentionsWrongQuestions = /错题|做错|薄弱题/.test(text);
  const asksPractice = /出题|练习|同类题|同类型|同题型|变式|针对性|巩固|测一测|测试/.test(text);
  if (mentionsWrongQuestions && asksPractice) {
    // 只取近期几条，足够判断重点；避免把整本错题本塞进一次对话。
    return [{ name: "list_wrong_questions", arguments: { limit: 5, offset: 0 } }];
  }
  return [];
}

/**
 * 模型是不是只承诺了下一步、但还没有真正做。
 * 命中后运行时会自动再给模型一轮，不把“我先看看”当作最终回答。
 */
export function isDeferredActionOnly(text: string): boolean {
  const compact = String(text || "").replace(/\s+/g, "").replace(/[～~😊😉✨🔍📚📖✏️]/g, "");
  if (!compact) return false;
  const promisesAction = /(我先|让我|我来|接下来|马上|这就).{0,18}(查|看看|找|读取|分析|整理|生成|准备)/.test(compact);
  const hasDeliveredResult = /(根据|查到|结果|发现|题目如下|第[一二三四五0-9]+题|1[.、]|①)/.test(compact);
  return promisesAction && !hasDeliveredResult;
}

/** 从 list_wrong_questions 的工具结果里取前几条错题 id，继续读生成规则。 */
function wrongQuestionIdsFromToolResult(text: string, limit = 2): string[] {
  try {
    const payload = JSON.parse(text);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const ids: string[] = [];
    for (const item of items) {
      if (typeof item?.id === "string") ids.push(item.id);
    }
    return [...new Set(ids)].slice(0, limit);
  } catch {
    // 工具结果可能因过长被截断；取 items 开头的 id 仍比完全不继续可靠。
    const ids = [...text.matchAll(/\"id\":\"([^\"]+)\"/g)].map((match) => match[1]);
    return [...new Set(ids)].slice(0, limit);
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
  let followThroughRetries = 0;

  /**
   * 对“按最近错题出题”这类强依赖真实数据的请求，编排层先把第一步查掉。
   * 不能只靠提示词期待模型自觉：线上已经出现过模型说“我先看看”，
   * 但 toolCalls 为空，随后整个回合直接结束的真实案例。
   */
  const automaticLookups = planAutomaticLookups(input.userMessage);
  for (const [index, lookup] of automaticLookups.entries()) {
    if (!input.toolset.schemas.some((schema) => schema.name === lookup.name)) continue;
    const callId = `auto_${lookup.name}_${index}`;
    const result = await input.toolset.callTool(lookup.name, lookup.arguments);
    executed.push({ name: lookup.name, ok: !result.isError });
    yield { type: "tool", name: lookup.name, ok: !result.isError };
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [{ id: callId, name: lookup.name, arguments: JSON.stringify(lookup.arguments) }],
    });
    messages.push({ role: "tool", content: result.text, toolCallId: callId, name: lookup.name });

    // “针对错题出题”不止要看到错题标题，还要读题型不变量、常见错误和变式覆盖。
    // 取前两条重点错题即可，兼顾针对性与上下文大小。
    if (
      lookup.name === "list_wrong_questions" &&
      !result.isError &&
      input.toolset.schemas.some((schema) => schema.name === "get_wrong_question_practice_context")
    ) {
      for (const [contextIndex, wrongQuestionId] of wrongQuestionIdsFromToolResult(result.text).entries()) {
        const contextName = "get_wrong_question_practice_context";
        const contextArgs = { wrong_question_id: wrongQuestionId, count: 3 };
        const contextCallId = `auto_wrong_context_${contextIndex}`;
        const contextResult = await input.toolset.callTool(contextName, contextArgs);
        executed.push({ name: contextName, ok: !contextResult.isError });
        yield { type: "tool", name: contextName, ok: !contextResult.isError };
        wrongQuestionIds.push(wrongQuestionId);
        messages.push({
          role: "assistant",
          content: "",
          toolCalls: [{ id: contextCallId, name: contextName, arguments: JSON.stringify(contextArgs) }],
        });
        messages.push({
          role: "tool",
          content: contextResult.text,
          toolCallId: contextCallId,
          name: contextName,
        });
      }
    }
  }

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
    if (!calls.length) {
      // 模型只说“我先看看/马上查”，却没有真正调用工具时，不能把承诺句当成回答结束。
      // 自动补一轮，让它使用已有结果或立即调工具，用户不需要再追问一句“继续”。
      if (isDeferredActionOnly(roundText) && followThroughRetries < 1 && rounds < maxRounds) {
        messages.push({ role: "assistant", content: roundText });
        messages.push({
          role: "system",
          content:
            "你刚才只说明了接下来要做什么，还没有完成用户的请求。不要等待用户再次回复：已有工具结果就立即基于结果完成回答；仍缺数据就现在调用必要工具，并在同一回合继续到可直接使用的结果。禁止再用‘我先看看/稍后给你’结束。",
        });
        followThroughRetries += 1;
        rounds += 1;
        continue;
      }
      break;
    }

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
