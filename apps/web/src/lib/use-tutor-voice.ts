import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTutorSpeech, stripForSpeech } from "./tutor";
import { createVoiceLoop, type VoiceLoop, type VoiceLoopState } from "./tutor-voice";

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
  /** 连续对话里识别出一句之后，交给上层发送 */
  onTranscript: (text: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [speakingId, setSpeakingId] = useState("");
  const [loopState, setLoopState] = useState<VoiceLoopState>("idle");
  const [continuous, setContinuous] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const speakingIdRef = useRef("");
  const loopRef = useRef<VoiceLoop | null>(null);
  const transcriptRef = useRef(options.onTranscript);
  const errorRef = useRef(options.onError);
  const asrReadyRef = useRef(options.asrReady);

  transcriptRef.current = options.onTranscript;
  errorRef.current = options.onError;
  asrReadyRef.current = options.asrReady;

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

  const startContinuous = useCallback(async () => {
    if (loopRef.current) return;
    const loop = createVoiceLoop({
      onState: setLoopState,
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
  }, [options.apiBase, options.token, stopContinuous]);

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

  // 语音能力被关掉（例如服务端未开通）时，别留下一个开着但用不了的循环
  useEffect(() => {
    if (!options.asrReady && loopRef.current) stopContinuous();
  }, [options.asrReady, stopContinuous]);

  return {
    speakingId,
    speak,
    stopSpeaking,
    continuous,
    toggleContinuous,
    loopState,
  };
}
