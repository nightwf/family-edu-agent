import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BookmarkPlus,
  AudioWaveform,
  CircleStop,
  ImagePlus,
  Loader2,
  MessageSquare,
  Mic,
  Minimize2,
  MoreHorizontal,
  Plus,
  Printer,
  Send,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Badge, ChildTabs, Panel } from "./Layout";
import { splitParagraphs, streamTutorMessage, type TutorStreamEvent } from "../lib/tutor";
import { useTutorVoice } from "../lib/use-tutor-voice";

type Child = { id: string; name: string; grade?: string; gender?: string };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  toolNote?: string;
};

type Props = {
  token: string;
  apiBase: string;
  children: Child[];
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
  /** 关闭整个私教浮窗（二次确认之后才调用）。 */
  onClose?: () => void;
  /** 最小化只隐藏界面，对话、播放和连续收音保持运行。 */
  onMinimize?: () => void;
};

const EMPTY_HINT = "拍一张错题照片，或者直接问一道题。我会先问你思路，不会直接给答案。";

const LOOP_STATE_TEXT: Record<string, string> = {
  idle: "点一下开始听",
  listening: "在听，直接说就行",
  speech: "听到了，继续说",
  transcribing: "正在识别…",
};

/** 语音页使用独立的透明精灵素材，状态变化交给 CSS 动画表达。 */
const TUTOR_ORB_ASSET = `${import.meta.env.BASE_URL}brand/tutor-voice-orb.webp`;

/**
 * 自动朗读是个"偏好"，不是"这一次的选择"。
 * 得存在本地：关掉之后再打开私教、换个孩子、刷新页面，它还得是关的。
 * 浮窗一关 TutorChat 就卸载了，只放在组件里的话，下次打开又会自己开始念。
 */
const AUTO_READ_KEY = "familyEduTutorAutoRead";

function readAutoReadPreference() {
  try {
    return localStorage.getItem(AUTO_READ_KEY) !== "0";
  } catch {
    // 拿不到 localStorage（无痕模式等）就按默认开着，不影响别的功能
    return true;
  }
}

function writeAutoReadPreference(value: boolean) {
  try {
    localStorage.setItem(AUTO_READ_KEY, value ? "1" : "0");
  } catch {
    // 存不下就算了，只是下次进来会回到默认值
  }
}

/**
 * 内置学习私教的对话主体，装在外层浮窗里。
 * 与 WorkBuddy 接入共用同一份数据：这里聊出来的证据同样要家长确认后才生效。
 */
