/**
 * 语音台阶 B：免录制的连续对话。
 *
 * A 级（按住说话）要按两下才好说一句；B 级让系统自己判断"孩子说完一句了"：
 * 听到人声就开始录，安静够久就断句、识别、发出去，然后接着听下一句。
 *
 * 断句逻辑（`UtteranceTracker`）是纯函数式状态机，不碰浏览器 API，便于用脚本断言；
 * 录音与音量采集放在 `createVoiceLoop` 里，依赖可注入，测试时可整体替换。
 */

export type VoiceLoopState = "idle" | "listening" | "speech" | "transcribing";

export type VoiceLoopConfig = {
  /** 判定"有人在说话"的音量阈值（0-1 的均方根） */
  speechThreshold: number;
  /** 说完之后安静多久算一句结束 */
  silenceMs: number;
  /** 单句最长时长，到点强制断句，避免孩子一直说或环境有底噪时录不完 */
  maxUtteranceMs: number;
  /** 短于这个有效时长的声音当作杂音丢掉 */
  minSpeechMs: number;
};

export const VOICE_LOOP_DEFAULTS: VoiceLoopConfig = {
  speechThreshold: 0.02,
  silenceMs: 1100,
  maxUtteranceMs: 15000,
  minSpeechMs: 350,
};

/** 一段采样的音量（均方根）。采样值域按 -1..1 的浮点波形算。 */
export function rmsOf(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** 太短的声音（咳嗽、碰桌子、底噪尖峰）不当一句话，避免把杂音发给模型。 */
export function isUsableUtterance(speechMs: number, config: VoiceLoopConfig = VOICE_LOOP_DEFAULTS) {
  return speechMs >= config.minSpeechMs;
}

export type UtteranceStep = {
  state: VoiceLoopState;
  /** true 表示这一帧之后可以断句发走 */
  shouldStop: boolean;
  /** 这一句累计的有效说话时长 */
  speechMs: number;
};

/**
 * 断句状态机：喂进每一帧的音量和时间戳，吐出当前状态。
 *
 * 空闲时听到人声进入说话态；说话中安静够久、或说了超过单句上限，就断句。
 * 它只做判断，不管录音，所以能脱离浏览器单独测。
 */
export class UtteranceTracker {
  private readonly config: VoiceLoopConfig;
  private startedAt: number | null = null;
  private lastVoiceAt = 0;
  private lastFrameAt: number | null = null;
  private speechMs = 0;

  constructor(config: VoiceLoopConfig = VOICE_LOOP_DEFAULTS) {
    this.config = config;
  }

  get isSpeaking() {
    return this.startedAt !== null;
  }

  reset() {
    this.startedAt = null;
    this.lastVoiceAt = 0;
    this.lastFrameAt = null;
    this.speechMs = 0;
  }

  push(level: number, atMs: number): UtteranceStep {
    const delta = this.lastFrameAt === null ? 0 : Math.max(0, atMs - this.lastFrameAt);
    this.lastFrameAt = atMs;
    const voiced = level >= this.config.speechThreshold;

    if (this.startedAt === null) {
      if (!voiced) return { state: "listening", shouldStop: false, speechMs: 0 };
      // 第一帧人声只用来起头，不计入时长，避免把起手的一声轻响算成有效语言
      this.startedAt = atMs;
      this.lastVoiceAt = atMs;
      this.speechMs = 0;
      return { state: "speech", shouldStop: false, speechMs: 0 };
    }

    if (voiced) {
      this.lastVoiceAt = atMs;
      this.speechMs += delta;
    }

    const silence = atMs - this.lastVoiceAt;
    const elapsed = atMs - this.startedAt;
    const shouldStop = silence >= this.config.silenceMs || elapsed >= this.config.maxUtteranceMs;
    return { state: "speech", shouldStop, speechMs: this.speechMs };
  }
}

export type VoiceMeter = {
  /** 当前这一帧的音量（0-1） */
  read: () => number;
  close: () => void;
};

export type VoiceLoopDeps = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder: (stream: MediaStream) => MediaRecorder;
  createMeter: (stream: MediaStream) => VoiceMeter;
  now: () => number;
  schedule: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

/** 用 WebAudio 的时域波形取音量。需要浏览器环境。 */
function createWebAudioMeter(stream: MediaStream): VoiceMeter {
  const Ctor: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Ctor();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  return {
    read: () => {
      analyser.getFloatTimeDomainData(buffer);
      return rmsOf(buffer);
    },
    close: () => {
      try {
        source.disconnect();
      } catch {
        // 断开失败不影响停止录音
      }
      void context.close().catch(() => {});
    },
  };
}

export function browserVoiceLoopDeps(): VoiceLoopDeps {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createRecorder: (stream) => new MediaRecorder(stream),
    createMeter: createWebAudioMeter,
    now: () => Date.now(),
    schedule: (callback) => window.setTimeout(callback, 60),
    cancel: (handle) => window.clearTimeout(handle),
  };
}

