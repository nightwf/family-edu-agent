/**
 * 把一段回答切成"可以立刻念出去"的小句。
 *
 * 实时语音的等待时间基本由这里决定：等整段回答合成完再播，孩子要干等好几秒；
 * 按句切开发给语音合成，第一句一合成好就能出声，后面几句在后面接上。
 *
 * 切分规则偏保守：只在句末标点、换行、分号处断，逗号只在句子过长时才断，
 * 因为逗号断句会让语气变得一顿一顿的。
 */

export type SentenceSplitOptions = {
  /** 单句超过这个长度才允许在逗号处断，默认 32 字（孩子一口气能听住的长度） */
  softLimit?: number;
  /** 单句硬上限，超过就强制切，避免一句念不完，默认 120 字 */
  hardLimit?: number;
};

const SENTENCE_END = /[。！？!?…；;]/;
const SOFT_BREAK = /[，,、：:]/;

/** 去掉不该念出来的排版记号，避免语音合成把星号井号也读出来。 */
export function cleanForSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "这里有一段示例，看屏幕就好。")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.、]\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * 切句。返回的每一段都自带结尾标点，直接可以读。
 * 空白段与纯标点段会被丢掉，避免合成出一段空音频。
 */
export function splitSentences(text: string, options: SentenceSplitOptions = {}): string[] {
  const softLimit = options.softLimit ?? 32;
  const hardLimit = options.hardLimit ?? 120;
  const cleaned = cleanForSpeech(text);
  if (!cleaned) return [];

  const sentences: string[] = [];
  for (const rawLine of cleaned.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let buffer = "";
    for (const char of line) {
      buffer += char;
      const isEnd = SENTENCE_END.test(char);
      const isSoft = SOFT_BREAK.test(char) && buffer.length >= softLimit;
      if (isEnd || isSoft) {
        push(sentences, buffer);
        buffer = "";
      }
    }

    // 一行以逗号收尾又被软切过时，剩下的尾巴也要留住
    if (buffer.trim()) push(sentences, buffer);
  }

  // 硬上限兜底：极长的句子再按长度切开
  const limited: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= hardLimit) {
      limited.push(sentence);
      continue;
    }
    for (let index = 0; index < sentence.length; index += hardLimit) {
      limited.push(sentence.slice(index, index + hardLimit));
    }
  }
  return limited;
}

function push(target: string[], value: string) {
  const trimmed = value.trim();
  // 只留下真正能念的内容：至少包含一个汉字、字母或数字
  if (!trimmed) return;
  if (!/[\p{Script=Han}A-Za-z0-9]/u.test(trimmed)) return;
  target.push(trimmed);
}
