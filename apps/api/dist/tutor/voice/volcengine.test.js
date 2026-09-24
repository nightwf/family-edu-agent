import { afterEach, describe, expect, it, vi } from "vitest";
import { createVolcAsr, createVolcTts, createVolcTtsV3 } from "./volcengine.js";
/**
 * 火山语音的两个真实坑，用假 fetch 钉住：
 *   1. TTS 的业务错误是 HTTP 200 + 正文里的 code/message（cluster、音色、鉴权填错都这样）；
 *   2. ASR 的失败正文常是空对象，真正的 code/message 在响应头里。
 * 若上游报错被吞成一句"未返回音频"，线上就只能靠猜。
 */
const ttsConfig = { appId: "app-1", accessToken: "tok-1", cluster: "volcano_tts", voiceType: "BV700_streaming" };
const asrConfig = { appId: "app-1", accessToken: "tok-1", cluster: "volc.bigasr.auc_turbo" };
const asrConfigApiKey = { apiKey: "key-1", cluster: "volc.bigasr.auc_turbo" };
const ttsV3Config = { apiKey: "key-1", resourceId: "seed-tts-2.0", speaker: "zh_female_vv_uranus_bigtts" };
function stubFetch(handler) {
    const fetchMock = vi.fn(async (url, init) => handler(String(url), init));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}
