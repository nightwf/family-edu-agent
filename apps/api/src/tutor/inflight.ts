/**
 * 正在生成中的回合登记表，用来支持"孩子插话就打断"。
 *
 * 孩子说到一半，私教还在念上一段，这时要立刻停嘴——前端播放可以自己停，
 * 但服务端还在继续调模型和合成语音，不打断就是白花钱、白占配额。
 *
 * 只活在进程内存里。当前是单实例部署，够用；将来上多实例要换成共享存储
 * （Redis 之类），否则打断请求可能落到没有这个回合的实例上。见 TUTOR_AGENT_DESIGN 第 11 节。
 */

type Turn = {
  familyId: string;
  controller: AbortController;
  startedAt: number;
};

const turns = new Map<string, Turn>();

/** 登记一个回合，返回它自己的中断控制器。同一会话同一时刻只允许一个回合。 */
export function registerTurn(conversationId: string, familyId: string): AbortController {
  const previous = turns.get(conversationId);
  // 上一个回合还挂着就先收掉，避免旧回合把新回合的打断抢走
  if (previous) previous.controller.abort();
  const controller = new AbortController();
  turns.set(conversationId, { familyId, controller, startedAt: Date.now() });
  return controller;
}

/** 回合结束（正常、报错、被打断都算）后一定要调用，否则表会一直涨。 */
export function releaseTurn(conversationId: string, controller: AbortController) {
  const current = turns.get(conversationId);
  if (current?.controller === controller) turns.delete(conversationId);
}

/**
 * 打断某个会话正在生成的回合。
 * 家庭不匹配一律当作没找到：不能让 A 家庭打断 B 家庭的对话。
 */
export function interruptTurn(conversationId: string, familyId: string): boolean {
  const turn = turns.get(conversationId);
  if (!turn || turn.familyId !== familyId) return false;
  turn.controller.abort();
  return true;
}

/** 仅用于排查与测试：当前挂着的回合数。 */
export function inflightCount() {
  return turns.size;
}
