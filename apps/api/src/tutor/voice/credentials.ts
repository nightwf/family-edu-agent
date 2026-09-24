/**
 * 语音凭据解析：把环境变量里的一堆字段收敛成"识别能不能用、合成能不能用、走哪条协议"。
 *
 * 两条关键事实（均已对真实上游实测确认）：
 *
 * 1. **凭据是共享的**。火山语音控制台给的是 App ID + Access Token，识别与合成共用同一套；
 *    新版控制台给的是单把 API Key，同样两个服务共用。所以只填了一栏时，另一栏也算有凭据——
 *    否则会出现"配了凭据却半个功能是关的"这种极难排查的状态（接口返回"尚未开通"，
 *    看着像控制台没开通，实际是配置只写了一半）。
 *
 * 2. **合成要走大模型接口**。实测：本账号在旧版 `/api/v1/tts` 上返回
 *    `403 resource_id=volc.tts.default requested resource not granted`（小模型未开通），
 *    而 `/api/v3/tts/unidirectional` 用同一套 App ID + Token 正常出声。
 *    所以默认走 v3；只有显式配了旧的 cluster（说明确实是老账号）才退回 v1。
 *
 * 鉴权头两种形式都支持：
 *   v3 合成：有 API Key → `X-Api-Key`；否则 → `X-Api-App-Key` + `X-Api-Access-Key`
 */

export type VoiceCredentialInput = {
  asrApiKey?: string;
  ttsApiKey?: string;
  /** 新版合成必须先指定音色，否则等于没开通 */
  ttsSpeaker?: string;
  /** 旧版字段里的音色名，与 ttsSpeaker 等价 */
  ttsVoiceType?: string;
  asrAppId?: string;
  asrAccessToken?: string;
  ttsAppId?: string;
  ttsAccessToken?: string;
  /** 旧版合成的集群标识；只有它存在时才认为是要走旧协议 */
  ttsCluster?: string;
};

export type TtsProtocol = "v3" | "legacy";

export type ResolvedVoiceCredentials = {
  /** 主要那把 API Key（合成优先），用于展示"该配哪一把" */
  apiKey: string;
  /** 识别/合成各自解析后的 Key（只填了一栏时，另一栏回退到同一把） */
  asrApiKey: string;
  ttsApiKey: string;
  /** App ID / Access Token 同样按服务解析，缺一栏时回退到另一栏 */
  asrAppId: string;
  asrAccessToken: string;
  ttsAppId: string;
  ttsAccessToken: string;
  speaker: string;
  protocol: TtsProtocol;
  /** 同一把 Key 同时供识别与合成使用 */
  apiKeyShared: boolean;
  status: { asr: boolean; tts: boolean };
};

const clean = (value?: string): string => (value ?? "").trim();

export function resolveVoiceCredentials(input: VoiceCredentialInput): ResolvedVoiceCredentials {
  const asrKeyOwn = clean(input.asrApiKey);
  const ttsKeyOwn = clean(input.ttsApiKey);
  // 两栏分别填了就各用各的；只填了一栏时另一栏回退到这一把（凭据本来就是共享的）
  const asrApiKey = asrKeyOwn || ttsKeyOwn;
  const ttsApiKey = ttsKeyOwn || asrKeyOwn;

  const asrAppIdOwn = clean(input.asrAppId);
  const ttsAppIdOwn = clean(input.ttsAppId);
  const asrTokenOwn = clean(input.asrAccessToken);
  const ttsTokenOwn = clean(input.ttsAccessToken);
  const asrAppId = asrAppIdOwn || ttsAppIdOwn;
  const ttsAppId = ttsAppIdOwn || asrAppIdOwn;
  const asrAccessToken = asrTokenOwn || ttsTokenOwn;
  const ttsAccessToken = ttsTokenOwn || asrTokenOwn;

  const speaker = clean(input.ttsSpeaker) || clean(input.ttsVoiceType);

  // 有音色就走大模型接口；没音色但配了旧 cluster，说明是老账号，走旧协议
  const protocol: TtsProtocol = speaker ? "v3" : clean(input.ttsCluster) ? "legacy" : "v3";

  const asrAppCredentials = Boolean(asrAppId && asrAccessToken);
  const ttsAppCredentials = Boolean(ttsAppId && ttsAccessToken);
  const ttsV3Credentials = Boolean(ttsApiKey || ttsAppCredentials);

  return {
    apiKey: ttsKeyOwn || asrKeyOwn,
    asrApiKey,
    ttsApiKey,
    asrAppId,
    asrAccessToken,
    ttsAppId,
    ttsAccessToken,
    speaker,
    protocol,
    apiKeyShared: Boolean(asrApiKey && ttsApiKey && asrApiKey === ttsApiKey),
    status: {
      asr: Boolean(asrApiKey || asrAppCredentials),
      // v3 必须要音色（否则静默念不出声）；旧协议只要凭据齐全
      tts: protocol === "v3" ? Boolean(ttsV3Credentials && speaker) : ttsAppCredentials,
    },
  };
}
