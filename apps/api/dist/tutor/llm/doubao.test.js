import { afterEach, describe, expect, it, vi } from "vitest";
import { createDoubaoProvider } from "./doubao.js";
/** 用给定的 SSE 分片拼一个假响应。分片刻意切在事件中间，验证缓冲逻辑。 */
function sseResponse(chunks, init = {}) {
    const encoder = new TextEncoder();
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        text: async () => "",
        body: {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks)
                    yield encoder.encode(chunk);
            },
        },
    };
}
function data(payload) {
    return `data: ${JSON.stringify(payload)}\n\n`;
}
afterEach(() => {
    vi.unstubAllGlobals();
});
async function collect(provider, signal = new AbortController().signal) {
    const events = [];
    for await (const event of provider.streamChat({ model: "m", messages: [{ role: "user", content: "hi" }] }, signal)) {
        events.push(event);
    }
    return events;
}
describe("豆包流式解析", () => {
    it("把文本增量翻译成统一事件，并取到用量", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
            data({ choices: [{ delta: { content: "先想" } }] }),
            data({ choices: [{ delta: { content: "想思路" } }] }),
            data({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 7 } }),
            "data: [DONE]\n\n",
        ])));
        const events = await collect(createDoubaoProvider({ apiKey: "k" }));
        expect(events.filter((event) => event.type === "text").map((event) => event.delta)).toEqual(["先想", "想思路"]);
        const done = events.find((event) => event.type === "done");
        expect(done.usage).toEqual({ promptTokens: 12, completionTokens: 7 });
        expect(done.finishReason).toBe("stop");
    });
    it("分包切在事件中间也能正确拼回来", async () => {
        const full = data({ choices: [{ delta: { content: "完整回答" } }] }) + data({ choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
        const chunks = [];
        for (let i = 0; i < full.length; i += 7)
            chunks.push(full.slice(i, i + 7));
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(chunks)));
        const events = await collect(createDoubaoProvider({ apiKey: "k" }));
        expect(events.filter((event) => event.type === "text").map((event) => event.delta)).toEqual(["完整回答"]);
    });
    it("跨分片的工具调用参数会被拼接完整", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
            data({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_wrong_question", arguments: '{"wrong_' } }] } }] }),
            data({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'question_id":"w1"}' } }] } }] }),
            data({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        ])));
        const events = await collect(createDoubaoProvider({ apiKey: "k" }));
        const call = events.find((event) => event.type === "tool_call");
        expect(call).toEqual({ type: "tool_call", id: "call_1", name: "get_wrong_question", arguments: '{"wrong_question_id":"w1"}' });
    });
    it("多个工具调用按 index 分别归位", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
            data({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "tool_a", arguments: "{}" } }, { index: 1, id: "b", function: { name: "tool_b", arguments: "{}" } }] } }] }),
            data({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        ])));
        const events = await collect(createDoubaoProvider({ apiKey: "k" }));
        const calls = events.filter((event) => event.type === "tool_call");
        expect(calls.map((call) => call.name)).toEqual(["tool_a", "tool_b"]);
    });
    it("无法解析的噪声行被跳过，不中断整轮", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
            "data: {坏json\n\n",
            data({ choices: [{ delta: { content: "还能继续" } }] }),
            data({ choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        ])));
        const events = await collect(createDoubaoProvider({ apiKey: "k" }));
        expect(events.filter((event) => event.type === "text").map((event) => event.delta)).toEqual(["还能继续"]);
    });
    it("HTTP 报错转成可读的 error 事件", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: async () => "unauthorized",
        }));
        const events = await collect(createDoubaoProvider({ apiKey: "bad" }));
        expect(events[0]).toMatchObject({ type: "error", retryable: false });
        expect(events[0].message).toContain("401");
    });
    it("网络异常转成可重试的 error，不抛出", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
        const events = await collect(createDoubaoProvider({ apiKey: "k" }));
        expect(events[0]).toMatchObject({ type: "error", retryable: true });
    });
    it("请求体带上工具定义与模型名", async () => {
        const fetchMock = vi.fn().mockResolvedValue(sseResponse([data({ choices: [{ delta: {} }] })]));
        vi.stubGlobal("fetch", fetchMock);
        const provider = createDoubaoProvider({ apiKey: "key-1", baseUrl: "https://example.com/api/v3/" });
        const events = [];
        for await (const event of provider.streamChat({
            model: "doubao-pro",
            messages: [{ role: "user", content: "hi" }],
            thinking: "disabled",
            tools: [{ name: "get_child_state", description: "读状态", inputSchema: { type: "object" } }],
        }, new AbortController().signal)) {
            events.push(event);
        }
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://example.com/api/v3/chat/completions");
        const body = JSON.parse(init.body);
        expect(body.model).toBe("doubao-pro");
        expect(body.stream).toBe(true);
        expect(body.thinking).toEqual({ type: "disabled" });
        expect(body.tools[0].function.name).toBe("get_child_state");
        expect(init.headers.Authorization).toBe("Bearer key-1");
    });
});