export type VoiceLoop = {
  start: () => Promise<void>;
  stop: () => void;
  isRunning: () => boolean;
};

/**
 * 连续对话录音循环。
 *
 * 一个"句"的生命周期：等声音 → 录 → 断句 → 交给上层识别发送 → 回来继续等。
 * 上层把 `onUtterance` 的 Promise 等到返回后才恢复监听，所以识别与回答期间不会误录。
 */
export function createVoiceLoop(options: {
  config?: Partial<VoiceLoopConfig>;
  deps?: Partial<VoiceLoopDeps>;
  onState: (state: VoiceLoopState) => void;
  onUtterance: (blob: Blob, speechMs: number) => void | Promise<void>;
  onError: (message: string) => void;
}): VoiceLoop {
  const config: VoiceLoopConfig = { ...VOICE_LOOP_DEFAULTS, ...(options.config || {}) };
  const deps: VoiceLoopDeps = { ...browserVoiceLoopDeps(), ...(options.deps || {}) };
  const tracker = new UtteranceTracker(config);

  let running = false;
  let timer: number | null = null;
  let stream: MediaStream | null = null;
  let meter: VoiceMeter | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let speechMs = 0;
  const mimeType = { value: "" };

  function setState(state: VoiceLoopState) {
    options.onState(state);
  }

  function detach() {
    if (timer !== null) {
      deps.cancel(timer);
      timer = null;
    }
    meter?.close();
    meter = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
  }

  function beginSegment() {
    if (!recorder || !stream) return;
    chunks = [];
    speechMs = 0;
    tracker.reset();
    try {
      recorder.start();
    } catch {
      recorder.start(250);
    }
    setState("listening");
    tick();
  }

  function tick() {
    if (!running || !recorder || !meter) return;
    const step = tracker.push(meter.read(), deps.now());
    if (step.state === "speech") {
      speechMs = step.speechMs;
      setState("speech");
    }
    if (step.shouldStop && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    timer = deps.schedule(tick);
  }

  async function handleStop() {
    const blob = new Blob(chunks, { type: mimeType.value || "audio/webm" });
    const capturedMs = speechMs;
    chunks = [];
    if (!running) return;
    if (!isUsableUtterance(capturedMs, config)) {
      // 杂音：不打扰上层，直接接着听下一句
      beginSegment();
      return;
    }
    setState("transcribing");
    try {
      await options.onUtterance(blob, capturedMs);
    } catch {
      // 上层的错误自己提示，这里只负责继续听
    }
    if (running) beginSegment();
  }

  async function start() {
    if (running) return;
    running = true;
    try {
      stream = await deps.getUserMedia({ audio: true });
      recorder = deps.createRecorder(stream);
      mimeType.value = recorder.mimeType || "";
      meter = deps.createMeter(stream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        void handleStop();
      };
      recorder.onerror = () => {
        if (!running) return;
        options.onError("录音出错了，重新开一次连续对话试试。");
        stop();
      };
      beginSegment();
    } catch {
      running = false;
      detach();
      setState("idle");
      options.onError("没有拿到麦克风权限，检查手机的授权设置。");
    }
  }

  function stop() {
    if (!running && !recorder && !stream) return;
    running = false;
    if (timer !== null) {
      deps.cancel(timer);
      timer = null;
    }
    try {
      if (recorder && recorder.state === "recording") recorder.stop();
    } catch {
      // WebView 里偶发抛错，忽略即可
    }
    detach();
    setState("idle");
  }

  return {
    start,
    stop,
    isRunning: () => running,
  };
}
