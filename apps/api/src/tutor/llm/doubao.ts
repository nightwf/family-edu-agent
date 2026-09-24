import type { ChatInput, ChatProvider, StreamEvent } from "./types.js";

/**
 * 豆包（火山方舟）供应商：走 OpenAI 兼容的 /chat/completions 流式接口。
 * 只做一件事——把厂商的 SSE 增量翻译成统一 StreamEvent。
 */

type DoubaoOptions = {
  apiKey: string;
  baseUrl?: string;
};

type PendingToolCall = { id: string; name: string; arguments: string };

/** 把统一消息格式转成豆包要求的 messages 结构。 */
function toWireMessages(input: ChatInput) {
  return input.messages.map((message) => {
    const base: Record<string, unknown> = { role: message.role };
    if (typeof message.content === "string") {
      base.content = message.content;
    } else {
      base.content = message.content;
    }
    if (message.toolCallId) base.tool_call_id = message.toolCallId;
    if (message.toolCalls?.length) {
      base.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    return base;
  });
}

export function createDoubaoProvider(options: DoubaoOptions): ChatProvider {
  const baseUrl = (options.baseUrl || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");

  return {
    name: "doubao",
    supportsVision: true,

    async *streamChat(input: ChatInput, signal: AbortSignal): AsyncIterable<StreamEvent> {
      const body: Record<string, unknown> = {
        model: input.model,
        messages: toWireMessages(input),
        stream: true,
      };
      if (input.tools?.length) {
        body.tools = input.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
        }));
        body.tool_choice = "auto";
      }
      if (typeof input.temperature === "number") body.temperature = input.temperature;
      if (typeof input.maxTokens === "number") body.max_tokens = input.maxTokens;

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        const message = (error as Error)?.name === "AbortError" ? "模型请求超时" : "模型服务连接失败";
        yield { type: "error", message, retryable: true };
        return;
      }

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        yield {
          type: "error",
          message: `模型服务返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ""}`,
          retryable: response.status >= 500 || response.status === 429,
        };
        return;
      }

      const pending = new Map<number, PendingToolCall>();
      let buffer = "";
      let usage = { promptTokens: 0, completionTokens: 0 };
      let finishReason: string | undefined;

      const decoder = new TextDecoder();
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          // SSE 以空行分隔事件；保留最后一段不完整的数据等下一块。
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            for (const line of raw.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;

              let parsed: any;
              try {
                parsed = JSON.parse(payload);
              } catch {
                continue; // 忽略无法解析的噪声行，不中断整轮回答
              }

              if (parsed.usage) {
                usage = {
                  promptTokens: Number(parsed.usage.prompt_tokens || 0),
                  completionTokens: Number(parsed.usage.completion_tokens || 0),
                };
              }

              const choice = parsed.choices?.[0];
              if (!choice) continue;
              if (choice.finish_reason) finishReason = choice.finish_reason;

              const delta = choice.delta || {};
              if (typeof delta.content === "string" && delta.content) {
                yield { type: "text", delta: delta.content };
              }
              for (const call of delta.tool_calls || []) {
                const index = Number(call.index ?? 0);
                const current = pending.get(index) || { id: "", name: "", arguments: "" };
                if (call.id) current.id = call.id;
                if (call.function?.name) current.name = call.function.name;
                if (call.function?.arguments) current.arguments += call.function.arguments;
                pending.set(index, current);
              }
            }
          }
        }
      } catch (error) {
        if ((error as Error)?.name === "AbortError") {
          yield { type: "error", message: "模型请求超时", retryable: true };
          return;
        }
        yield { type: "error", message: "模型响应中断", retryable: true };
        return;
      }

      for (const [index, call] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
        if (!call.name) continue; // 只有碎片、没有函数名的忽略
        yield { type: "tool_call", id: call.id || `call_${index}`, name: call.name, arguments: call.arguments || "{}" };
      }
      yield { type: "done", usage, finishReason };
    },
  };
}
