import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTutorSpeech, stripForSpeech } from "./tutor";
import { createVoiceLoop, type VoiceLoop, type VoiceLoopState } from "./tutor-voice";

type SpeechQueue = {
  urls: string[];
  playing: boolean;
  current: HTMLAudioElement | null;
  settle: (() => void) | null;
  stopped: boolean;
};

/**
 * 私教的两个语音动作：把回答念出来（TTS）、免提问的连续对话（台阶 B）。
 *
 * 拆成 hook 是因为它两件事都要维护"跨渲染的活对象"：播放中的音频元素、录音循环。
 * 组件只关心"现在在读哪条消息""现在在听还是在想"。
 */
export function useTutorVoice(options: {
  apiBase: string;
  token: string;
  ttsReady: boolean;
  asrReady: boolean;
  /** 连续对话静默多久自动关麦克风（毫秒，服务端下发）。0 或未给则用默认值。 */
  idleMs?: number;
  /** 连续对话里识别出一句之后，交给上层发送 */
  onTranscript: (text: string) => void | Promise<void>;
  /** 听到孩子开口（用来判断要不要打断正在念的答案） */
  onSpeechStart?: () => void;
  /** 静默太久自动收工，上层据此提示孩子 */
  onIdle?: () => void;
  onError: (message: string) => void;
}) {
  const [speakingId, setSpeakingId] = useState("");
  const [loopState, setLoopState] = useState<VoiceLoopState>("idle");
  const [continuous, setContinuous] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const speakingIdRef = useRef("");
  const loopRef = useRef<VoiceLoop | null>(null);
  const transcriptRef = useRef(options.onTranscript);
  const speechStartRef = useRef(options.onSpeechStart);
  const idleRef = useRef(options.onIdle);
  const errorRef = useRef(options.onError);
  const asrReadyRef = useRef(options.asrReady);
  const speechRef = useRef<SpeechQueue>({ urls: [], playing: false, current: null, settle: null, stopped: false });

  transcriptRef.current = options.onTranscript;
  speechStartRef.current = options.onSpeechStart;
  idleRef.current = options.onIdle;
  errorRef.current = options.onError;
  asrReadyRef.current = options.asrReady;

  /** 把队列里的语音片段一段接一段放完；被打断就立刻清空。 */
  const drainSpeech = useCallback(async () => {
    const state = speechRef.current;
    if (state.playing) return;
    state.playing = true;
    state.stopped = false;
    setSpeaking(true);
    while (!state.stopped && state.urls.length) {
      const url = state.urls.shift() as string;
      const audio = new Audio(url);
      state.current = audio;
      await new Promise<void>((resolve) => {
        state.settle = resolve;
        audio.onended = resolve;
        audio.onerror = resolve;
        void audio.play().catch(resolve);
      });
      state.settle = null;
      state.current = null;
      URL.revokeObjectURL(url);
    }
    state.playing = false;
    setSpeaking(false);
  }, []);

  /** 收一句语音片段进播放队列，边到边念，不等整段回答合成完。 */
  const enqueueSpeech = useCallback(
    (base64: string, format = "audio/mpeg") => {
      if (!base64) return;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const url = URL.createObjectURL(new Blob([bytes], { type: format }));
      speechRef.current.urls.push(url);
      void drainSpeech();
    },
    [drainSpeech],
  );

  /** 立刻停嘴：清空还没念的片段，掐断正在念的那一段。 */
  const stopSpeech = useCallback(() => {
    const state = speechRef.current;
    state.stopped = true;
    state.urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    if (state.current) {
      state.current.pause();
      state.current.src = "";
    }
    state.settle?.();
    setSpeaking(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    speakingIdRef.current = "";
    setSpeakingId("");
  }, []);

  /** 念一条回答。再点一次同一条就是停止。 */
  const speak = useCallback(
    async (text: string, id: string) => {
      const plain = stripForSpeech(text);
      if (!plain || !options.ttsReady) return;
      if (speakingIdRef.current === id) {
        stopSpeaking();
        return;
      }
      stopSpeaking();
      try {
        const blob = await fetchTutorSpeech({ apiBase: options.apiBase, token: options.token, text: plain });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioUrlRef.current = url;
        audioRef.current = audio;
        audio.onended = () => {
          if (audioRef.current === audio) stopSpeaking();
        };
        audio.onerror = () => {
          if (audioRef.current === audio) stopSpeaking();
        };
        speakingIdRef.current = id;
        setSpeakingId(id);
        await audio.play().catch(() => {
          // 浏览器要求先有用户手势才允许播放；播放失败不该冒红字打扰使用
          stopSpeaking();
        });
      } catch (error) {
        setSpeakingId("");
        speakingIdRef.current = "";
        errorRef.current((error as Error).message);
      }
    },
    [options.apiBase, options.token, options.ttsReady, stopSpeaking],
  );

  // 组件卸载时收干净：停播放、停录音，别让麦克风指示灯一直亮着
  useEffect(
    () => () => {
      const loop = loopRef.current;
      loopRef.current = null;
      loop?.stop();
      speechRef.current.urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
      speechRef.current.stopped = true;
      speechRef.current.current?.pause();
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = "";
      }
    },
    [],
  );

  const stopContinuous = useCallback(() => {
    const loop = loopRef.current;
    loopRef.current = null;
    loop?.stop();
    setLoopState("idle");
    setContinuous(false);
  }, []);

  /**
   * 静默太久，循环自己收工了。
   *
   * 这里不能走 stopContinuous：麦克风是循环自己放掉的，再 stop 一次是多余的，
   * 只要把界面上的开关拨回去、并告诉孩子为什么，别让他以为坏了。
   */
  const handleIdleStop = useCallback(() => {
    loopRef.current = null;
    setLoopState("idle");
    setContinuous(false);
    idleRef.current?.();
  }, []);

  /**
   * 页面被切到后台（或锁屏）就停掉连续对话。
   *
   * 连续对话期间麦克风是持续开着的，这是插话打断的前提；但不管的话，
   * 孩子把 App 切走、手机锁屏，麦克风会一直亮着也开始采音，既费电，
   * 家长看到指示灯常亮也会觉得是在偷听。
   * 回到前台不自动重开：开关必须和真实状态一致，要听就再点一下。
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") stopContinuous();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", stopContinuous);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", stopContinuous);
    };
  }, [stopContinuous]);

  const startContinuous = useCallback(async () => {
    if (loopRef.current) return;
    const loop = createVoiceLoop({
      // 静默兜底：服务端下发的值优先，没给就用循环自己的默认值
      ...(options.idleMs ? { config: { idleMs: options.idleMs } } : {}),
      onState: setLoopState,
      onSpeechStart: () => speechStartRef.current?.(),
      onIdle: handleIdleStop,
      onError: (message) => {
        errorRef.current(message);
        stopContinuous();
      },
      onUtterance: async (blob) => {
        const form = new FormData();
        form.append("file", blob, "voice.webm");
        const response = await fetch(`${options.apiBase}/api/tutor/voice/transcribe`, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.token}` },
          body: form,
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data?.error || `识别失败（${response.status}）`);
        }
        const data = (await response.json()) as { text?: string };
        const text = String(data?.text || "").trim();
        if (text) await transcriptRef.current(text);
      },
    });
    loopRef.current = loop;
    setContinuous(true);
    await loop.start();
  }, [handleIdleStop, options.apiBase, options.idleMs, options.token, stopContinuous]);

  const toggleContinuous = useCallback(() => {
    if (loopRef.current) {
      stopContinuous();
      return;
    }
    if (!asrReadyRef.current) {
      errorRef.current("语音识别尚未开通，暂时不能连续对话。");
      return;
    }
    void startContinuous();
  }, [startContinuous, stopContinuous]);

  /** 私教开口时抬麦克风门槛，避免把自己的声音当成孩子在说话 */
  const setTutorSpeaking = useCallback((tutorSpeaking: boolean) => {
    const loop = loopRef.current;
    if (!loop) return;
    loop.setSensitivity(tutorSpeaking ? 3 : 1);
    // 同时也告诉循环"私教在忙"：它念答案时孩子安静听着是正常的，
    // 不该被算成走开了而把麦克风关掉。
    loop.setTutorActive(tutorSpeaking);
  }, []);

  // 语音能力被关掉（例如服务端未开通）时，别留下一个开着但用不了的循环
  useEffect(() => {
    if (!options.asrReady && loopRef.current) stopContinuous();
  }, [options.asrReady, stopContinuous]);

  return {
    speakingId,
    speak,
    stopSpeaking,
    speaking,
    enqueueSpeech,
    stopSpeech,
    continuous,
    toggleContinuous,
    loopState,
    setTutorSpeaking,
  };
}
