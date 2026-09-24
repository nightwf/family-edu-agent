import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  BookmarkPlus,
  CircleStop,
  ImagePlus,
  Loader2,
  Mic,
  MoreHorizontal,
  Plus,
  Printer,
  Radio,
  Send,
  User,
  Volume2,
  VolumeX,
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
  /** 挂在标题栏最右侧的额外内容（关掉浮窗的按钮）。 */
  headerExtra?: ReactNode;
};

const EMPTY_HINT = "拍一张错题照片，或者直接问一道题。我会先问你思路，不会直接给答案。";

const LOOP_STATE_TEXT: Record<string, string> = {
  idle: "点一下开始听",
  listening: "在听，直接说就行",
  speech: "听到了，继续说",
  transcribing: "正在识别…",
};

/**
 * 内置学习私教的对话主体，装在外层浮窗里。
 * 与 WorkBuddy 接入共用同一份数据：这里聊出来的证据同样要家长确认后才生效。
 */
export default function TutorChat({ token, apiBase, children, request, headerExtra }: Props) {
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
  const [autoRead, setAutoRead] = useState(true);
  /** 次要操作（记录/打印/新对话）按移动端惯例收进「更多」，标题栏才放得下孩子名字 */
  const [actionsOpen, setActionsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const autoReadRef = useRef(true);
  const voiceStatusRef = useRef(voiceStatus);
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
    autoReadRef.current = autoRead;
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
  const stopSpeechRef = useRef(voice.stopSpeech);
  stopSpeechRef.current = voice.stopSpeech;

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
    stopSpeechRef.current();
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
              // 边到边念：文本已经先一步出现在屏幕上，不等整段合成完
              speechStreamed = true;
              enqueueSpeechRef.current(event.chunk, event.format);
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
        if (answer.trim() && autoReadRef.current && !interrupted && !speechStreamed) {
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
  }

  /**
   * 按住说话：录音 → 识别 → 填进输入框。
   * 识别结果先落到输入框而不是直接发，是因为儿童语音识别准确率不如成人，
   * 让孩子（或家长）看一眼再发，比答错题强。
   */
  async function startRecording() {
    if (recording || recorderRef.current) return;
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

  return (
    <div className="flex h-full min-h-0 flex-col">
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
            {headerExtra}
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
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-bold ${
                  voice.continuous ? "border-teal bg-teal/10 text-teal" : "border-line text-ink-soft"
                }`}
              >
                <Radio size={13} /> 连续对话
              </button>
            )}
            {voiceStatus.tts && (
              <button
                type="button"
                onClick={() => setAutoRead((current) => !current)}
                aria-label={autoRead ? "关闭自动朗读" : "开启自动朗读"}
                aria-pressed={autoRead}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-bold ${
                  autoRead ? "border-teal bg-teal/10 text-teal" : "border-line text-ink-soft"
                }`}
              >
                <Volume2 size={13} /> 自动朗读
              </button>
            )}
            {voice.speaking && (
              <button
                type="button"
                onClick={voice.stopSpeech}
                aria-label="停止朗读"
                className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 font-bold text-ink-soft"
              >
                <VolumeX size={13} /> 停一下
              </button>
            )}
            {voice.continuous && <span className="text-muted">{LOOP_STATE_TEXT[voice.loopState] || ""}</span>}
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-cream/40 px-4 py-4">
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
                    onClick={() => void voice.speak(message.content, message.id)}
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

    </div>
  );
}
