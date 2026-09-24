/**
 * 连续 JSON 对象的流式解析。
 *
 * 语音合成大模型 HTTP 接口（/api/v3/tts/unidirectional）用 chunked 返回**一串 JSON 对象**，
 * 每个对象带一段 base64 音频；分片边界按字节切，可能切在一个 JSON 中间，
 * 也可能一次到货好几个对象。所以不能直接 JSON.parse 整个报文，也不能按行切。
 *
 * 做法：按大括号配对扫描（字符串与转义要跳过），凑齐一个完整对象就吐出来，
 * 剩下的留在缓冲区等下一片。
 */
export function createJsonObjectStream() {
    let buffer = "";
    const parseFailures = [];
    function drain() {
        const out = [];
        for (;;) {
            buffer = buffer.replace(/^[\s\u0000]+/, "");
            if (!buffer)
                break;
            let depth = 0;
            let inString = false;
            let escaped = false;
            let end = -1;
            let started = false;
            for (let i = 0; i < buffer.length; i += 1) {
                const ch = buffer[i];
                if (inString) {
                    if (escaped)
                        escaped = false;
                    else if (ch === "\\")
                        escaped = true;
                    else if (ch === '"')
                        inString = false;
                    continue;
                }
                if (ch === '"') {
                    inString = true;
                    continue;
                }
                if (ch === "{") {
                    depth += 1;
                    started = true;
                    continue;
                }
                if (ch === "}") {
                    depth -= 1;
                    if (started && depth === 0) {
                        end = i + 1;
                        break;
                    }
                    if (depth < 0) {
                        // 多余的反括号：丢掉这个字符，避免缓冲区永远卡死
                        buffer = buffer.slice(1);
                        end = -2;
                        break;
                    }
                }
            }
            if (end === -2)
                continue;
            if (end === -1)
                break; // 还没凑齐，等下一片
            const raw = buffer.slice(0, end);
            buffer = buffer.slice(end);
            try {
                out.push(JSON.parse(raw));
            }
            catch (error) {
                parseFailures.push(raw.slice(0, 120));
            }
        }
        return out;
    }
    return {
        push(chunk) {
            buffer += chunk;
            return drain();
        },
        flush() {
            const out = drain();
            // 结尾还残留半截对象说明上游被截断了，交给调用方按"没有音频"处理
            buffer = "";
            return out;
        },
        // 便于测试观察
        get failures() {
            return parseFailures;
        },
    };
}
