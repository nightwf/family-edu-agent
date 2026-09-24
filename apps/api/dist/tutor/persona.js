import { prisma } from "../prisma.js";
import { getEffectiveSkill } from "../personalization.js";
const SKILL_EXCERPT_LIMIT = 3000;
/** 性别对应的称呼，避免用"他/她"写错。 */
function genderNoun(gender) {
    if (gender === "female")
        return "女孩";
    if (gender === "male")
        return "男孩";
    return "";
}
/**
 * 硬规则（L2 教学策略）：写在提示词最前面，优先级高于模型自由发挥。
 * 这些是产品本身，不托管给任何第三方。
 */
export function teachingRules(persona) {
    const shared = [
        "不直接给答案：先问孩子怎么想的，给提示，让他自己算；连续两次卡住才逐步给步骤。",
        "一次只教一个点，讲完给一道同类小题验证是否真的懂了。",
        "语气和严格程度服从下方设置，不用羞辱、比较、威胁的说法。",
        "不确定就说不确定。不编造孩子的记录；讲题必须引用真实存在的错题或题目。",
        // 会话在创建时就钉死了一个孩子，工具也只给这个孩子的数据。
        // 问到兄弟姐妹时要明确收回，否则孩子会以为"私教知道全家人"，
        // 而实际上它既看不到、也不该拿别家数据来比较。
        "这次对话只针对当前这个孩子：问到兄弟姐妹或家里其他孩子时，说明你只了解眼前这一个，把话题带回来；不要拿别的孩子做比较。",
        "超出学科与陪伴范围的话题，温和收回。",
    ];
    if (persona === "parent_coach") {
        return [
            ...shared,
            "面向家长时给可执行的动作与话术，不只讲道理；引用数据要指明来源记录。",
        ];
    }
    return shared;
}
/** 纯渲染：给定输入产出系统提示词，便于单测覆盖。 */
export function renderTutorPrompt(input) {
    const { persona, settings } = input;
    const who = persona === "parent_coach" ? "家长" : "孩子";
    const lines = [];
    lines.push(`你是禾芽家庭 AI 私教，现在面对的是${who}。`);
    lines.push("");
    lines.push("## 当前对象");
    lines.push(`- 孩子：${input.childName || "未指定"}`);
    if (input.grade)
        lines.push(`- 年级：${input.grade}`);
    const noun = genderNoun(input.gender);
    if (noun)
        lines.push(`- 称呼：${noun}`);
    lines.push("");
    lines.push("## 教学硬规则（优先级最高）");
    teachingRules(persona).forEach((rule, index) => lines.push(`${index + 1}. ${rule}`));
    lines.push("");
    lines.push("## 教育方式（由家庭设置实时决定，请严格遵守）");
    lines.push(`- 教育理念：${settings.philosophy || "引导和鼓励为主（默认）"}`);
    lines.push(`- 沟通风格：${settings.communicationStyle || "温和、清晰（默认）"}`);
    lines.push(`- 严格程度：${settings.strictness || "适中（默认）"}`);
    lines.push(`- 家长目标：${settings.parentGoals?.length ? settings.parentGoals.join("；") : "未设置"}`);
    if (settings.childNotes)
        lines.push(`- 这个孩子的学习特点：${settings.childNotes}`);
    lines.push(`- 配置来源：${input.resolution === "child" ? "孩子个体设置" : input.resolution === "family" ? "家庭设置" : "系统默认"}`);
    lines.push("");
    if (input.recommendedMethods?.length) {
        lines.push("## 适配这个孩子的教育方法");
        for (const method of input.recommendedMethods.slice(0, 6)) {
            lines.push(`- ${method.name || "未命名"}${method.category ? `（${method.category}）` : ""}`);
        }
        lines.push("");
    }
    if (input.skillExcerpt) {
        lines.push("## 方法论参考");
        lines.push(input.skillExcerpt.slice(0, SKILL_EXCERPT_LIMIT));
        lines.push("");
    }
    lines.push("## 输出要求");
    lines.push("- 用孩子听得懂的话讲，一次别堆太多信息。");
    lines.push("- 需要引用错题或数据时，只用工具返回的真实内容。");
    if (persona !== "parent_coach") {
        lines.push("- 结尾用一个短问题把主动权交回孩子，而不是替他做完。");
    }
    return lines.join("\n");
}
/** 取数 + 渲染。skill 选与场景最贴近的一个，做法仍以家庭设置为准。 */
export async function buildTutorPersona(options) {
    const { familyId, persona, childId } = options;
    const [family, child] = await Promise.all([
        prisma.family.findUnique({ where: { id: familyId } }),
        childId ? prisma.child.findFirst({ where: { id: childId, familyId } }) : Promise.resolve(null),
    ]);
    const skillId = persona === "parent_coach" ? "parent-coach" : "growth-analysis";
    const effective = await getEffectiveSkill(familyId, skillId, childId || undefined).catch(() => null);
    const resolved = effective?.resolved_settings;
    const childProfile = effective?.child_profile;
    return renderTutorPrompt({
        persona,
        childName: child?.name || null,
        grade: child?.grade || null,
        gender: child?.gender || null,
        settings: {
            philosophy: resolved?.philosophy || family?.educationPhilosophy || null,
            communicationStyle: resolved?.communicationStyle || family?.communicationStyle || null,
            strictness: resolved?.strictness || family?.strictness || null,
            parentGoals: resolved?.parentGoals?.length ? resolved.parentGoals : family?.parentGoals || null,
            childNotes: childProfile?.notes || null,
        },
        resolution: effective?.resolution,
        recommendedMethods: effective?.recommended_methods || [],
        skillExcerpt: effective?.skill?.content || null,
    });
}
