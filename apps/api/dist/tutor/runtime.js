import { env } from "../env.js";
import { recordSafetyEvent, scanInput, scanOutput, validateReferences } from "./safety.js";
import { normalizePersona } from "./tool-policy.js";
function withTimeout(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
/** 把模型请求的工具调用参数解析成对象；解析失败按空对象处理并计入审计。 */
function parseArguments(raw) {
    try {
        return JSON.parse(raw || "{}");
    }
    catch {
        return {};
    }
}
export async function* runTutorTurn(input) {
    const maxRounds = input.maxToolRounds ?? env.TUTOR_MAX_TOOL_ROUNDS;
    const timeoutMs = input.timeoutMs ?? env.TUTOR_REQUEST_TIMEOUT_MS;
    const persona = normalizePersona(input.persona);
    // L1 输入侧
    const verdict = scanInput(input.userMessage);
    if (!verdict.ok) {
        await recordSafetyEvent({
            familyId: input.familyId,
            childId: input.childId,
            conversationId: input.conversationId,
            stage: "input",
            reason: verdict.reason || "输入被拦截",
            excerpt: input.userMessage,
            action: "blocked",
        });
        yield { type: "error", message: verdict.reason || "这条消息我不能处理", retryable: false };
        return;
    }
    const userContent = input.images?.length
        ? [
            { type: "text", text: input.userMessage },
            ...input.images.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
        : input.userMessage;
    const messages = [
        { role: "system", content: input.systemPrompt },
        ...input.history,
        { role: "user", content: userContent },
    ];
    const tools = input.toolset.schemas.length ? input.toolset.schemas : undefined;
    const executed = [];
    const wrongQuestionIds = [];
    const questionIds = [];
    let answerText = "";
    let usage = { promptTokens: 0, completionTokens: 0 };
    let rounds = 0;
    while (rounds <= maxRounds) {
        const guard = withTimeout(timeoutMs);
        const calls = [];
        let roundText = "";
        let failed = false;
        try {
            for await (const event of input.provider.streamChat({ model: input.model, messages, tools, temperature: 0.4 }, guard.signal)) {
                if (event.type === "text") {
                    roundText += event.delta;
                    answerText += event.delta;
                    yield { type: "text", delta: event.delta };
                }
                else if (event.type === "tool_call") {
                    calls.push({ id: event.id, name: event.name, arguments: event.arguments });
                }
                else if (event.type === "done") {
                    usage = {
                        promptTokens: usage.promptTokens + (event.usage?.promptTokens || 0),
                        completionTokens: usage.completionTokens + (event.usage?.completionTokens || 0),
                    };
                }
                else if (event.type === "error") {
                    failed = true;
                    yield { type: "error", message: event.message, retryable: event.retryable };
                }
            }
        }
        finally {
            guard.clear();
        }
        if (failed)
            return;
        if (!calls.length)
            break;
        // 把模型的工具请求与本轮文本回灌，形成完整的 assistant 轮次
        messages.push({
            role: "assistant",
            content: roundText,
            toolCalls: calls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
        });
        for (const call of calls) {
            const args = parseArguments(call.arguments);
            const result = await input.toolset.callTool(call.name, args);
            executed.push({ name: call.name, ok: !result.isError });
            yield { type: "tool", name: call.name, ok: !result.isError };
            // 收集引用，供 L3 校验
            const asRecord = (args || {});
            if (typeof asRecord.wrong_question_id === "string")
                wrongQuestionIds.push(asRecord.wrong_question_id);
            if (typeof asRecord.question_id === "string")
                questionIds.push(asRecord.question_id);
            messages.push({
                role: "tool",
                content: result.text,
                toolCallId: call.id,
                name: call.name,
            });
        }
        rounds += 1;
        if (rounds > maxRounds) {
            // 超限：停止调用工具，要求模型基于已有信息收尾
            messages.push({
                role: "user",
                content: "已经查得够多了，请直接用现在掌握的信息给出回答，不要再调用工具。",
            });
        }
    }
    // L3 输出侧
    const output = scanOutput(answerText);
    if (!output.ok) {
        await recordSafetyEvent({
            familyId: input.familyId,
            childId: input.childId,
            conversationId: input.conversationId,
            stage: "output",
            reason: output.reason || "输出被替换",
            excerpt: answerText,
            action: output.action,
        });
        yield { type: "replace", reason: output.reason || "内容不合适" };
    }
    const refs = await validateReferences(input.familyId, { wrongQuestionIds, questionIds });
    if (!refs.ok) {
        await recordSafetyEvent({
            familyId: input.familyId,
            childId: input.childId,
            conversationId: input.conversationId,
            stage: "output",
            reason: refs.reason || "引用校验失败",
            excerpt: answerText,
            action: "logged",
        });
        yield { type: "replace", reason: refs.reason || "引用校验失败" };
    }
    yield { type: "done", usage, toolCalls: executed };
}
