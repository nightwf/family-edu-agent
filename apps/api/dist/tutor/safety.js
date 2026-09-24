import { prisma } from "../prisma.js";
import { env } from "../env.js";
const MAX_INPUT_LENGTH = 2000;
/** 命中即拦截的规则。只列明确有害且不该由私教回应的类别。 */
const BLOCK_PATTERNS = [
    { pattern: /(自杀|自残|不想活|割腕)/, reason: "自伤相关表达" },
    { pattern: /(怎么(做|弄|造)(炸弹|炸药|枪)|制作(炸弹|毒品))/, reason: "危险行为" },
    { pattern: /(色情|裸照|性行为细节)/, reason: "不当内容" },
    { pattern: /(加我微信|我把(微信|电话|地址|身份证)号?发你)/, reason: "索要联系方式或个人信息" },
];
/** 说教式、羞辱式表达：不作为拦截，但要替换。 */
const DISCOURAGE_PATTERNS = [
    {
        // 拿别的孩子做对照，或直接贬低孩子。这类表达对孩子的伤害是确定的，一律替换。
        pattern: /(你怎么这么(笨|蠢)|真没出息|太让我失望|不如别人|别人家的(孩子|娃)|隔壁.{0,4}(孩子|小明|小红|都)|比(你|隔壁|同学))/,
        reason: "羞辱或比较式表达",
    },
];
const CHILD_SAFE_REPLY = "这个我帮不上忙，我们换个方向试试。你想先说说现在卡在哪一步吗？";
export function scanInput(rawText) {
    const text = (rawText || "").trim();
    if (!text)
        return { ok: false, reason: "消息不能为空", action: "blocked" };
    if (text.length > MAX_INPUT_LENGTH) {
        return { ok: false, reason: `消息过长（上限 ${MAX_INPUT_LENGTH} 字）`, action: "blocked" };
    }
    for (const rule of BLOCK_PATTERNS) {
        if (rule.pattern.test(text)) {
            return { ok: false, reason: rule.reason, action: "blocked" };
        }
    }
    return { ok: true, action: "pass" };
}
export function scanOutput(rawText) {
    const text = rawText || "";
    if (!text.trim())
        return { ok: true, action: "pass", text };
    for (const rule of BLOCK_PATTERNS) {
        if (rule.pattern.test(text)) {
            return { ok: false, reason: rule.reason, action: "replaced", text: CHILD_SAFE_REPLY };
        }
    }
    for (const rule of DISCOURAGE_PATTERNS) {
        if (rule.pattern.test(text)) {
            return { ok: false, reason: rule.reason, action: "replaced", text: CHILD_SAFE_REPLY };
        }
    }
    return { ok: true, action: "pass", text };
}
/**
 * 结构化引用校验：回答里引用的错题/题目必须属于本家庭。
 * 模型可能被诱导引用别家数据，这一步是最后一道闸。
 * 返回 false 表示应当把这条回答降级为纯文本。
 */
export async function validateReferences(familyId, refs) {
    const wrongIds = [...new Set((refs.wrongQuestionIds || []).filter(Boolean))];
    const questionIds = [...new Set((refs.questionIds || []).filter(Boolean))];
    if (!wrongIds.length && !questionIds.length)
        return { ok: true };
    if (wrongIds.length) {
        const found = await prisma.wrongQuestionEntry.count({ where: { familyId, id: { in: wrongIds } } });
        if (found !== wrongIds.length)
            return { ok: false, reason: "引用了不属于本家庭的错题" };
    }
    if (questionIds.length) {
        const found = await prisma.question.count({ where: { familyId, id: { in: questionIds } } });
        if (found !== questionIds.length)
            return { ok: false, reason: "引用了不属于本家庭的题目" };
    }
    return { ok: true };
}
/** 记录安全事件，家长可见。写库失败不应影响主流程。 */
export async function recordSafetyEvent(input) {
    try {
        await prisma.tutorSafetyEvent.create({
            data: {
                familyId: input.familyId,
                childId: input.childId || null,
                conversationId: input.conversationId || null,
                stage: input.stage,
                reason: input.reason,
                excerpt: input.excerpt ? input.excerpt.slice(0, 200) : null,
                action: input.action,
            },
        });
    }
    catch {
        // 审计失败不阻断对话
    }
}
export function moderationConfigured() {
    return env.TUTOR_MODERATION_ENABLED;
}
