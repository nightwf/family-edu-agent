import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.WEB_DIST = ".";
process.env.TUTOR_ENABLED = "true";

const state: Record<string, any> = {};

/** 未显式打桩的模型返回空值；本测试关心鉴权、家庭边界与配额。 */
function fallbackModel(prop: string) {
  return vi.fn().mockResolvedValue(prop === "count" ? 0 : prop === "findFirst" || prop === "findUnique" ? null : []);
}

const prismaMock: any = new Proxy(
  {
    user: { findUnique: vi.fn(async () => ({ id: "user-1", familyId: "family-1", status: "active" })) },
    familyMember: { findFirst: vi.fn(async () => ({ id: "member-1", role: "owner", status: "active" })) },
    child: {
      // 归属固定为 family-1：切换登录身份不会让别家的孩子变成自己的。
      findFirst: vi.fn(async ({ where }: any) => (where.id === state.ownedChildId && where.familyId === "family-1" ? { id: where.id, familyId: where.familyId, name: "JOJO" } : null)),
    },
    tutorConversation: {
      create: vi.fn(async ({ data }: any) => ({ id: "conv-new", ...data })),
      // conv-1 属于 family-1；换家庭身份后必须查不到。
      findFirst: vi.fn(async ({ where }: any) => (where.id === state.conversationId && where.familyId === "family-1" ? { id: where.id, familyId: where.familyId, childId: state.ownedChildId, persona: "child_tutor", status: "active", title: null } : null)),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    tutorMessage: {
      count: vi.fn(async () => state.usedMessages ?? 0),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: "msg-1", ...data })),
    },
  } as Record<string, any>,
  { get: (target, prop: string) => (prop in target ? target[prop] : new Proxy({}, { get: (_t, method: string) => fallbackModel(method) })) },
);

vi.mock("../prisma.js", () => ({ prisma: prismaMock }));

const { buildApp } = await import("../app.js");
const { env } = await import("../env.js");

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: "user-1", familyId: "family-1" });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  state.familyId = "family-1";
  state.ownedChildId = "child-1";
  state.conversationId = "conv-1";
  state.usedMessages = 0;
});

function auth(extra: Record<string, unknown> = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

describe("私教接口：鉴权与家庭边界", () => {
  it("没有登录时拒绝访问", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tutor/status" });
    expect(response.statusCode).toBe(401);
  });

  it("状态接口返回开关、模型配置与今日额度", async () => {
    state.usedMessages = 3;
    const response = await app.inject({ method: "GET", url: "/api/tutor/status", headers: auth() });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.enabled).toBe(true);
    expect(body.model_configured).toBe(false); // 测试环境没有密钥
    expect(body.quota.used_messages).toBe(3);
    expect(body.quota.left_messages).toBe(body.quota.message_limit - 3);
  });

  it("建会话时校验孩子属于当前家庭", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations",
      headers: auth(),
      payload: { child_id: "child-1" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().conversation.childId).toBe("child-1");

    // 别家的孩子拿不到
    state.ownedChildId = "someone-else";
    const denied = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations",
      headers: auth(),
      payload: { child_id: "child-1" },
    });
    expect(denied.statusCode).toBe(404);
  });

  it("读会话列表时校验孩子归属", async () => {
    state.ownedChildId = "other";
    const response = await app.inject({
      method: "GET",
      url: "/api/tutor/conversations?child_id=child-1",
      headers: auth(),
    });
    expect(response.statusCode).toBe(404);
  });

  it("看不到别的家庭的会话", async () => {
    // 会话属于 family-1，但请求身份指向另一个家庭
    state.familyId = "family-2";
    const otherToken = app.jwt.sign({ sub: "user-1", familyId: "family-2" });
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", familyId: "family-2", status: "active" });
    const response = await app.inject({
      method: "GET",
      url: "/api/tutor/conversations/conv-1/messages",
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("私教接口：配额与开关", () => {
  it("额度用尽时返回可读提示，且不是 500", async () => {
    state.usedMessages = env.TUTOR_DAILY_MESSAGE_LIMIT;
    const response = await app.inject({ method: "GET", url: "/api/tutor/quota", headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json().allowed).toBe(false);

    const send = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/messages",
      headers: auth(),
      payload: { text: "这题怎么做" },
    });
    expect(send.statusCode).toBe(429);
    expect(send.json().error).toContain("明天");
  });

  it("空消息被拒绝", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/messages",
      headers: auth(),
      payload: { text: "   " },
    });
    expect(response.statusCode).toBe(400);
  });

  it("归档的会话不能再发消息", async () => {
    prismaMock.tutorConversation.findFirst.mockResolvedValueOnce({
      id: "conv-1",
      familyId: "family-1",
      childId: "child-1",
      persona: "child_tutor",
      status: "archived",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/messages",
      headers: auth(),
      payload: { text: "还在吗" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("没有模型密钥时给出可读提示，不假装能答", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/messages",
      headers: auth(),
      payload: { text: "这题怎么做" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain("模型密钥");
  });

  it("总开关关闭时接口返回 503", async () => {
    const original = env.TUTOR_ENABLED;
    env.TUTOR_ENABLED = false;
    const response = await app.inject({ method: "GET", url: "/api/tutor/status", headers: auth() });
    expect(response.statusCode).toBe(503);
    env.TUTOR_ENABLED = original;
  });

  it("家庭级会话不生成孩子证据", async () => {
    prismaMock.tutorConversation.findFirst.mockResolvedValueOnce({
      id: "conv-1",
      familyId: "family-1",
      childId: null,
      persona: "parent_coach",
      status: "active",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/evidence",
      headers: auth(),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("家庭级");
  });

  it("语音未开通时明确返回 503，而不是静默失败", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/voice/speak",
      headers: auth(),
      payload: { text: "你好" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain("尚未开通");
  });
});
