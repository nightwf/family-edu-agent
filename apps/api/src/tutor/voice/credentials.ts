/**
 * 语音凭据解析：把环境变量里的一堆字段收敛成"识别能不能用、合成能不能用"。
 *
 * 关键产品事实（已与火山控制台确认）：新版控制台的**一把 API Key 同时覆盖识别与合成**。
 * 所以只填了其中一栏时，另一栏也算有 Key —— 否则会出现"配了 Key 却半个功能是关的"
 * 这种极难排查的状态（接口返回"尚未开通"，看着像控制台没开通）。
 *
 * 优先级：各自专用的字段 > 那一把共享 Key；旧版三件套作为回退保留。
 */

export type VoiceCredentialInput = {
  asrApiKey?: string;
  ttsApiKey?: string;
  /** 新版合成必须先指定音色，否则等于没开通 */
  ttsSpeaker?: string;
  /** 旧版字段，仅在新版 Key 缺失时生效 */
  ttsVoiceType?: string;
  asrAppId?: string;
  asrAccessToken?: string;
  ttsAppId?: string;
  ttsAccessToken?: string;
};

export type ResolvedVoiceCredentials = {
  asrApiKey: string;
  ttsApiKey: string;
  speaker: string;
  /** 同一把 Key 同时供识别与合成使用 */
  apiKeyShared: boolean;
  status: { asr: boolean; tts: boolean };
};

const clean = (value?: string): string => (value ?? "").trim();

export function resolveVoiceCredentials(input: VoiceCredentialInput): ResolvedVoiceCredentials {
  const asrOwn = clean(input.asrApiKey);
  const ttsOwn = clean(input.ttsApiKey);
  const shared = ttsOwn || asrOwn;

  const asrApiKey = asrOwn || shared;
  const ttsApiKey = ttsOwn || shared;
  const speaker = clean(input.ttsSpeaker) || clean(input.ttsVoiceType);

  const legacyAsr = Boolean(clean(input.asrAppId) && clean(input.asrAccessToken));
  const legacyTts = Boolean(clean(input.ttsAppId) && clean(input.ttsAccessToken));

  return {
    asrApiKey,
    ttsApiKey,
    speaker,
    apiKeyShared: Boolean(asrApiKey && ttsApiKey && asrApiKey === ttsApiKey),
    // 新版合成必须有音色；识别拿到 Key 就算可用
    status: {
      asr: Boolean(asrApiKey || legacyAsr),
      tts: Boolean((ttsApiKey && speaker) || legacyTts),
    },
  };
}
