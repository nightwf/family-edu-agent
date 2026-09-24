import { describe, expect, it } from "vitest";
import { createJsonObjectStream } from "./json-stream.js";

/** 把一段报文按任意位置切成若干片喂进去，结果必须与一次性喂入一致。 */
function feedAll(chunks: string[]) {
  const stream = createJsonObjectStream();
  const out: any[] = [];
  for (const chunk of chunks) out.push(...stream.push(chunk));
  out.push(...stream.flush());
  return out;
}

describe("流式 JSON 对象解析", () => {
  it("按行分隔的多个对象", () => {
    const raw = '{"code":0,"data":"AAA"}\n{"code":0,"data":"BBB"}\n';
    expect(feedAll([raw])).toEqual([
      { code: 0, data: "AAA" },
      { code: 0, data: "BBB" },
    ]);
  });

  it("对象之间没有换行、直接粘在一起也能拆开", () => {
    expect(feedAll(['{"code":0,"data":"A"}{"code":0,"data":"B"}'])).toEqual([
      { code: 0, data: "A" },
      { code: 0, data: "B" },
    ]);
  });

  it("任意切分（含切在 JSON 中间、切在字符串中间）结果一致", () => {
    const raw = '{"code":0,"data":"AAAA","sentence":{"text":"你好，世界"}}{"code":0,"data":"BBBB"}';
    const expected = feedAll([raw]);
    for (let size = 1; size <= 7; size += 1) {
      const chunks: string[] = [];
      for (let i = 0; i < raw.length; i += size) chunks.push(raw.slice(i, i + size));
      expect(feedAll(chunks), `按 ${size} 字符切分`).toEqual(expected);
    }
  });

  it("字符串里的花括号与转义引号不会打乱配对", () => {
    const raw = '{"code":0,"sentence":{"text":"他说 { 这个 } 还有 \\"引号\\""}}';
    expect(feedAll([raw])).toEqual([{ code: 0, sentence: { text: '他说 { 这个 } 还有 "引号"' } }]);
  });

  it("没凑齐的半截对象留在缓冲区，不提前吐出", () => {
    const stream = createJsonObjectStream();
    expect(stream.push('{"code":0,"data":"AA')).toEqual([]);
    expect(stream.push('AA"}')).toEqual([{ code: 0, data: "AAAA" }]);
  });

  it("中文与 base64 字符（含 + / =）不会被当成结构符", () => {
    const raw = '{"data":"a+b/c==","message":"OK"}';
    expect(feedAll([raw])).toEqual([{ data: "a+b/c==", message: "OK" }]);
  });

  it("上游截断（半截对象）不报错，只是拿不到这个对象", () => {
    const stream = createJsonObjectStream();
    stream.push('{"data":"AAAA"}');
    stream.push('{"data":"BB');
    expect(stream.flush()).toEqual([]);
  });

  it("坏碎片不会让后续对象解析不出来", () => {
    const stream = createJsonObjectStream();
    expect(stream.push("{不是JSON}{")).toEqual([]);
    expect(stream.push('"code":0}')).toEqual([{ code: 0 }]);
  });
});
