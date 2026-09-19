/**
 * 小程序页面逻辑单测。
 *
 * 小程序页面是 CommonJS 且依赖 wx 运行时，这里通过桩掉内部 require 后按 CommonJS 编译
 * 真实页面文件来驱动，避免为了测试而复制一份逻辑。
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("miniprogram");
let failures = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

function requirePage(relativePath, stubs, globals = {}) {
  const file = path.join(root, relativePath);
  const originalLoad = Module._load;
  const originalPage = global.Page;
  const originalWx = global.wx;
  Module._load = function (request, parent, isMain) {
    for (const [suffix, stub] of Object.entries(stubs)) {
      if (request.endsWith(suffix)) return stub;
    }
    return originalLoad(request, parent, isMain);
  };
  Object.assign(global, globals);
  let config = null;
  global.Page = (value) => { config = value; };
  try {
    const module = new Module(file, null);
    module.filename = file;
    module.paths = Module._nodeModulePaths(path.dirname(file));
    module._compile(fs.readFileSync(file, "utf8"), file);
  } finally {
    Module._load = originalLoad;
    global.Page = originalPage;
    if (originalWx === undefined) delete global.wx;
    else global.wx = originalWx;
  }
  if (!config) throw new Error(`${relativePath} 未注册 Page 配置`);
  return config;
}

function requireCommonJs(relativePath) {
  const file = path.join(root, relativePath);
  const module = new Module(file, null);
  module.filename = file;
  module.paths = Module._nodeModulePaths(path.dirname(file));
  module._compile(fs.readFileSync(file, "utf8"), file);
  return module.exports;
}

function makeContext(initial) {
  const state = { ...initial };
  return {
    data: state,
    setData(patch) { Object.assign(state, patch); },
  };
}

console.log("成长页分页合并逻辑");
{
  const growth = requirePage("pages/growth/growth.js", {
    "utils/api": { mobileGrowth: async () => ({ children: [], records: [], reports: [], growth: [], page: {} }) },
    "utils/format": { formatDate: (value) => String(value) },
  });

  const record = (id) => ({ id, date: "2026-09-01", type: "reading", content: `记录${id}` });
  const report = (id) => ({ id, createdAt: "2026-09-01", type: "weekly", title: `报告${id}` });
  const context = makeContext({ tab: "records", records: [], reports: [], totalRecords: 0, totalReports: 0 });

  growth.setGrowthData.call(context, {
    records: Array.from({ length: 20 }, (_, index) => record(`r${index}`)),
    reports: Array.from({ length: 10 }, (_, index) => report(`p${index}`)),
    growth: [],
    page: { limit: 20, offset: 0, total_records: 23, total_reports: 25 },
  });
  assert(context.data.records.length === 20, "首屏加载 20 条成长记录");
  assert(context.data.recordsHasMore === true && context.data.reportsHasMore === true, "首屏正确判定还有更多数据");

  context.data.tab = "records";
  growth.setGrowthData.call(context, {
    records: [record("r20"), record("r21"), record("r22")],
    reports: Array.from({ length: 10 }, (_, index) => report(`stale${index}`)),
    growth: [],
    page: { limit: 20, offset: 20, total_records: 23, total_reports: 25 },
  }, {}, true);
  assert(context.data.records.length === 23, "追加后成长记录累计 23 条");
  assert(new Set(context.data.records.map((item) => item.id)).size === 23, "追加后无重复记录");
  assert(context.data.recordsHasMore === false, "加载完毕后 hasMore 关闭");
  assert(!context.data.reports.some((item) => String(item.id).startsWith("stale")), "报告列表未被记录翻页的返回覆盖");

  context.data.tab = "reports";
  growth.setGrowthData.call(context, {
    records: [record("polluted")],
    reports: Array.from({ length: 10 }, (_, index) => report(`p${index + 10}`)),
    growth: [],
    page: { limit: 20, offset: 10, total_records: 23, total_reports: 25 },
  }, {}, true);
  assert(context.data.reports.length === 20, "报告追加后累计 20 条");
  assert(!context.data.records.some((item) => item.id === "polluted"), "成长记录未被报告翻页的返回污染");

  // 首屏（append = false）必须是覆盖语义，切孩子后不能残留上一个孩子的数据
  growth.setGrowthData.call(context, {
    records: [record("fresh")],
    reports: [],
    growth: [{
      id: "record:fresh",
      date: "2026-09-01",
      category: "record",
      category_label: "阅读",
      title: "阅读记录",
      summary: "能够完成复述",
      score: null,
      status_label: "已记录",
      tone: "neutral",
    }],
    growth_summary: { evidence_count: 1, open_wrong: 0, mastered_types: 0, last_activity_at: "2026-09-01" },
    page: { limit: 20, offset: 0, total_records: 1, total_reports: 0 },
  });
  assert(context.data.records.length === 1 && context.data.records[0].id === "fresh", "首屏加载为覆盖语义，不残留旧数据");
  assert(context.data.growth.length === 1 && context.data.growth[0].hasScore === false, "无评分记录仍进入成长轨迹");
  assert(context.data.growthSummary.evidence_count === 1, "成长轨迹统计使用服务端真实汇总");
}

console.log("\n首页每日场景与状态映射");
{
  const presentation = requireCommonJs("utils/presentation.js");
  const sameA = presentation.dailyScene("child-1", new Date("2026-09-18T08:00:00+08:00"));
  const sameB = presentation.dailyScene("child-1", new Date("2026-09-18T22:00:00+08:00"));
  assert(sameA === sameB, "同一孩子同一天刷新时场景保持一致");
  assert(presentation.SCENES.includes(sameA), "每日场景只从本地三套压缩背景选择");

  const empty = presentation.deriveChildPresentation({ child: { id: "c1", name: "JOJO" } });
  assert(empty.hasEvidence === false && empty.judgment.includes("不足"), "无数据时只显示证据不足，不伪造结论");

  const review = presentation.deriveChildPresentation({
    child: { id: "c1", name: "JOJO" },
    childState: { summary: { evidence_7d: 3 } },
    wrongQuestions: { items: [{ status: "needs_review", questionType: { name: "小数加减" } }] },
    mastery: { items: [] },
    homework: [],
  });
  assert(review.state === "review" && review.image.endsWith("child-review.png"), "待复测错题映射到待复测人物状态");
  assert(review.weakness.name === "小数加减", "薄弱点名称来自真实题型数据");
}

console.log("\n首页人物形象性别映射");
{
  const presentation = requireCommonJs("utils/presentation.js");
  assert(presentation.normalizedGender(undefined) === "male", "未设置性别时按男生处理");
  assert(presentation.normalizedGender("female") === "female", "女生档案识别为女生");
  assert(presentation.normalizedGender("FEMALE") === "female", "性别取值大小写不敏感");
  assert(presentation.normalizedGender("other") === "male", "非法性别值回退为男生");

  assert(presentation.stateAsset("thinking", "male").endsWith("child-thinking.png"), "男生使用男生形象素材");
  assert(presentation.stateAsset("thinking", "female").endsWith("child-thinking-female.png"), "已就绪的女生状态使用女生形象素材");
  for (const state of ["stable", "progress", "thinking", "review", "done"]) {
    assert(presentation.stateAsset(state, "female").endsWith(`child-${state}-female.png`), `女生 ${state} 状态使用女生素材`);
  }
  assert(presentation.hasFemaleAsset("not-a-real-state") === false, "未登记的状态不会被当作已就绪女生素材");
  assert(presentation.stateAsset("not-a-real-state", "female").endsWith("child-stable.png"), "未登记状态回退到男生稳定素材");

  const femaleHero = presentation.deriveChildPresentation({
    child: { id: "c2", name: "XIAOYU", gender: "female" },
    childState: { summary: { evidence_7d: 1 } },
    wrongQuestions: { items: [{ status: "needs_review", questionType: { name: "阅读概括" } }] },
    mastery: { items: [] },
    homework: [],
  });
  assert(femaleHero.state === "review" && femaleHero.image.endsWith("child-review-female.png"), "女生首页形象同时跟随状态与性别");

  assert(presentation.stateAsset("unknown-state", "female").endsWith("child-stable.png"), "未知状态回退到稳定形象");
  assert(presentation.stateAsset("stable", null).endsWith("child-stable.png"), "无性别孩子使用男生形象");

  const illustrationDir = path.join(root, "assets/illustrations");
  for (const state of presentation.FEMALE_READY_STATES) {
    assert(fs.existsSync(path.join(illustrationDir, `child-${state}-female.png`)), `已登记的女生素材真实存在：child-${state}-female.png`);
  }
  const femaleFiles = fs.readdirSync(illustrationDir).filter((name) => name.endsWith("-female.png"));
  for (const file of femaleFiles) {
    const state = file.replace(/^child-/, "").replace(/-female\.png$/, "");
    assert(presentation.FEMALE_READY_STATES.includes(state), `已存在的女生素材已登记到映射表：${file}`);
  }
}

console.log("\n首页待规划提示");
{
  const planning = requireCommonJs("utils/planning.js");
  assert(planning.buildPlanningCard({ name: "JOJO" }, null, null) === null, "没有待规划事项时不显示规划卡片");

  const withPriority = planning.buildPlanningCard(
    { name: "JOJO" },
    { top: { label: "看图列式", reason: "14 天内重复出错 2 次", priority_score: 104 } },
    { id: "pr1", status: "pending", trigger_reason: "看图列式重复出错" },
  );
  assert(withPriority.statusText === "待规划", "待规划事项显示为待规划状态");
  assert(withPriority.focusText === "看图列式", "规划卡片显示第一优先的学习重点");
  assert(withPriority.instruction.includes("JOJO") && withPriority.instruction.includes("看图列式"), "复制指令带上孩子与学习重点");
  assert(withPriority.instruction.includes("4 周"), "复制指令明确计划周期");

  const inProgress = planning.buildPlanningCard(
    { name: "JOJO" },
    { top: { label: "看图列式", reason: "重复出错" } },
    { id: "pr2", status: "in_progress" },
  );
  assert(inProgress.statusText === "规划中", "进行中的待规划事项显示为规划中");
  assert(inProgress.reason === "重复出错", "没有触发原因时回退到优先级原因");

  const noSignal = planning.buildPlanningCard(
    { name: "JOJO" },
    null,
    { id: "pr3", status: "pending", trigger_reason: "长期没有新的学习记录" },
  );
  assert(noSignal.focusText === "需要先补充学习记录", "没有优先级时提示先补充学习记录");
  assert(noSignal.instruction.includes("JOJO"), "没有优先级时仍然生成可用指令");
}

console.log("\n家庭切换缓存隔离");
{
  const session = requireCommonJs("utils/session.js");
  const removed = [];
  session.clearFamilyScopedCache({ removeStorageSync: (key) => removed.push(key) });
  assert(removed.includes("familyEduSelectedChildId"), "切换家庭清除上一个家庭的孩子选择");
  assert(removed.includes("familyEduLearningModule"), "切换家庭清除上一个家庭的学习模块状态");
}

if (failures) {
  console.error(`\n小程序逻辑测试失败：${failures} 项`);
  process.exit(1);
}
console.log("\n小程序逻辑测试全部通过");
