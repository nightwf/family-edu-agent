/**
 * 安卓外壳的行为约定检查。
 *
 * 这里挡的是"手势/自动触发整页重载"这类改动。App 是 WebView 承载线上站点，
 * 一次 reload 会把整页重来、位置和正在做的事全丢，所以必须由用户明确点出来
 * 才允许发生（页面里每个数据区都有自己的「刷新」按钮）。
 *
 * 曾经有过一个"在顶部向下甩动就刷新"的手势，甩动的判定太容易误触，
 * 家长在列表里往下滑就被整页重载，已经被删掉。这里防止它被无意加回来。
 *
 * 用法：node scripts/check-android-shell.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mainActivity = path.join(
  root,
  "android/app/src/main/java/top/heyaagent/familyedu/MainActivity.java",
);

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? `（${detail}）` : ""}`);
    console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`);
  }
}

if (!fs.existsSync(mainActivity)) {
  console.error(`找不到 ${mainActivity}`);
  process.exit(1);
}
const source = fs.readFileSync(mainActivity, "utf8");

console.log("安卓外壳：不允许手势触发整页重载");
check("没有 onFling 手势", !/onFling/.test(source));
check("没有 GestureDetector", !/GestureDetector/.test(source));
check(
  "触摸处理不会调用刷新",
  !/setOnTouchListener[\s\S]{0,700}?reload\(\)/.test(source),
);
// 曾经这里要求“下拉时 return true 吃掉手势”，结果把页面内滚动也吃没了：
// WebView 的 getScrollY() 几乎恒为 0，于是任何向下拖动都被拦下，聊天页直接拖不动。
// 现在的约定反过来：外壳不许吞掉页面内的触摸手势，防越界交给 WebView 与页面 CSS。
check(
  "外壳不吞页面内的触摸手势",
  !/setOnTouchListener/.test(source) && !/view\.getScrollY\(\)/.test(source),
);
check("WebView 关闭过滚动效果", /setOverScrollMode\(View\.OVER_SCROLL_NEVER\)/.test(source));
// 重载本身要保留：加载失败时那个「重新加载」按钮得能用
check("加载失败时的重新加载按钮还在", /retry_button/.test(source) || /reload\(\)/.test(source));

console.log(`\n安卓外壳检查：${passed} 项通过，${failures.length} 项失败`);
if (failures.length) {
  for (const name of failures) console.error(`  失败：${name}`);
  process.exit(1);
}
