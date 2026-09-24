import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CircleStop, ImagePlus, Loader2, Mic, Plus, Printer, RefreshCw, Send, User } from "lucide-react";
import { Badge, ChildTabs, PageHeader, Panel } from "./Layout";
import { splitParagraphs, streamTutorMessage, type TutorStreamEvent } from "../lib/tutor";

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
};

const EMPTY_HINT = "拍一张错题照片，或者直接问一道题。我会先问你思路，不会直接给答案。";

/**
 * 内置学习私教对话页。
 * 与 WorkBuddy 接入共用同一份数据：这里聊出来的证据同样要家长确认后才生效。
 */
export default function TutorChat({ token, apiBase, children, request }: Props) {
  const [selectedChildId, setSelectedChildId] = useState(children[0]?.id || "");
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [status, setStatus] = useState<{ enabled: boolean; ready: boolean; model_configured: boolean } | null>(null);
  const [voice, setVoice] = useState<{ asr: boolean; tts: boolean }>({ asr: false, tts: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quotaLeft, setQuotaLeft] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

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
      .then((data) => setVoice({ asr: Boolean(data?.asr), tts: Boolean(data?.tts) }))
      .catch(() => setVoice({ asr: false, tts: false }));
  }, [token, request]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

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

  async function send() {
    const text = input.trim();
    if ((!text && !attachments.length) || !conversationId || busy) return;

    const userMessage: Message = { id: `local-${Date.now()}`, role: "user", content: text || "（图片）" };
    const assistantId = `stream-${Date.now()}`;
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "", pending: true }]);
    setInput("");
    const sentAttachments = attachments;
    setAttachments([]);
    setBusy(true);
    setError("");
    setNotice("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamTutorMessage({
        apiBase,
        token,
        conversationId,
        text,
        attachments: sentAttachments,
        signal: controller.signal,
        onEvent: (event: TutorStreamEvent) => {
          if (event.type === "text") {
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
      setBusy(false);
      abortRef.current = null;
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? { ...message, pending: false } : message)),
      );
    }
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  /** 按住说话：录音 → 识别 → 填进输入框，识别结果先确认再发送。 */
  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
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
    } catch {
      setError("没有拿到麦克风权限，检查手机的授权设置。");
    }
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

  if (status && !status.enabled) {
    return (
      <Panel title="学习私教" description="私教还没有开启。">
        <p className="text-sm text-muted">管理员开启后，这里就可以和孩子的 AI 私教对话了。</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="学习私教"
        description={
          selectedChild
            ? `正在和 ${selectedChild.name} 的私教对话。它会结合孩子的错题和掌握情况讲题，聊完的证据要你确认后才进成长记录。`
            : "结合孩子的错题和掌握情况讲题，讲完的证据要你确认后才进成长记录。"
        }
      />

      {children.length > 1 && (
        <ChildTabs children={children} activeChildId={selectedChildId} onChange={setSelectedChildId} />
      )}

      {status && !status.model_configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          私教还没配置模型密钥，暂时不能对话。
        </div>
      )}
      {error && <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-accent">{error}</div>}
      {notice && <div className="rounded-xl border border-teal/20 bg-teal/5 px-4 py-3 text-sm text-teal">{notice}</div>}

      <Panel className="flex min-h-[62vh] flex-col p-0">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-ink">
            <Bot size={16} className="text-teal" />
            {selectedChild?.name ? `${selectedChild.name} 的私教` : "私教"}
          </div>
          <div className="flex items-center gap-2">
            {quotaLeft !== null && <Badge tone="muted">今日剩余 {quotaLeft} 条</Badge>}
            <button
              type="button"
              onClick={saveEvidence}
              disabled={!conversationId || messages.length === 0}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-40"
            >
              记录这次情况
            </button>
            <button
              type="button"
              onClick={printWorksheet}
              disabled={!conversationId || messages.length === 0}
              aria-label="打印讲义"
              className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-40"
            >
              <Printer size={13} /> 打印讲义
            </button>
          </div>
        </div>

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
          <label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-line text-ink-soft hover:text-teal">
            <ImagePlus size={18} />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadImage(file);
                event.target.value = "";
              }}
            />
          </label>
          {voice.asr && (
            <button
              type="button"
              onClick={toggleRecording}
              aria-label={recording ? "停止录音" : "按住说话"}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${
                recording ? "border-accent bg-accent text-white" : "border-line text-ink-soft hover:text-teal"
              }`}
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
                void send();
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
              onClick={send}
              disabled={(!input.trim() && !attachments.length) || !conversationId}
              aria-label="发送"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal text-white disabled:opacity-40"
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <button
          type="button"
          onClick={() => selectedChildId && openConversation(selectedChildId)}
          className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 font-bold text-ink-soft"
        >
          <RefreshCw size={13} /> 重新载入
        </button>
        <button
          type="button"
          onClick={startNewConversation}
          className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 font-bold text-ink-soft"
        >
          <Plus size={13} /> 开新对话
        </button>
      </div>
    </div>
  );
}
