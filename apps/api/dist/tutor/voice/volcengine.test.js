import { afterEach, describe, expect, it, vi } from "vitest";
import { createVolcAsr, createVolcTts } from "./volcengine.js";
/**
 * 火山语音的两个真实坑，用假 fetch 钉住：
 *   1. TTS 的业务错误是 HTTP 200 + 正文里的 code/message（cluster、音色、鉴权填错都这样）；
 *   2. ASR 的失败正文常是空对象，真正的 code/message 在响应头里。
 * 若上游报错被吞成一句"未返回音频"，线上就只能靠猜。
 */
const ttsConfig = { appId: "app-1", accessToken: "tok-1", cluster: "volcano_tts", voiceType: "BV700_streaming" };
const asrConfig = { appId: "app-1", accessToken: "tok-1", cluster: "volc.bigasr.auc_turbo" };
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
});
