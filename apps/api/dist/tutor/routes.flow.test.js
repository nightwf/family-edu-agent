import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
/**
 * 私教一轮完整对话的端到端测试（HTTP → SSE → 落库 → 证据）。
 *
 * 只打桩「模型」和「MCP 工具集」两处外部依赖：模型换成按脚本吐事件的假供应商，
 * 工具集换成进程内假实现。前面的 routes.test.ts 关心鉴权与边界，这里关心
 * 「一整轮真的跑通」：流式逐字返回、助手消息落库、额度递减、证据待确认。
 */
process.env.WEB_DIST = ".";
process.env.TUTOR_ENABLED = "true";
process.env.TUTOR_CHAT_API_KEY = "test-key";
process.env.TUTOR_CHAT_MODEL = "test-model";
process.env.TUTOR_DAILY_MESSAGE_LIMIT = "5";
const state = {};
const writes = { tutorMessage: [], tutorConversation: [], evidenceRecord: [], auditLog: [] };
/** 语音桩：记录被念了哪些句子，并可切换"语音没开通"的状态。 */
const speechState = { tts: false, sentences: [] };
vi.mock("./voice/index.js", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getVoiceStatus: () => ({ asr: true, tts: speechState.tts }),
        synthesize: async (text) => {
            if (!speechState.tts)
                throw new actual.VoiceNotConfiguredError("tts");
            speechState.sentences.push(text);
            return { audio: Buffer.from(`AUDIO:${text}`, "utf8"), contentType: "audio/mpeg" };
        },
    };
});
function fallbackModel(prop) {
    return vi.fn().mockResolvedValue(prop === "count" ? 0 : prop === "findFirst" || prop === "findUnique" ? null : []);
}
const prismaMock = new Proxy({
    user: { findUnique: vi.fn(async () => ({ id: "user-1", familyId: "family-1", status: "active" })) },
    familyMember: { findFirst: vi.fn(async () => ({ id: "member-1", role: "owner", status: "active" })) },
    child: { findFirst: vi.fn(async ({ where }) => ({ id: where.id, familyId: where.familyId, name: "JOJO" })) },
    tutorConversation: {
        findFirst: vi.fn(async ({ where }) => 
        // conv-1 属于 family-1；换家庭身份后必须查不到
        where.id === "conv-1" && where.familyId === "family-1"
            ? { id: "conv-1", familyId: "family-1", childId: "child-1", persona: "child_tutor", status: "active", title: "两步应用题" }
            : null),
        findUnique: vi.fn(async () => ({ id: "conv-1", familyId: "family-1", childId: "child-1", summary: null })),
        findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }) => {
            writes.tutorConversation.push(data);
            return { id: "conv-1", ...data };
        }),
        update: vi.fn(async ({ data }) => {
            writes.tutorConversation.push(data);
            return { id: "conv-1", ...data };
        }),
    },
    tutorMessage: {
        count: vi.fn(async () => 0),
        // 会话摘要与证据草稿都读这轮真实写入的消息，而不是返回空数组。
        findMany: vi.fn(async () => writes.tutorMessage
            .filter((row) => row.role === "user" || row.role === "assistant")
            .map((row, index) => ({ ...row, id: `msg-${index + 1}`, createdAt: new Date(Date.now() + index) }))),
        create: vi.fn(async ({ data }) => {
            writes.tutorMessage.push(data);
            return { id: `msg-${writes.tutorMessage.length}`, createdAt: new Date(), ...data };
        }),
    },
    evidenceRecord: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }) => {
            writes.evidenceRecord.push(data);
            // reviewStatus 由数据库默认值给出，这里照实回填，路由不得自己写成"已确认"。
            return { id: "ev-1", reviewStatus: "PENDING_CONFIRMATION", createdAt: new Date(), ...data };
        }),
    },
    auditLog: {
        create: vi.fn(async ({ data }) => {
            writes.auditLog.push(data);
            return { id: "audit-1", ...data };
        }),
    },
}, { get: (target, prop) => (prop in target ? target[prop] : new Proxy({}, { get: (_t, method) => fallbackModel(method) })) });
vi.mock("../prisma.js", () => ({ prisma: prismaMock }));
/** 假工具集：私教这轮不需要真调用工具，只看工具是否被暴露、是否被正确收尾。 */
const toolsetClosed = { count: 0 };
vi.mock("./mcp-tools.js", () => ({
    createTutorToolset: vi.fn(async () => ({
        schemas: [{ name: "get_child_state", description: "读取孩子当前状态", inputSchema: { type: "object", properties: { child_id: { type: "string" } } } }],
        callTool: vi.fn(async () => ({ text: '{"summary":{"evidence_7d":2}}', isError: false })),
        close: vi.fn(async () => {
            toolsetClosed.count += 1;
        }),
    })),
}));
/** 假模型：第一名孩子先逐字吐一段引导式回答，再一次工具调用后收尾。 */
function scriptedProvider(script) {
    const calls = [];
    return {
        name: "fake",
        supportsVision: true,
        calls,
        async *streamChat(input) {
            calls.push(input);
            const events = script[Math.min(calls.length - 1, script.length - 1)] || [];
            for (const event of events)
                yield event;
        },
    };
}
const { buildApp } = await import("../app.js");
const { setChatProvider } = await import("./llm/index.js");
let app;
let token;
beforeAll(async () => {
    app = await buildApp();
    token = app.jwt.sign({ sub: "user-1", familyId: "family-1" });
});
afterAll(async () => {
    setChatProvider(null);
    await app.close();
});
beforeEach(() => {
    writes.tutorMessage.length = 0;
    writes.tutorConversation.length = 0;
    writes.evidenceRecord.length = 0;
    writes.auditLog.length = 0;
    toolsetClosed.count = 0;
    speechState.tts = false;
    speechState.sentences.length = 0;
});
function auth() {
    return { authorization: `Bearer ${token}` };
}
/** 解析 SSE 文本为事件数组。 */
function parseSse(payload) {
    return payload
        .split("\n\n")
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => {
        const event = /^event: (.+)$/m.exec(block)?.[1] || "";
        const data = /^data: (.+)$/m.exec(block)?.[1] || "{}";
        return { event, data: JSON.parse(data) };
    });
}
describe("私教一轮完整对话", () => {
    it("流式返回逐字内容，助手消息落库，额度递减，工具集收尾", async () => {
        const provider = scriptedProvider([
            [
                { type: "text", delta: "先别急着算。" },
                { type: "text", delta: "你先说说「比小红多 15 颗」是什么意思？" },
                { type: "done", usage: { promptTokens: 12, completionTokens: 18 } },
            ],
        ]);
        setChatProvider(provider);
        const response = await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/messages",
            headers: auth(),
            payload: { text: "这道题我不会" },
        });
        expect(response.statusCode).toBe(200);
        const events = parseSse(response.payload);
        const textEvents = events.filter((event) => event.event === "text");
        expect(textEvents.map((event) => event.data.delta).join("")).toBe("先别急着算。你先说说「比小红多 15 颗」是什么意思？");
        // 逐字返回：多个 text 事件，而不是一次吐出整段
        expect(textEvents.length).toBeGreaterThan(1);
        const done = events.find((event) => event.event === "done");
        expect(done?.data.messageId).toBe("msg-2");
        expect(done?.data.usage).toEqual({ promptTokens: 12, completionTokens: 18 });
        expect(done?.data.quotaLeft).toBe(4);
        // 用户消息先落库（模型失败也有记录），助手消息在 done 时落库
        expect(writes.tutorMessage.map((row) => row.role)).toEqual(["user", "assistant"]);
        expect(writes.tutorMessage[1].content).toBe("先别急着算。你先说说「比小红多 15 颗」是什么意思？");
        expect(writes.tutorMessage[1].model).toBe("test-model");
        expect(writes.tutorMessage[1].childId).toBe("child-1");
        // 会话被更新时间与标题（原来没有标题时用首句派生）
        const updated = writes.tutorConversation.at(-1);
        expect(updated?.title).toBeTruthy();
        expect(toolsetClosed.count).toBe(1);
    });
    it("模型报错时降级为可读提示，不抛 500，也不留下空的助手消息", async () => {
        setChatProvider(scriptedProvider([[{ type: "error", message: "上游超时", retryable: true }]]));
        const response = await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/messages",
            headers: auth(),
            payload: { text: "还在吗" },
        });
        expect(response.statusCode).toBe(200);
        const events = parseSse(response.payload);
        const error = events.find((event) => event.event === "error");
        // 家长看到的是友好提示，不是上游原文；原文留在 detail 里排查
        expect(error?.data.message).toBe("这次想得有点久，可以再发一次");
        expect(error?.data.detail).toBe("上游超时");
        expect(error?.data.retryable).toBe(true);
        expect(events.some((event) => event.event === "done")).toBe(false);
        expect(writes.tutorMessage.map((row) => row.role)).toEqual(["user"]);
    });
    it("一轮对话结束后沉淀的证据是待确认状态，且来源标记为 tutor", async () => {
        setChatProvider(scriptedProvider([[{ type: "text", delta: "我们先把小红的数量算出来。" }, { type: "done", usage: { promptTokens: 5, completionTokens: 9 } }]]));
        await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/messages",
            headers: auth(),
            payload: { text: "小明有 45 颗糖，比小红多 15 颗" },
        });
        const evidence = await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/evidence",
            headers: auth(),
            payload: {},
        });
        expect(evidence.statusCode).toBe(200);
        expect(evidence.json().reviewStatus).toBe("PENDING_CONFIRMATION");
        expect(writes.evidenceRecord).toHaveLength(1);
        expect(writes.evidenceRecord[0].source).toBe("tutor");
        expect(writes.evidenceRecord[0].sourceRef).toBe("conv-1");
        // 路由不得自己把证据写成已确认
        expect(writes.evidenceRecord[0].reviewStatus).toBeUndefined();
        // 同时留下审计记录，谁写的可回溯
        const audit = writes.auditLog.find((row) => row.action === "evidence.create");
        expect(audit?.actorType).toBe("tutor");
    });
    it("同一轮里重复沉淀相同证据不会写第二条", async () => {
        setChatProvider(scriptedProvider([[{ type: "text", delta: "先算小红的数量。" }, { type: "done", usage: { promptTokens: 5, completionTokens: 9 } }]]));
        await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/messages",
            headers: auth(),
            payload: { text: "比小红多 15 颗" },
        });
        const first = await app.inject({ method: "POST", url: "/api/tutor/conversations/conv-1/evidence", headers: auth(), payload: {} });
        expect(first.json().reviewStatus).toBe("PENDING_CONFIRMATION");
        // 第二次时库里已有同样记录
        prismaMock.evidenceRecord.findFirst.mockResolvedValueOnce({ id: "ev-1", observedBehavior: writes.evidenceRecord[0].observedBehavior });
        const second = await app.inject({ method: "POST", url: "/api/tutor/conversations/conv-1/evidence", headers: auth(), payload: {} });
        expect(second.statusCode).toBe(200);
        expect(second.json().skipped).toBe(true);
        expect(writes.evidenceRecord).toHaveLength(1);
    });
    it("讲义接口返回可打印 HTML，带着孩子名字与这轮的对话内容", async () => {
        setChatProvider(scriptedProvider([[{ type: "text", delta: "先把小红的数量算出来。" }, { type: "done", usage: { promptTokens: 4, completionTokens: 6 } }]]));
        await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/messages",
            headers: auth(),
            payload: { text: "小明比小红多 15 颗，一共多少颗？" },
        });
        const response = await app.inject({
            method: "GET",
            url: "/api/tutor/conversations/conv-1/worksheet",
            headers: auth(),
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toContain("text/html");
        expect(response.payload).toContain("JOJO");
        expect(response.payload).toContain("小明比小红多 15 颗");
        expect(response.payload).toContain("先把小红的数量算出来。");
        expect(response.payload).toContain("window.print()");
    });
    it("读不到别家的会话讲义", async () => {
        const otherToken = app.jwt.sign({ sub: "user-2", familyId: "family-2" });
        prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-2", familyId: "family-2", status: "active" });
        const response = await app.inject({
            method: "GET",
            url: "/api/tutor/conversations/conv-1/worksheet",
            headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(response.statusCode).toBe(404);
    });
    it("语音开通时回答按句合成，文本流完之后逐句推语音片段", async () => {
        speechState.tts = true;
        setChatProvider(scriptedProvider([
            [
                { type: "text", delta: "先读一遍题。" },
                { type: "text", delta: "再看看单位是什么。" },
                { type: "done", usage: { promptTokens: 4, completionTokens: 6 } },
            ],
        ]));
        const response = await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/messages",
            headers: auth(),
            payload: { text: "我不会", speak: true },
        });
        const events = parseSse(response.payload);
        const start = events.find((event) => event.event === "speech_start");
        expect(start?.data.total).toBe(2);
        expect(speechState.sentences).toEqual(["先读一遍题。", "再看看单位是什么。"]);
        const chunks = events.filter((event) => event.event === "speech");
        expect(chunks.map((event) => Buffer.from(event.data.chunk, "base64").toString("utf8"))).toEqual([
            "AUDIO:先读一遍题。",
            "AUDIO:再看看单位是什么。",
        ]);
        expect(chunks.every((event) => event.data.format === "audio/mpeg")).toBe(true);
        expect(events.some((event) => event.event === "speech_end")).toBe(true);
        // 语音片段排在 done 之后，孩子先看到字再听到声音
        expect(events.findIndex((event) => event.event === "done")).toBeLessThan(events.findIndex((event) => event.event === "speech"));
    });
    it("语音没开通时请求朗读也不会报错，只是没有语音片段", async () => {
        speechState.tts = false;
        setChatProvider(scriptedProvider([[{ type: "text", delta: "先读题。" }, { type: "done", usage: { promptTokens: 1, completionTokens: 1 } }]]));
        const response = await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/messages",
            headers: auth(),
            payload: { text: "我不会", speak: true },
        });
        expect(response.statusCode).toBe(200);
        const events = parseSse(response.payload);
        expect(events.some((event) => event.event === "speech")).toBe(false);
        expect(events.some((event) => event.event === "error")).toBe(false);
        // 文字照常拿到，不因为没语音而失败
        expect(events.filter((event) => event.event === "text").length).toBeGreaterThan(0);
        expect(events.some((event) => event.event === "done")).toBe(true);
    });
    it("孩子插话能打断生成：保留已经说出口的那半句，不再往下跑", async () => {
        let openGate = () => { };
        const gate = new Promise((resolve) => {
            openGate = resolve;
        });
        setChatProvider({
            name: "slow",
            supportsVision: true,
            async *streamChat() {
                yield { type: "text", delta: "先看看题目里的" };
                await gate;
                yield { type: "text", delta: "这句话不该被说出来" };
                yield { type: "done", usage: { promptTokens: 1, completionTokens: 1 } };
            },
        });
        const pending = app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/messages",
            headers: auth(),
            payload: { text: "我不会" },
        });
        await new Promise((resolve) => setTimeout(resolve, 40));
        const interrupted = await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/interrupt",
            headers: auth(),
        });
        expect(interrupted.statusCode).toBe(200);
        expect(interrupted.json().interrupted).toBe(true);
        openGate();
        const response = await pending;
        const events = parseSse(response.payload);
        expect(events.some((event) => event.event === "interrupted")).toBe(true);
        expect(events.some((event) => event.event === "done")).toBe(false);
        // 被打断不是故障：不该给家长弹错误
        expect(events.some((event) => event.event === "error")).toBe(false);
        // 已经说出口的部分要留档，孩子回头看得到自己听到哪
        expect(writes.tutorMessage.map((row) => row.role)).toEqual(["user", "assistant"]);
        expect(writes.tutorMessage[1].content).toBe("先看看题目里的");
        // 收尾照做，工具集不泄漏
        expect(toolsetClosed.count).toBe(1);
    });
    it("没有进行中的回合时打断是安全的空操作", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/interrupt",
            headers: auth(),
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().interrupted).toBe(false);
    });
    it("打断不了别家的会话", async () => {
        const otherToken = app.jwt.sign({ sub: "user-2", familyId: "family-2" });
        prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-2", familyId: "family-2", status: "active" });
        const response = await app.inject({
            method: "POST",
            url: "/api/tutor/conversations/conv-1/interrupt",
            headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(response.statusCode).toBe(404);
    });
});
