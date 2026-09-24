/**
 * 私教语音的纯逻辑断言：断句状态机、杂音过滤、朗读文本清理。
 *
 * 这几段逻辑决定"孩子说完了没有"和"念出来的是什么"，
 * 出错的方式很隐蔽（早断句、把杂音发出去、把标题符号念成星号），
 * 所以单独跑断言，不依赖浏览器与真实麦克风。
 *
 * 用法：npx tsx scripts/test-tutor-voice.ts
 */
import { stripForSpeech } from "../apps/web/src/lib/tutor.js";
import {
  isIdleTimeout,
  isUsableUtterance,
  rmsOf,
  UtteranceTracker,
  VOICE_LOOP_DEFAULTS,
} from "../apps/web/src/lib/tutor-voice.js";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}

console.log("音量计算");
check("全静音是 0", rmsOf(new Float32Array([0, 0, 0, 0])) === 0);
check("满幅正弦近似 0.707", Math.abs(rmsOf(new Float32Array([1, -1, 1, -1])) - 1) < 1e-9);
check("半幅是满幅的一半", Math.abs(rmsOf(new Float32Array([0.5, -0.5])) - 0.5) < 1e-9);
check("空数组不炸", rmsOf(new Float32Array([])) === 0);

console.log("杂音过滤");
check("说话 800ms 算一句话", isUsableUtterance(800));
check("碰一下桌子 100ms 不算", !isUsableUtterance(100));
check("刚好到下限算一句话", isUsableUtterance(VOICE_LOOP_DEFAULTS.minSpeechMs));

console.log("断句状态机");
{
  const tracker = new UtteranceTracker();
  const step = tracker.push(0.001, 0);
  check("安静时是在听", step.state === "listening" && !step.shouldStop);
}
{
  const tracker = new UtteranceTracker();
  check("听到第一声人声立刻进入说话态", tracker.push(0.5, 0).state === "speech");
  tracker.push(0.5, 100);
  tracker.push(0.5, 300);
  const speaking = tracker.push(0.5, 600);
  check("开始说话后还没到断句", !speaking.shouldStop);
  check("说了 600ms 就累计 600ms", speaking.speechMs === 600);
  check("安静不够久不断句", !tracker.push(0.0, 1200).shouldStop);
  const stop = tracker.push(0.0, 2400);
  check("安静超过 1100ms 断句", stop.shouldStop);
  check("断句时带上这一句的有效时长", stop.speechMs === 600);
  check("这一句够长，会被发去识别", isUsableUtterance(stop.speechMs));
}
{
  const tracker = new UtteranceTracker();
  tracker.push(0.5, 0);
  check("一直说不停不会提前断句", !tracker.push(0.5, 3000).shouldStop);
  check("说超过 15 秒强制断句", tracker.push(0.5, 15_100).shouldStop);
}
{
  const tracker = new UtteranceTracker();
  tracker.push(0.5, 0);
  const blip = tracker.push(0.0, 1200);
  check("一声轻响也会断句，但有效时长是 0", blip.shouldStop && blip.speechMs === 0);
  check("有效时长为 0 的片段会被丢掉", !isUsableUtterance(blip.speechMs));
}
{
  const tracker = new UtteranceTracker();
  tracker.push(0.5, 0);
  tracker.push(0.0, 2000);
  tracker.reset();
  check("reset 之后回到安静态", !tracker.isSpeaking);
  check("reset 之后重新从 listening 开始", tracker.push(0.0, 2100).state === "listening");
  check("reset 之后之前的静音时长不残留", !tracker.push(0.0, 2200).shouldStop);
}
{
  const tracker = new UtteranceTracker({ ...VOICE_LOOP_DEFAULTS, silenceMs: 400 });
  tracker.push(0.5, 0);
  tracker.push(0.5, 100);
  check("缩短静音阈值后更快断句", tracker.push(0.0, 600).shouldStop);
}

console.log("静默自动收工");
{
  const idleMs = 60_000;
  check(
    "刚说完话不会收工",
    !isIdleTimeout({ now: 10_000, lastHeardAt: 10_000, idleMs, tutorActive: false }),
  );
  check(
    "安静没到上限不收工",
    !isIdleTimeout({ now: 69_999, lastHeardAt: 10_000, idleMs, tutorActive: false }),
  );
  check(
    "安静超过上限就收工",
    isIdleTimeout({ now: 70_000, lastHeardAt: 10_000, idleMs, tutorActive: false }),
  );
  // 私教在思考或念答案时，孩子安静听着是正常的，不能按静音计时把麦克风关掉
  check(
    "私教在念的时候不收工",
    !isIdleTimeout({ now: 70_000, lastHeardAt: 10_000, idleMs, tutorActive: true }),
  );
  check(
    "私教念完才重新开始计时",
    isIdleTimeout({ now: 129_999, lastHeardAt: 70_000, idleMs, tutorActive: false }) === false &&
      isIdleTimeout({ now: 130_000, lastHeardAt: 70_000, idleMs, tutorActive: false }),
  );
  // 关掉兜底（0 或没配）表示一直听，不要自作主张收工
  check(
    "配 0 表示不自动收工",
    !isIdleTimeout({ now: 10_000_000, lastHeardAt: 0, idleMs: 0, tutorActive: false }),
  );
  check(
    "没配（NaN）也不自动收工",
    !isIdleTimeout({ now: 10_000_000, lastHeardAt: 0, idleMs: Number(undefined), tutorActive: false }),
  );
  check("默认兜底是 3 分钟", VOICE_LOOP_DEFAULTS.idleMs === 180_000);
}

console.log("朗读文本清理");
check("去掉标题井号", stripForSpeech("### 先想一步") === "先想一步");
check("去掉列表符号", stripForSpeech("- 第一步\n- 第二步") === "第一步\n第二步");
check("去掉有序列表序号", stripForSpeech("1. 看题\n2. 列式") === "看题\n列式");
check("去掉加粗星号", stripForSpeech("**重点**是单位") === "重点是单位");
check("保留数字与运算符", stripForSpeech("45-15+45 实际等于 75") === "45-15+45 实际等于 75");
check("行内代码去掉反引号", stripForSpeech("用 `7×8` 验算") === "用 7×8 验算");
check("链接只留文字", stripForSpeech("看[课本](https://example.com)第 3 页") === "看课本第 3 页");
check("代码块换成一句话说明", stripForSpeech("```js\nx=1\n```").includes("这里有一段代码"));
check("空字符串还是空字符串", stripForSpeech("   ") === "");

console.log(`\n语音逻辑断言：${passed} 项通过，${failures.length} 项失败`);
if (failures.length) {
  for (const name of failures) console.error(`  失败：${name}`);
  process.exit(1);
}