function jsonResponse(body, headers = {}, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}
/** 造一个 chunked 响应：body 是分片字节流，用来模拟合成接口的流式返回。 */
function streamResponse(chunks, headers = {}, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
        body: (async function* () {
            const encoder = new TextEncoder();
            for (const chunk of chunks)
                yield encoder.encode(chunk);
        })(),
        text: async () => chunks.join(""),
        json: async () => JSON.parse(chunks.join("")),
    };
}
afterEach(() => {
    vi.unstubAllGlobals();
});
describe("语音合成（TTS）", () => {
    it("成功时返回音频字节", async () => {
        stubFetch(() => jsonResponse({ code: 3000, data: Buffer.from([1, 2, 3]).toString("base64") }));
        const audio = await createVolcTts(ttsConfig).synthesize("你好");
        expect(audio.audio).toEqual(Buffer.from([1, 2, 3]));
        expect(audio.contentType).toBe("audio/mpeg");
    });
    it("HTTP 200 但业务 code 报错时，把上游 code 和 message 带出来", async () => {
        stubFetch(() => jsonResponse({ code: 3001, message: "invalid cluster" }));
        await expect(createVolcTts(ttsConfig).synthesize("你好")).rejects.toThrow(/code=3001.*invalid cluster/s);
    });
    it("HTTP 非 200 时带上状态码与正文", async () => {
        stubFetch(() => jsonResponse({ error: "Forbidden" }, {}, 403));
        await expect(createVolcTts(ttsConfig).synthesize("你好")).rejects.toThrow(/HTTP 403.*Forbidden/s);
    });
    it("请求体带上了 cluster 与音色（这两个值最容易填错）", async () => {
        const fetchMock = stubFetch(() => jsonResponse({ code: 3000, data: "AQID" }));
        await createVolcTts(ttsConfig).synthesize("你好");
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.app.cluster).toBe("volcano_tts");
        expect(body.audio.voice_type).toBe("BV700_streaming");
        expect(body.app.appid).toBe("app-1");
    });
});
describe("语音识别（ASR）", () => {
    it("从 result.text 取识别结果", async () => {
        stubFetch(() => jsonResponse({ result: { text: "今天我们一起把这道题弄明白" } }));
        const text = await createVolcAsr(asrConfig).transcribe(Buffer.from("audio"), "mp3");
        expect(text).toBe("今天我们一起把这道题弄明白");
    });
    it("没有 result.text 时退回拼接 utterances", async () => {
        stubFetch(() => jsonResponse({ result: { utterances: [{ text: "第一句" }, { text: "第二句" }] } }));
        await expect(createVolcAsr(asrConfig).transcribe(Buffer.from("audio"), "mp3")).resolves.toBe("第一句第二句");
    });
    it("正文为空对象时，从响应头取出 code 与 message", async () => {
        stubFetch(() => jsonResponse({}, { "x-api-status-code": "45000001", "x-api-message": "request invalid" }));
        await expect(createVolcAsr(asrConfig).transcribe(Buffer.from("audio"), "mp3")).rejects.toThrow(/code=45000001.*request invalid/s);
    });
    it("正文为空对象且没有响应头时，也不返回空文本冒充成功", async () => {
        stubFetch(() => jsonResponse({}));
        await expect(createVolcAsr(asrConfig).transcribe(Buffer.from("audio"), "mp3")).rejects.toThrow(/未识别出内容/);
    });
    it("请求头里的资源标识用的是配置的 cluster", async () => {
        const fetchMock = stubFetch(() => jsonResponse({ result: { text: "好" } }));
        await createVolcAsr(asrConfig).transcribe(Buffer.from("audio"), "mp3");
        const headers = fetchMock.mock.calls[0][1].headers;
        expect(headers["X-Api-Resource-Id"]).toBe("volc.bigasr.auc_turbo");
    });
    it("配了 API Key 时走新版单头鉴权，不带旧版双头", async () => {
        const fetchMock = stubFetch(() => jsonResponse({ result: { text: "好" } }));
        await createVolcAsr(asrConfigApiKey).transcribe(Buffer.from("audio"), "mp3");
        const headers = fetchMock.mock.calls[0][1].headers;
        expect(headers["X-Api-Key"]).toBe("key-1");
        expect(headers["X-Api-App-Id"]).toBeUndefined();
        expect(headers["X-Api-Access-Key"]).toBeUndefined();
    });
    it("没配 API Key 时退回旧版双头（两个头名都带上，兼容文档口径差异）", async () => {
        const fetchMock = stubFetch(() => jsonResponse({ result: { text: "好" } }));
        await createVolcAsr(asrConfig).transcribe(Buffer.from("audio"), "mp3");
        const headers = fetchMock.mock.calls[0][1].headers;
        expect(headers["X-Api-Key"]).toBeUndefined();
        expect(headers["X-Api-App-Id"]).toBe("app-1");
        expect(headers["X-Api-App-Key"]).toBe("app-1");
        expect(headers["X-Api-Access-Key"]).toBe("tok-1");
    });
    it("音频用 base64 的 data 字段传（官方文档：url 与 data 二选一）", async () => {
        const fetchMock = stubFetch(() => jsonResponse({ result: { text: "好" } }));
        await createVolcAsr(asrConfigApiKey).transcribe(Buffer.from([1, 2, 3]), "mp3");
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.audio.data).toBe(Buffer.from([1, 2, 3]).toString("base64"));
        expect(body.audio.format).toBe("mp3");
        expect(body.request.model_name).toBe("bigmodel");
    });
});
describe("语音合成大模型（新版控制台，流式）", () => {
    it("把多个分片的音频拼成一条 mp3", async () => {
        const a = Buffer.from([1, 2]).toString("base64");
        const b = Buffer.from([3, 4]).toString("base64");
        stubFetch(() => streamResponse([`{"code":0,"data":"${a}"}`, `{"code":0,"data":"${b}"}\n`, '{"code":0,"message":"OK"}']));
        const result = await createVolcTtsV3(ttsV3Config).synthesize("你好");
        expect(result.audio).toEqual(Buffer.from([1, 2, 3, 4]));
        expect(result.contentType).toBe("audio/mpeg");
    });
    it("分片切在 JSON 中间也能拼对", async () => {
        const a = Buffer.from([9, 9, 9]).toString("base64");
        const raw = `{"code":0,"data":"${a}"}`;
        stubFetch(() => streamResponse([raw.slice(0, 9), raw.slice(9)]));
        const result = await createVolcTtsV3(ttsV3Config).synthesize("你好");
        expect(result.audio).toEqual(Buffer.from([9, 9, 9]));
    });
    it("请求头带 API Key 与资源标识，音色按配置", async () => {
        const fetchMock = stubFetch(() => streamResponse(['{"code":0,"data":"AQ=="}']));
        await createVolcTtsV3(ttsV3Config).synthesize("你好");
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain("/api/v3/tts/unidirectional");
        expect(init.headers["X-Api-Key"]).toBe("key-1");
        expect(init.headers["X-Api-Resource-Id"]).toBe("seed-tts-2.0");
        const body = JSON.parse(init.body);
        expect(body.req_params.speaker).toBe("zh_female_vv_uranus_bigtts");
        expect(body.req_params.audio_params.format).toBe("mp3");
    });
    it("教育场景参数：去掉 Markdown 与 Emoji，并启用公式朗读", async () => {
        const fetchMock = stubFetch(() => streamResponse(['{"code":0,"data":"AQ=="}']));
        await createVolcTtsV3(ttsV3Config).synthesize("**45** 加 15");
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.req_params.audio_params.disable_markdown_filter).toBe(true);
        expect(body.req_params.audio_params.disable_emoji_filter).toBe(true);
        expect(JSON.parse(body.req_params.additions).latex_parser).toBe("v2");
    });
    it("流里出现非 0 code 时报错，并带出上游 code 与 message", async () => {
        stubFetch(() => streamResponse(['{"code":0,"data":"AQ=="}', '{"code":55000001,"message":"quota exceeded"}']));
        await expect(createVolcTtsV3(ttsV3Config).synthesize("你好")).rejects.toThrow(/code=55000001.*quota exceeded/s);
    });
    it("全程没有音频数据时报错，而不是返回空音频", async () => {
        stubFetch(() => streamResponse(['{"code":0,"message":"OK"}']));
        await expect(createVolcTtsV3(ttsV3Config).synthesize("你好")).rejects.toThrow(/没有返回音频数据/);
    });
    it("HTTP 非 200 时带出状态码与正文", async () => {
        stubFetch(() => streamResponse(["Forbidden"], {}, 403));
        await expect(createVolcTtsV3(ttsV3Config).synthesize("你好")).rejects.toThrow(/HTTP 403.*Forbidden/s);
    });
});
