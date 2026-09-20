/**
 * 回归测试：周计划任务类型等枚举字段必须能接受中文写法，非法取值必须报出全部合法值。
 *
 * 背景：WorkBuddy 曾因 create_weekly_plan 的 type 是未公开枚举、报错又不含合法值，
 * 连续试错上百次仍无法建立周计划。本脚本在真实服务上复现该场景并验证修复。
 *
 * 需要：
 *   MCP_SMOKE_TOKEN  专用测试家庭的 MCP Token
 *   BASE_URL         默认 https://heyaagent.top/family-edu
 *   SMOKE_SUFFIX     每周计划使用的唯一后缀，避免重复
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.env.BASE_URL || "https://heyaagent.top/family-edu";
const token = process.env.MCP_SMOKE_TOKEN;
const suffix = process.env.SMOKE_SUFFIX || String(Date.now());

if (!token) {
  console.log("plan enum smoke test skipped: MCP_SMOKE_TOKEN is not set");
  process.exit(0);
}

const client = new Client({ name: "family-edu-plan-enum-smoke", version: "1.0.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers: { "X-MCP-Token": token } },
});

function check(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    return;
  }
  throw new Error(`  ✗ ${message}`);
}

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args || {} });
  const text = (result.content || []).map((item) => item.text).join("");
  return { isError: Boolean(result.isError), text };
}

try {
  await client.connect(transport);

  const spec = await call("get_sync_spec");
  check(spec.text.includes('"version": "2.5"'), "同步规范版本为 2.5");
  check(spec.text.includes("plan_item_type"), "同步规范包含计划任务类型枚举");
  check(spec.text.includes("学校作业"), "同步规范带中文取值说明");

  const children = JSON.parse((await call("list_children")).text);
  const child = children[0];
  check(Boolean(child?.id), "测试家庭存在学生档案");

  const proposed = await call("propose_stage_goals", {
    child_id: child.id,
    goals: [
      {
        title: `枚举回归 ${suffix}`,
        objective: "验证周计划任务类型写入",
        criteria: { pass: "独立答对 3 题" },
        start_date: "2026-09-20",
        end_date: "2026-10-18",
      },
      {
        title: `枚举回归备选 ${suffix}`,
        objective: "验证候选目标写回数量要求",
        criteria: { pass: "完成 2 次复测" },
        start_date: "2026-09-20",
        end_date: "2026-10-18",
      },
    ],
  });
  const parsed = JSON.parse(proposed.text);
  const first = Array.isArray(parsed) ? parsed[0] : (parsed.items ? parsed.items[0] : parsed[0]);
  check(Boolean(first?.id), "候选阶段目标已写回");
  await call("confirm_stage_goal", { goal_id: first.id, action: "confirm" });

  const created = await call("create_weekly_plan", {
    goal_id: first.id,
    week_start: `2026-09-${21 + (Number(suffix) % 5)}`,
    items: [
      { type: "学校作业", title: `数学练习册 ${suffix}` },
      { type: "复测", title: `延迟复测 ${suffix}` },
      { type: "AI任务", title: `生成变式题 ${suffix}`, estimated_minutes: 10 },
    ],
  });
  check(!created.isError, "中文任务类型可以创建周计划");
  const plan = JSON.parse(created.text);
  const types = (plan.items || []).map((item) => item.type);
  check(types.includes("SCHOOL_HOMEWORK") && types.includes("RETEST") && types.includes("AGENT_TASK"), "中文类型被归一化为枚举键");

  const rejected = await call("create_weekly_plan", {
    goal_id: first.id,
    week_start: `2026-10-0${1 + (Number(suffix) % 6)}`,
    items: [{ type: "布鲁姆-记忆层", title: "非法类型" }],
  });
  check(rejected.isError, "非法任务类型被拒绝");
  check(rejected.text.includes("SCHOOL_HOMEWORK") && rejected.text.includes("学校作业"), "报错列出全部合法取值");
  check(rejected.text.includes("中文名称"), "报错说明可以使用中文");
  console.log("\n非法取值返回给调用方的提示：\n  " + rejected.text.replace(/\s+/g, " ").trim());

  console.log("\n周计划枚举回归测试通过");
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
