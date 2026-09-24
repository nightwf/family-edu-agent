import { describe, expect, it } from "vitest";
import { resolveVoiceCredentials } from "./credentials.js";

describe("语音凭据解析：一把共享 Key 覆盖识别与合成", () => {
  it("只填了合成那栏，识别也算开通（不会出现半个功能关着）", () => {
    const out = resolveVoiceCredentials({
      ttsApiKey: "shared-key",
      ttsSpeaker: "zh_female_vv_uranus_bigtts",
    });
    expect(out.asrApiKey).toBe("shared-key");
    expect(out.ttsApiKey).toBe("shared-key");
    expect(out.status).toEqual({ asr: true, tts: true });
    expect(out.apiKeyShared).toBe(true);
  });

  it("只填了识别那栏，合成只要给了音色也能用", () => {
    const out = resolveVoiceCredentials({
      asrApiKey: "shared-key",
      ttsSpeaker: "zh_female_vv_uranus_bigtts",
    });
    expect(out.ttsApiKey).toBe("shared-key");
    expect(out.status).toEqual({ asr: true, tts: true });
  });

  it("两栏填了不同的 Key 时各用各的，不互相覆盖", () => {
    const out = resolveVoiceCredentials({ asrApiKey: "asr-key", ttsApiKey: "tts-key", ttsSpeaker: "s" });
    expect(out.asrApiKey).toBe("asr-key");
    expect(out.ttsApiKey).toBe("tts-key");
    expect(out.apiKeyShared).toBe(false);
  });
});

describe("语音凭据解析：哪些情况算未开通", () => {
  it("合成有 Key 但没音色算未开通（否则会静默念不出来）", () => {
    const out = resolveVoiceCredentials({ ttsApiKey: "k" });
    expect(out.status).toEqual({ asr: true, tts: false });
  });

  it("什么都没配就是两个都没开通", () => {
    expect(resolveVoiceCredentials({}).status).toEqual({ asr: false, tts: false });
  });

  it("只有空白字符不算配置（复制时多带空格是常见事故）", () => {
    const out = resolveVoiceCredentials({ asrApiKey: "  ", ttsApiKey: " ", ttsSpeaker: " " });
    expect(out.status).toEqual({ asr: false, tts: false });
    expect(out.apiKeyShared).toBe(false);
  });

  it("旧版三件套仍可用：识别要 AppID+Token，合成要 AppID+Token", () => {
    const out = resolveVoiceCredentials({
      asrAppId: "a",
      asrAccessToken: "t",
      ttsAppId: "a",
      ttsAccessToken: "t",
      ttsVoiceType: "zh_female_vv_uranus_bigtts",
    });
    expect(out.status).toEqual({ asr: true, tts: true });
    // 旧版音色字段也能当 speaker 用，避免两条路径行为不一致
    expect(out.speaker).toBe("zh_female_vv_uranus_bigtts");
  });

  it("旧版缺 Token 不算开通", () => {
    expect(resolveVoiceCredentials({ asrAppId: "a", ttsAppId: "a" }).status).toEqual({
      asr: false,
      tts: false,
    });
  });

  it("新版 Key 优先于旧版三件套（切到新版后旧值残留不会干扰）", () => {
    const out = resolveVoiceCredentials({
      ttsApiKey: "new-key",
      ttsAppId: "old",
      ttsAccessToken: "old",
      ttsSpeaker: "s",
    });
    expect(out.ttsApiKey).toBe("new-key");
    expect(out.status.tts).toBe(true);
  });
});

describe("语音凭据解析：App ID + Access Token 也是共享的", () => {
  it("只填了识别那栏的 App ID/Token，合成照样能用（线上就是这么配的）", () => {
    const out = resolveVoiceCredentials({
      asrAppId: "6892892485",
      asrAccessToken: "tok",
      ttsSpeaker: "zh_female_vv_uranus_bigtts",
    });
    expect(out.ttsAppId).toBe("6892892485");
    expect(out.ttsAccessToken).toBe("tok");
    expect(out.status).toEqual({ asr: true, tts: true });
  });

  it("App ID 与 Token 只来一半不算开通（避免半配状态静默失败）", () => {
    expect(resolveVoiceCredentials({ asrAppId: "6892892485", ttsSpeaker: "s" }).status).toEqual({
      asr: false,
      tts: false,
    });
    expect(resolveVoiceCredentials({ asrAccessToken: "tok", ttsSpeaker: "s" }).status).toEqual({
      asr: false,
      tts: false,
    });
  });
});

describe("语音凭据解析：合成走哪条协议", () => {
  it("有音色就走大模型接口 v3（线上实测旧接口未开通、v3 可用）", () => {
    const out = resolveVoiceCredentials({
      asrAppId: "a",
      asrAccessToken: "t",
      ttsSpeaker: "zh_female_vv_uranus_bigtts",
    });
    expect(out.protocol).toBe("v3");
  });

  it("没音色但配了旧 cluster，说明是老账号，走旧协议", () => {
    const out = resolveVoiceCredentials({
      ttsAppId: "a",
      ttsAccessToken: "t",
      ttsCluster: "volcano_tts",
      ttsVoiceType: "",
    });
    expect(out.protocol).toBe("legacy");
    expect(out.status.tts).toBe(true);
  });

  it("旧字段名 ttsVoiceType 也能当音色用，并且此时同样走 v3", () => {
    const out = resolveVoiceCredentials({
      ttsAppId: "a",
      ttsAccessToken: "t",
      ttsCluster: "volcano_tts",
      ttsVoiceType: "zh_female_vv_uranus_bigtts",
    });
    expect(out.speaker).toBe("zh_female_vv_uranus_bigtts");
    expect(out.protocol).toBe("v3");
  });
});
