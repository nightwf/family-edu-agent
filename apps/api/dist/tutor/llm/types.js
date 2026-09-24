/**
 * 模型供应商抽象：把"跟模型通信"这件事收敛到一层，
 * 上层 runtime 只认这里的统一事件类型，不认任何厂商格式。
 */
/** 供测试与本地开发使用的假供应商：不发网络请求，按脚本吐事件。 */
export class FakeChatProvider {
    script;
    name = "fake";
    supportsVision = true;
    calls = [];
    constructor(script = [[{ type: "text", delta: "好的" }, { type: "done", usage: { promptTokens: 1, completionTokens: 1 } }]]) {
        this.script = script;
    }
    async *streamChat(input) {
        this.calls.push(input);
        const events = this.script[Math.min(this.calls.length - 1, this.script.length - 1)] || [];
        for (const event of events)
            yield event;
    }
}
