/**
 * 把表单里以顿号、逗号分隔的多值文本，统一转成字符串数组。
 *
 * 电脑端表单的回填值用顿号连接（"英语、数学"），小程序也允许顿号，
 * 早期接口只按逗号切分，导致整串被当成「一个学科」存下来，
 * 首页就只显示一张写着「英语、数学、语文…」的假学科卡。
 * 这里把分隔符统一成「逗号 / 中文逗号 / 顿号」，两端和手工录入都走同一条路。
 */
export function parseStringList(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String).map((item) => item.trim()).filter(Boolean);
  return String(input || "")
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
