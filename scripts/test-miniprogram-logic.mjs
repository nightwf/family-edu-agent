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
    growth: [],
    page: { limit: 20, offset: 0, total_records: 1, total_reports: 0 },
  });
  assert(context.data.records.length === 1 && context.data.records[0].id === "fresh", "首屏加载为覆盖语义，不残留旧数据");
}

if (failures) {
  console.error(`\n小程序逻辑测试失败：${failures} 项`);
  process.exit(1);
}
console.log("\n小程序逻辑测试全部通过");
