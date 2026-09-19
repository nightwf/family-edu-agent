/**
 * 学习决策层的真实链路冒烟测试：教材知识点 → 题型关联 → 错题作答 → 自动算出的学习优先级。
 *
 * 需要：
 *   MCP_SMOKE_TOKEN  一个专用测试家庭的 MCP Token
 *   BASE_URL         默认 https://heyaagent.top/family-edu
 *   SMOKE_SUFFIX     每次运行使用的唯一后缀，避免与历史数据冲突
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.env.BASE_URL || "https://heyaagent.top/family-edu";
const token = process.env.MCP_SMOKE_TOKEN;
const suffix = process.env.SMOKE_SUFFIX || String(Date.now());

if (!token) {
  console.log("learning engine smoke test skipped: MCP_SMOKE_TOKEN is not set");
  process.exit(0);
}

const client = new Client({ name: "family-edu-learning-smoke", version: "1.0.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers: { "X-MCP-Token": token } },
});

function payload(result) {
  const text = result.content?.find((item) => item.type === "text")?.text || "{}";
  if (result.isError) throw new Error(`tool error: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function call(name, args) {
  return payload(await client.callTool({ name, arguments: args || {} }));
}

function check(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    return;
  }
  throw new Error(`  ✗ ${message}`);
}

try {
  await client.connect(transport);

  const children = await call("list_children");
  const child = children[0];
  check(Boolean(child?.id), "测试家庭存在学生档案");

  const source = await call("import_source_document", {
    title: `冒烟教材 ${suffix}`,
    kind: "textbook",
    subject: "数学",
    grade: "三年级",
    nodes: [],
  });
  const sourceId = source.id || source.source_document_id;
  check(Boolean(sourceId), "教材来源文档已入库");

  const nodes = await call("save_knowledge_nodes_batch", {
    source_document_id: sourceId,
    nodes: [
      { type: "KNOWLEDGE_POINT", title: `部分量与总量 ${suffix}`, subject: "数学", grade: "三年级" },
      { type: "KNOWLEDGE_POINT", title: `看图列式综合 ${suffix}`, subject: "数学", grade: "三年级" },
    ],
  });
  check(Array.isArray(nodes) && nodes.length === 2, "两个知识节点写入成功");
  const [prerequisiteNode, dependentNode] = nodes;

  await call("save_knowledge_relations_batch", {
    source_document_id: sourceId,
    relations: [{
      prerequisite_title: prerequisiteNode.title,
      dependent_title: dependentNode.title,
      relation_type: "PREREQUISITE_OF",
      strength: "hard",
      reason: "先分清部分量与总量，才能完成看图列式",
    }],
  });
  check(true, "前置知识关系已保存");

  const questionType = await call("create_question_type", {
    subject: "数学",
    grade: "三年级",
    name: `看图列式 ${suffix}`,
    knowledge_points: [`部分量与总量 ${suffix}`],
  });
  check(Boolean(questionType.id), "题型创建成功");

  const links = await call("link_question_type_knowledge", {
    question_type_id: questionType.id,
    links: [
      { knowledge_node_id: prerequisiteNode.id },
      { knowledge_node_id: dependentNode.id },
    ],
  });
  check(Array.isArray(links) && links.length === 2, "题型已关联到知识节点");

  const question = await call("save_question", {
    question_type_id: questionType.id,
    stem: "看图写出总量算式",
    format: "calculation",
    answer: "3+4",
    difficulty: "basic",
  });
  check(question.verificationStatus === "verified" || question.verification_status === "verified", "计算题保存后自动完成答案验证");

  const verification = await call("verify_question_answer", { question_id: question.id });
  check(verification.verification?.status === "verified", "重新验证答案返回 verified");

  for (const attemptIndex of [1, 2, 3]) {
    await call("record_question_attempt", {
      child_id: child.id,
      question_id: question.id,
      student_answer: "3-4",
      is_correct: false,
      error_reason: "混淆总量与部分量",
      used_hint: false,
      save_to_wrong_book: true,
      attempted_at: new Date(Date.now() - (4 - attemptIndex) * 3_600_000).toISOString(),
    });
  }
  check(true, "三次错误作答写入成功");

  const knowledgeContext = await call("get_knowledge_context", {
    child_id: child.id,
    knowledge_node_id: prerequisiteNode.id,
  });
  check(Boolean(knowledgeContext.childState), "作答后知识点掌握状态已自动写入");
  check(knowledgeContext.childState.status === "LEARNING", "知识点状态反映真实作答结果");
  check(Boolean(knowledgeContext.childState.nextReviewAt), "知识点状态带上了下次复习时间");

  const priorities = await call("get_learning_priorities", { child_id: child.id, limit: 5 });
  check(priorities.priorities.length > 0, "根据真实作答算出了学习优先级");
  const types = priorities.priorities.map((item) => item.type);
  check(types.includes("REPEATED_ERROR"), "重复出错被识别为优先级");
  check(priorities.priorities[0].reason.length > 0 && priorities.priorities[0].priority_score > 0, "优先级带有可解释的依据和分数");

  const requests = await call("list_planning_requests", { child_id: child.id, status: "pending" });
  check(Array.isArray(requests.items), "待规划事项列表可读取");

  const outcome = await call("record_recommendation_outcome", {
    child_id: child.id,
    source_type: "learning_priority",
    source_id: priorities.priorities[0].signal_id,
    action_type: "targeted_practice",
    status: "pending",
  });
  check(Boolean(outcome.id), "推荐效果记录写入成功");

  console.log("\n学习决策层冒烟测试通过");
} finally {
  await client.close().catch(() => {});
}
