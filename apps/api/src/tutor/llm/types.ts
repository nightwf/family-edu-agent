/**
 * 模型供应商抽象：把"跟模型通信"这件事收敛到一层，
 * 上层 runtime 只认这里的统一事件类型，不认任何厂商格式。
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: ChatRole;
  content: string | ChatContentPart[];
  toolCallId?: string;
  name?: string;
  /** assistant 消息里模型请求调用的工具 */
  toolCalls?: { id: string; name: string; arguments: string }[];
};

export type ToolSchema = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ChatInput = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
};

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "done"; usage: { promptTokens: number; completionTokens: number }; finishReason?: string }
  | { type: "error"; message: string; retryable: boolean };

export interface ChatProvider {
  name: string;
  supportsVision: boolean;
  streamChat(input: ChatInput, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

/** 供测试与本地开发使用的假供应商：不发网络请求，按脚本吐事件。 */
export class FakeChatProvider implements ChatProvider {
  name = "fake";
  supportsVision = true;
  calls: ChatInput[] = [];

  constructor(private script: StreamEvent[][] = [[{ type: "text", delta: "好的" }, { type: "done", usage: { promptTokens: 1, completionTokens: 1 } }]]) {}

  async *streamChat(input: ChatInput): AsyncIterable<StreamEvent> {
    this.calls.push(input);
    const events = this.script[Math.min(this.calls.length - 1, this.script.length - 1)] || [];
    for (const event of events) yield event;
  }
}