export default function TutorChat({ token, apiBase, children, request, onClose, onMinimize }: Props) {
  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id || "");
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [status, setStatus] = useState<{ enabled: boolean; ready: boolean; model_configured: boolean } | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<{ asr: boolean; tts: boolean; idleMs: number }>({
    asr: false,
    tts: false,
    idleMs: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quotaLeft, setQuotaLeft] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [autoRead, setAutoRead] = useState(readAutoReadPreference);
  const [confirmClose, setConfirmClose] = useState(false);
  /** 次要操作（记录/打印/新对话）按移动端惯例收进「更多」，标题栏才放得下孩子名字 */
  const [actionsOpen, setActionsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const autoReadRef = useRef(autoRead);
  const voiceStatusRef = useRef(voiceStatus);
  /** 实时对话里的文字流，跟着最新一句自动滚到底 */
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  /**
   * 这一轮回答的朗读被孩子自己打断了：他按了录音、发了新消息、关了开关，
   * 或者干脆开口插了话。打断之后就不再自动接着念——剩下的片段、收尾时
   * 整段兜底的那次朗读都算"自动"。想听只能自己点某条消息上的「朗读」。
   * 发下一条新问题时清掉，否则开关开着也永远不会再出声。
   */
  const speechCutRef = useRef(false);
  const sendRef = useRef<(text: string) => void | Promise<void>>(async () => {});
  /** 私教正在说话时孩子插的话：先排队，等还在跑的那一轮收尾再发出去 */
  const pendingSpeechRef = useRef<string[]>([]);
  const idleWaitersRef = useRef<Array<() => void>>([]);
  const bargeInRef = useRef<() => void>(() => {});

  function waitForIdle() {
    if (!busyRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => idleWaitersRef.current.push(resolve));
  }

  useEffect(() => {
    setSelectedChildId((current) => (children.some((child) => child.id === current) ? current : children[0]?.id || ""));
  }, [children]);

  useEffect(() => {
    request("/api/tutor/status", {}, token)
      .then((data) => {
        setStatus(data);
        setQuotaLeft(typeof data?.quota?.left_messages === "number" ? data.quota.left_messages : null);
      })
      .catch((err) => setError((err as Error).message));
    request("/api/tutor/voice/status", {}, token)
      .then((data) =>
        setVoiceStatus({
          asr: Boolean(data?.asr),
          tts: Boolean(data?.tts),
          // 静默自动收工的时长由服务端下发，前端不写死
          idleMs: Number(data?.idle_ms) > 0 ? Number(data.idle_ms) : 0,
        }),
      )
      .catch(() => setVoiceStatus({ asr: false, tts: false, idleMs: 0 }));
  }, [token, request]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    autoReadRef.current = autoRead;
    writeAutoReadPreference(autoRead);
  }, [autoRead]);

  // 录音期间被切到后台（来电、锁屏、切 App），抬起事件不会再来，
  // 录音会一直挂到 60 秒兜底才停。这里听见页面不可见就直接收工。
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") recorderRef.current?.stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // 「更多」开着时按 Esc 只收菜单：用捕获阶段拦下来，
  // 免得冒泡到浮窗外层，顺手把整个对话窗口也关了。
  useEffect(() => {
    if (!actionsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setActionsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [actionsOpen]);

  // 退出确认打开时，Esc 只该关掉确认框，不该顺手把整个私教也关掉。
  // 用捕获阶段拦下来，抢在浮窗外层那个"按 Esc 关闭"之前。
  useEffect(() => {
    if (!confirmClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setConfirmClose(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [confirmClose]);

  const voice = useTutorVoice({
    apiBase,
    token,
    asrReady: voiceStatus.asr,
    ttsReady: voiceStatus.tts,
    /**
     * 识别到一句就先排队再发，不等私教把上一段念完。
     * 等它等于把麦克风关掉一整轮，插话打断就成了空话。
     */
    onTranscript: async (text) => {
      if (busyRef.current) {
        pendingSpeechRef.current.push(text);
        return;
      }
      await sendRef.current(text);
    },
    onSpeechStart: () => bargeInRef.current(),
    onIdle: () =>
      setNotice(
        `有一会儿没听到声音，连续对话先关上了。想接着说，再点一下「连续对话」。`,
      ),
    idleMs: voiceStatus.idleMs,
    onError: (message) => setError(message),
  });
  const speakRef = useRef(voice.speak);
  speakRef.current = voice.speak;
  const enqueueSpeechRef = useRef(voice.enqueueSpeech);
  enqueueSpeechRef.current = voice.enqueueSpeech;
  voiceStatusRef.current = voiceStatus;
  const stopAllSpeechRef = useRef(voice.stopAllSpeech);
  stopAllSpeechRef.current = voice.stopAllSpeech;

  /**
   * 现在这条回答还允许自动出声吗。
   * 开关关着、或者这一轮已经被孩子打断过，就都不许——
   * 两处（流式片段、收尾兜底）必须是同一个判断，漏一个就会出现"关掉了还在念"。
   */
  const maySpeakAutomatically = () => autoReadRef.current && !speechCutRef.current;

  /** 孩子自己动手打断：立刻停嘴，并且这一轮不再自动接着念。 */
  const cutSpeech = () => {
    speechCutRef.current = true;
    stopAllSpeechRef.current();
  };

  // 私教正在说话（生成中或正在念）时，把麦克风门槛抬高，
  // 免得喇叭里的声音被收回来，变成"自己打断自己"。
  useEffect(() => {
    voice.setTutorSpeaking(busy || voice.speaking);
  }, [busy, voice.speaking, voice.setTutorSpeaking]);

  /**
   * 孩子插话：本地立刻停嘴，再让服务端别继续生成。
   * 两步都要做 —— 只停本地播放的话，服务端还在烧模型和语音配额。
   */
  bargeInRef.current = () => {
    const tutorTalking = busyRef.current || voice.speaking;
    if (!tutorTalking) return;
    // 已经排进队列、或者下一秒还会到的那几句，都不能再放出来，
    // 否则孩子一开口、私教停一下、然后接着念，听着像没理他。
    cutSpeech();
    if (!conversationId) return;
    void fetch(`${apiBase}/api/tutor/conversations/${conversationId}/interrupt`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => {});
  };

  const loadConversation = useCallback(
    async (id: string) => {
      const history = await request(`/api/tutor/conversations/${id}/messages?limit=30`, {}, token);
      setConversationId(id);
      setMessages(
        (history?.messages || [])
          .filter((row: any) => row.role === "user" || row.role === "assistant")
          .map((row: any) => ({ id: row.id, role: row.role, content: row.content || "" })),
      );
    },
    [request, token],
  );

  /** 打开某个孩子的对话：复用最近一条，没有就新建，避免每次进来都堆会话。 */
  const openConversation = useCallback(
    async (childId: string) => {
      setError("");
      setNotice("");
      setMessages([]);
      setConversationId("");
      try {
        const list = await request(`/api/tutor/conversations?child_id=${encodeURIComponent(childId)}`, {}, token);
        const existing = Array.isArray(list?.conversations) ? list.conversations[0] : null;
        const conversation = existing
          ? existing
          : (
              await request(
                "/api/tutor/conversations",
                { method: "POST", body: JSON.stringify({ child_id: childId, persona: "child_tutor" }) },
                token,
              )
            )?.conversation;
        if (!conversation?.id) throw new Error("无法打开对话");
        await loadConversation(conversation.id);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [loadConversation, request, token],
  );

  useEffect(() => {
    if (selectedChildId) void openConversation(selectedChildId);
  }, [selectedChildId, openConversation]);

  async function startNewConversation() {
    if (!selectedChildId) return;
    setError("");
    setNotice("");
    try {
      const data = await request(
        "/api/tutor/conversations",
        { method: "POST", body: JSON.stringify({ child_id: selectedChildId, persona: "child_tutor" }) },
        token,
      );
      if (!data?.conversation?.id) throw new Error("无法新建对话");
      await loadConversation(data.conversation.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function uploadImage(file: File) {
    if (!conversationId) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const data = await request(
        `/api/tutor/conversations/${conversationId}/attachments`,
        { method: "POST", body: form },
        token,
      );
      if (data?.objectKey) setAttachments((current) => [...current, data.objectKey]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /**
   * 发一条消息。抽成独立函数是因为语音连续对话要绕过输入框直接发送，
   * 但它必须走和打字完全一样的链路：同样的流式、同样的配额、同样的证据边界。
   */
  const sendText = useCallback(
    async (rawText: string, extraAttachments: string[] = []) => {
      const text = rawText.trim();
      if (!conversationId || busyRef.current) return;
      if (!text && !extraAttachments.length) return;

      // 孩子开始打新问题了：上一条还没念完的先停掉，别等他问完了喇叭还在念旧题。
      // "这一轮别念"的标记保持清空——问的是新问题，按开关正常出声。
      stopAllSpeechRef.current();
      speechCutRef.current = false;

      const userMessage: Message = { id: `local-${Date.now()}`, role: "user", content: text || "（图片）" };
      const assistantId = `stream-${Date.now()}`;
      setMessages((current) => [
        ...current,
        userMessage,
        { id: assistantId, role: "assistant", content: "", pending: true },
      ]);
      setInput("");
      setAttachments([]);
      busyRef.current = true;
      setBusy(true);
      setError("");
      setNotice("");

      const controller = new AbortController();
      abortRef.current = controller;
      let answer = "";
      let interrupted = false;
      let speechStreamed = false;

      try {
        await streamTutorMessage({
          apiBase,
          token,
          conversationId,
          text,
          attachments: extraAttachments,
          // 连续对话时让服务端把回答按句念出来
          speak: autoReadRef.current && voiceStatusRef.current.tts,
          signal: controller.signal,
          onEvent: (event: TutorStreamEvent) => {
            if (event.type === "text") {
              answer += event.delta;
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId ? { ...message, content: message.content + event.delta, pending: true } : message,
                ),
              );
            } else if (event.type === "tool") {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, toolNote: event.ok ? "已读取孩子的学习记录" : "有一项信息没读到" }
                    : message,
                ),
              );
            } else if (event.type === "replace") {
              setNotice(`有一段内容被替换了：${event.reason}`);
            } else if (event.type === "speech") {
              // 边到边念：文本已经先一步出现在屏幕上，不等整段合成完。
              // 注意 speechStreamed 要无条件置上：服务端已经按句合成了，
              // 收尾时就不该再整段念一遍——包括恰好在这一句上被孩子喊停的情况。
              speechStreamed = true;
              if (maySpeakAutomatically()) enqueueSpeechRef.current(event.chunk, event.format);
            } else if (event.type === "speech_error") {
              setNotice(event.message);
            } else if (event.type === "interrupted") {
              interrupted = true;
              setNotice("你插话了，私教停下了。说说你想问什么。");
            } else if (event.type === "error") {
              setError(event.message);
              setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
            } else if (event.type === "done") {
              setQuotaLeft(event.quotaLeft);
            }
          },
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        busyRef.current = false;
        setBusy(false);
        abortRef.current = null;
        setMessages((current) =>
          current.map((message) => (message.id === assistantId ? { ...message, pending: false } : message)),
        );
        // 自动朗读放在最后：先让孩子看到字，再听到声音，避免声音先于内容出现
        // 服务端没做按句合成（例如语音未开通）时才退回整段朗读，免得念两遍
        if (answer.trim() && maySpeakAutomatically() && !interrupted && !speechStreamed) {
          void speakRef.current(answer, assistantId);
        }
        // 收尾了再叫醒排队等着的那几句插话
        idleWaitersRef.current.splice(0).forEach((resolve) => resolve());
        const queued = pendingSpeechRef.current.shift();
        if (queued) void sendRef.current(queued);
      }
    },
    [apiBase, conversationId, token],
  );

  useEffect(() => {
    sendRef.current = sendText;
  }, [sendText]);

  function stop() {
    abortRef.current?.abort();
    busyRef.current = false;
    setBusy(false);
    // 按下"停止"就是不想再听了：别再把这半截回答念出来
    cutSpeech();
  }

  /**
   * 按住说话：录音 → 识别 → 填进输入框。
   * 识别结果先落到输入框而不是直接发，是因为儿童语音识别准确率不如成人，
   * 让孩子（或家长）看一眼再发，比答错题强。
   */
  async function startRecording() {
    if (recording || recorderRef.current) return;
    // 他要开口说话了：先把喇叭掐掉，别让私教的声音盖着他，
    // 也别让没念完的那半句混进麦克风里被当成他在说。
    cutSpeech();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        if (pressTimerRef.current !== null) {
          window.clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
        }
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        const form = new FormData();
        form.append("file", blob, "voice.webm");
        try {
          const data = await request("/api/tutor/voice/transcribe", { method: "POST", body: form }, token);
          if (data?.text) setInput((current) => (current ? `${current} ${data.text}` : data.text));
        } catch (err) {
          setError((err as Error).message);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      // 手感兜底：万一抬起事件没触发（切后台、来电），最多录 60 秒就自己停
      pressTimerRef.current = window.setTimeout(() => recorderRef.current?.stop(), 60_000);
    } catch {
      setError("没有拿到麦克风权限，检查手机的授权设置。");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  async function saveEvidence() {
    if (!conversationId) return;
    try {
      const data = await request(
        `/api/tutor/conversations/${conversationId}/evidence`,
        { method: "POST", body: JSON.stringify({}) },
        token,
      );
      setNotice(
        data?.skipped ? "这次的情况已经记录过了" : "已记入孩子的成长记录，等你在「孩子状态」里确认后生效。",
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** 打印讲义：带着登录态把服务端排好版的 HTML 取回来，在新窗口打开后由用户打印或存 PDF。 */
  async function printWorksheet() {
    if (!conversationId) return;
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/tutor/conversations/${conversationId}/worksheet`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`讲义生成失败（${response.status}）`);
      const html = await response.text();
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      const opened = window.open(url, "_blank");
      if (!opened) {
        setNotice("浏览器拦截了新窗口，请允许弹出窗口后再试一次。");
        return;
      }
      setNotice("讲义已在新窗口打开，可以直接打印或存成 PDF。");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const selectedChild = useMemo(
    () => children.find((child) => child.id === selectedChildId),
    [children, selectedChildId],
  );

  /** 模型没配好 / 出错 / 被替换 这几条提示，浮窗和整页共用一份。 */
  const alerts = (
    <>
      {status && !status.model_configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          私教还没配置模型密钥，暂时不能对话。
        </div>
      )}
      {error && <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-accent">{error}</div>}
      {notice && <div className="rounded-xl border border-teal/20 bg-teal/5 px-4 py-3 text-sm text-teal">{notice}</div>}
    </>
  );

  if (status && !status.enabled) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <p className="text-sm text-muted">管理员开启后，这里就可以和孩子的 AI 私教对话了。</p>
      </div>
    );
  }

  /** 点关闭时的二次确认：实时对话和文本对话两个页面共用同一个。 */
  const confirmOverlay = confirmClose ? (
    <div
      data-testid="tutor-exit-confirm"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="退出私教确认"
    >
      <div className="w-full max-w-xs rounded-2xl border border-line bg-panel p-5 shadow-2xl">
        <p className="text-center text-base font-bold text-ink">要退出私教吗？</p>
        <p className="mt-2 text-center text-xs leading-5 text-muted">
          这次对话会保留，下次进来接着聊。
        </p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => setConfirmClose(false)}
            className="flex-1 rounded-xl border border-line py-2.5 text-sm font-bold text-ink-soft"
          >
            再想想
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmClose(false);
              onClose?.();
            }}
            aria-label="确认退出"
            className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-bold text-white"
          >
            退出
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // 实时对话：整个私教窗口换成全屏的"听/说"界面。
  // 孩子在这里不看键盘，也不打任何一个字，全靠画面和声音判断轮到谁了。
  if (voice.continuous) {
    const speaking = voice.speaking;
    const userSpeaking = voice.loopState === "speech";
    const thinking = voice.loopState === "transcribing";
    const statusText = speaking
      ? "我在讲，先听我说完"
      : LOOP_STATE_TEXT[voice.loopState] || "正在说话…";

    return (
      <div className="voice-live flex min-h-0 flex-1 flex-col" data-testid="voice-live">
        <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
          <button
            type="button"
            onClick={voice.toggleContinuous}
            aria-label="切换到文本对话"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-white/15 px-3.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/25 active:scale-95"
          >
            <MessageSquare size={15} />
            切换到文本对话
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onMinimize}
              aria-label="最小化私教"
              title="最小化，继续在后台运行"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25 active:scale-95"
            >
              <Minimize2 size={18} />
            </button>
            <button
              type="button"
              onClick={() => setConfirmClose(true)}
              aria-label="退出私教"
              title="退出私教"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25 active:scale-95"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6">
          <div
            className={`voice-orb-stage relative grid h-52 w-52 place-items-center ${
              speaking ? "is-tutor-speaking" : userSpeaking ? "is-user-speaking" : thinking ? "is-thinking" : "is-listening"
            }`}
          >
            <span aria-hidden="true" className="voice-halo absolute inset-0" />
            <span aria-hidden="true" className="voice-orbit voice-orbit-one" />
            <span aria-hidden="true" className="voice-orbit voice-orbit-two" />
            {(speaking || userSpeaking) && (
              <>
                <span className="voice-ring" />
                <span className="voice-ring" style={{ animationDelay: "0.8s" }} />
              </>
            )}
            <img
              src={TUTOR_ORB_ASSET}
              alt="禾芽语音私教"
              className="voice-figure relative h-40 w-40 object-contain"
            />
          </div>

          {/* 孩子开口时，人物下面一圈圈水波纹，表示"正在说话" */}
          {userSpeaking && (
            <div aria-hidden="true" data-testid="voice-ripples" className="voice-ripples">
              <span className="voice-ripple" />
              <span className="voice-ripple" style={{ animationDelay: "0.55s" }} />
              <span className="voice-ripple" style={{ animationDelay: "1.1s" }} />
            </div>
          )}

          <div className="relative mt-3 text-center text-white">
            <div className="text-lg font-black tracking-normal">{statusText}</div>
            <div className="mt-2 flex items-end justify-center gap-1" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((bar) => (
                <span key={bar} className="voice-level" style={{ animationDelay: `${bar * 0.12}s` }} />
              ))}
            </div>
          </div>
        </div>

        {/* 实时文字：纯对话，没有播放按钮，也没有输入框 */}
        <div
          ref={transcriptRef}
          data-testid="voice-transcript"
          className="relative z-10 max-h-[38%] shrink-0 overflow-y-auto border-t border-white/10 px-5 py-4 text-sm leading-6 text-white"
        >
          {messages.length === 0 ? (
            <p className="text-center text-white/55">直接说就行，说完停一下，我会接上</p>
          ) : (
            messages
              .filter((message) => message.content)
              .map((message) => (
                <p
                  key={message.id}
                  className={message.role === "user" ? "mt-2 text-right text-white/85" : "mt-2 text-left"}
                >
                  {message.content}
                </p>
              ))
          )}
          {busy && <p className="mt-2 text-left text-white/45">…</p>}
        </div>
        {confirmOverlay}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {children.length > 1 && (
        <div className="shrink-0 border-b border-line px-3 py-2">
          <ChildTabs children={children} activeChildId={selectedChildId} onChange={setSelectedChildId} />
        </div>
      )}

      <div className="shrink-0 space-y-2 px-3 pt-2">{alerts}</div>

      <Panel bare className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink">
            <Bot size={16} className="shrink-0 text-teal" />
            <div className="min-w-0">
              <div className="truncate">{selectedChild?.name ? `${selectedChild.name} 的私教` : "私教"}</div>
              <div className="truncate text-[10px] font-normal text-muted">记录需家长确认</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* 剩余条数只在快用完时提示，平时不占标题栏的地方 */}
            {quotaLeft !== null && quotaLeft <= 10 && <Badge tone="warn">今日剩余 {quotaLeft} 条</Badge>}
            <div className="relative">
              <button
                type="button"
                aria-label="更多操作"
                title="更多操作"
                aria-expanded={actionsOpen}
                onClick={() => setActionsOpen((current) => !current)}
                className="grid h-10 w-10 place-items-center rounded-lg border border-line text-ink-soft"
              >
                <MoreHorizontal size={18} />
              </button>
              {actionsOpen && (
                <>
                  <button
                    type="button"
                    aria-label="关闭菜单"
                    tabIndex={-1}
                    onClick={() => setActionsOpen(false)}
                    className="fixed inset-0 z-10 cursor-default"
                  />
                  <div
                    data-testid="tutor-dock-menu"
                    className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-[0_12px_32px_rgba(38,52,59,0.16)]"
                  >
                    {[
                      {
                        label: "记录这次情况",
                        icon: <BookmarkPlus size={15} />,
                        disabled: !conversationId || messages.length === 0,
                        run: saveEvidence,
                      },
                      {
                        label: "打印讲义",
                        icon: <Printer size={15} />,
                        disabled: !conversationId || messages.length === 0,
                        run: printWorksheet,
                      },
                      { label: "开新对话", icon: <Plus size={15} />, disabled: false, run: startNewConversation },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        disabled={item.disabled}
                        onClick={() => {
                          setActionsOpen(false);
                          item.run();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-bold text-ink-soft hover:bg-teal-soft disabled:opacity-40"
                      >
                        {item.icon}
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={onMinimize}
              aria-label="最小化私教"
              title="最小化，继续在后台运行"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-ink-soft transition hover:border-teal/40 hover:text-teal"
            >
              <Minimize2 size={17} />
            </button>
            <button
              type="button"
              onClick={() => setConfirmClose(true)}
              aria-label="退出私教"
              title="退出私教"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-ink-soft transition hover:border-accent/40 hover:text-accent"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {(voiceStatus.asr || voiceStatus.tts) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-cream/30 px-4 py-2 text-xs">
            {voiceStatus.asr && (
              <button
                type="button"
                onClick={voice.toggleContinuous}
                aria-label={voice.continuous ? "关闭连续对话" : "开启连续对话"}
                aria-pressed={voice.continuous}
                title="实时对话"
                className={`siri-toggle grid h-11 w-11 shrink-0 place-items-center rounded-full transition ${
                  voice.continuous ? "siri-toggle-active" : "bg-white/80 hover:bg-white"
                }`}
              >
                <AudioWaveform className="voice-entry-wave" size={23} strokeWidth={2.2} aria-hidden="true" />
              </button>
            )}
            {voiceStatus.tts && (
              <button
                type="button"
                role="switch"
                aria-checked={autoRead}
                onClick={() => {
                  const next = !autoReadRef.current;
                  // 立刻写进 ref：流式回来的下一句不该等到这次渲染提交才被拦住
                  autoReadRef.current = next;
                  setAutoRead(next);
                  if (next) {
                    // 重新打开就允许接着念
                    speechCutRef.current = false;
                  } else {
                    // 关掉就是当场闭嘴。开关说关了还在念，等于开关是假的。
                    cutSpeech();
                  }
                }}
                aria-label={autoRead ? "关闭自动朗读" : "开启自动朗读"}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white/70 pl-2.5 pr-1.5 font-bold text-ink-soft"
              >
                <Volume2 size={13} />
                <span>自动朗读</span>
                {/* 小开关：一眼看出开还是关，比两个不同颜色的按钮好认 */}
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition ${
                    autoRead ? "bg-teal" : "bg-line"
                  }`}
                >
                  <span
                    className="absolute h-3 w-3 rounded-full bg-white shadow transition-all"
                    style={{ left: autoRead ? "14px" : "2px" }}
                  />
                </span>
              </button>
            )}
            {voice.speaking && (
              <button
                type="button"
                // 这也是一次"我不想听了"：按完不能再自己接着念下一句
                onClick={cutSpeech}
                aria-label="停止朗读"
                className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-3 font-bold text-ink-soft"
              >
                <VolumeX size={13} /> 停一下
              </button>
            )}
          </div>
        )}

        <div
          ref={scrollRef}
          data-testid="tutor-scroll"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-cream/40 px-4 py-4 transition-colors"
        >
          {messages.length === 0 && (
            <p className="mx-auto max-w-md py-10 text-center text-sm leading-6 text-muted">{EMPTY_HINT}</p>
          )}
          {messages.map((message) => (
            <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}>
              {message.role === "assistant" && (
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal/10 text-teal">
                  <Bot size={16} />
                </span>
              )}
              <div
                className={`max-w-[min(100%,42rem)] rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user" ? "bg-teal text-white" : "border border-line bg-panel text-ink"
                }`}
              >
                {message.content ? (
                  splitParagraphs(message.content).map((paragraph, index) => (
                    <p key={index} className={index ? "mt-2" : ""}>
                      {paragraph}
                    </p>
                  ))
                ) : (
                  <span className="inline-flex items-center gap-2 text-muted">
                    <Loader2 size={14} className="animate-spin" />
                    正在想
                  </span>
                )}
                {message.pending && message.content && <Loader2 size={12} className="mt-2 animate-spin text-muted" />}
                {message.toolNote && <div className="mt-2 text-xs text-muted">{message.toolNote}</div>}
                {message.role === "assistant" && voiceStatus.tts && message.content && !message.pending && (
                  <button
                    type="button"
                    onClick={() => {
                      // 点「朗读」是明确要听：把"这一轮别再自动念"的标记松开，
                      // 免得刚点了朗读、后面几段却又被自己之前的按键拦住。
                      if (voice.speakingId !== message.id) speechCutRef.current = false;
                      void voice.speak(message.content, message.id);
                    }}
                    aria-label={voice.speakingId === message.id ? "停止朗读" : "朗读这段"}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-ink-soft hover:text-teal"
                  >
                    {voice.speakingId === message.id ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    {voice.speakingId === message.id ? "停止" : "朗读"}
                  </button>
                )}
              </div>
              {message.role === "user" && (
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold/20 text-teal-deep">
                  <User size={16} />
                </span>
              )}
            </div>
          ))}
        </div>

        {attachments.length > 0 && (
          <div className="border-t border-line px-4 py-2 text-xs text-muted">
            已选 {attachments.length} 张图片，发出去会一起识别。
          </div>
        )}

        <div className="flex items-end gap-2 border-t border-line px-3 py-3">
          <label
            title="插一张照片"
            className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-line text-ink-soft hover:text-teal"
          >
            <ImagePlus size={18} />
            <input
              type="file"
              accept="image/*"
              aria-label="插一张照片"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadImage(file);
                event.target.value = "";
              }}
            />
          </label>
          {voiceStatus.asr && (
            <button
              type="button"
              title="按住说话"
              aria-label="按住说话"
              aria-pressed={recording}
              onPointerDown={(event) => {
                event.preventDefault();
                void startRecording();
              }}
              onPointerUp={stopRecording}
              onPointerLeave={stopRecording}
              onPointerCancel={stopRecording}
              onKeyDown={(event) => {
                if (event.key === " " || event.key === "Enter") event.preventDefault();
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") stopRecording();
              }}
              onContextMenu={(event) => event.preventDefault()}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${
                recording ? "border-accent bg-accent text-white" : "border-line text-ink-soft hover:text-teal"
              } touch-none select-none`}
            >
              <Mic size={18} />
            </button>
          )}
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendText(input, attachments);
              }
            }}
            rows={1}
            placeholder="说说你卡在哪一步"
            className="min-h-10 flex-1 resize-none rounded-xl border border-line bg-panel px-3 py-2.5 text-sm outline-none focus:border-teal"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="停止"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-white"
            >
              <CircleStop size={18} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void sendText(input, attachments)}
              disabled={(!input.trim() && !attachments.length) || !conversationId}
              aria-label="发送"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal text-white disabled:opacity-40"
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </Panel>

      {confirmOverlay}
    </div>
  );
}
