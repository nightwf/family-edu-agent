/**
 * SSE 增量解析。服务端（apps/api/src/tutor/routes.ts 的 sseWrite）按
 * `event: <name>\ndata: <json>\n\n` 输出，网络分块不保证按事件边界切，
 * 所以必须做缓冲，不能假设"一个 chunk 就是一个事件"。
 *
 * 抽成独立模块是为了能被真测到：内联在验证脚本里没法单测。
 */

/** 创建一个流式收集器。push 返回本次能解析出的完整事件。 */
export function createSseParser() {
  let buffer = "";

  return {
    push(chunk) {
      buffer += chunk;
      const events = [];
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        let event = "message";
        const dataLines = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          // 只切掉 "data:" 后的一个空格，保留值里的其余空白
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (dataLines.length) events.push({ event, data: dataLines.join("\n") });
      }
      return events;
    },
    /** 流结束时若还有残留（服务端没补空行），也按一个事件处理。 */
    flush() {
      const rest = buffer.trim();
      buffer = "";
      if (!rest) return [];
      let event = "message";
      const dataLines = [];
      for (const line of rest.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      return dataLines.length ? [{ event, data: dataLines.join("\n") }] : [];
    },
  };
}

/**
 * 把一轮对话的 SSE 事件汇总成可读结论。
 * 只读它真的看到的东西，不做"没报错就算成功"的推断。
 */
export function summarizeRoundTrip(events) {
  const summary = { events: {}, textLength: 0, preview: "", toolCalls: [], errors: [] };

  for (const { event, data } of events) {
    summary.events[event] = (summary.events[event] || 0) + 1;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    if (event === "text") {
      const delta = String(parsed?.delta ?? parsed?.text ?? "");
      summary.textLength += delta.length;
      if (summary.preview.length < 120) summary.preview += delta;
    } else if (event === "tool" || event === "tool_call" || event === "tool_result") {
      // 服务端用的是 `tool`（routes.ts: sseWrite(reply, "tool", { name, ok })）；
      // tool_call / tool_result 是兼容旧写法，别因为改名就漏统计。
      summary.toolCalls.push(`${parsed?.name || "?"}${parsed?.ok === false ? "(失败)" : ""}`);
    } else if (event === "error") {
      // 上游原文在 detail 里，只用于排查，不当可读提示
      summary.errors.push(`${parsed?.message || "未知错误"}${parsed?.detail ? ` | detail: ${String(parsed.detail).slice(0, 120)}` : ""}`);
    }
  }

  summary.preview = summary.preview.slice(0, 120);
  return summary;
}
