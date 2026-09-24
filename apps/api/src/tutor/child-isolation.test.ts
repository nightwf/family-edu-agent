import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * 同一个家庭、两个孩子的隔离。
 *
 * 为什么单列一个文件：跨家庭最容易通过（换个 token 就查不到），
 * 同家庭跨孩子才是真正会漏的一类 —— familyId 对得上，边界只能靠 childId 挡住。
 * 设计文档第 9.3 节把这条列为必须独立覆盖的验收项。
 */

process.env.WEB_DIST = ".";
process.env.TUTOR_ENABLED = "true";
process.env.TUTOR_CHAT_API_KEY = "test-key";
process.env.TUTOR_CHAT_MODEL = "test-model";

/** 两个孩子同属 family-1；家庭边界因此完全落在 childId 上。 */
const CHILDREN: Record<string, { id: string; name: string; grade: string; gender: string }> = {
  "child-1": { id: "child-1", name: "庞欣格", grade: "三年级", gender: "male" },
  "child-2": { id: "child-2", name: "庞靖泽", grade: "一年级", gender: "female" },
};

/** 会话：conv-1 属于老大，conv-2 属于老二，都在 family-1。 */
const CONVERSATIONS: Record<string, { id: string; familyId: string; childId: string; status: string; persona: string }> = {
  "conv-1": { id: "conv-1", familyId: "family-1", childId: "child-1", status: "active", persona: "child_tutor" },
  "conv-2": { id: "conv-2", familyId: "family-1", childId: "child-2", status: "active", persona: "child_tutor" },
};

/** 记录每次查询真实下发的 where，用来证明过滤条件里确实带了 childId。 */
const seen: { conversationWhere: any[]; messageWhere: any[]; childWhere: any[] } = {
  conversationWhere: [],
  messageWhere: [],
  childWhere: [],
};

const writes: { evidence: any[]; message: any[] } = { evidence: [], message: [] };

const evidenceCreate = vi.fn(async ({ data }: any) => {
  writes.evidence.push(data);
  return { id: "ev-1", reviewStatus: "PENDING_CONFIRMATION", createdAt: new Date(), ...data };
});

const prismaMock: any = {
  user: { findUnique: vi.fn(async () => ({ id: "user-1", familyId: "family-1", status: "active" })) },
  familyMember: { findFirst: vi.fn(async () => ({ id: "member-1", role: "owner", status: "active" })) },
  family: {
    findUnique: vi.fn(async () => ({
      id: "family-1",
      educationPhilosophy: "以引导和鼓励为主",
      communicationStyle: "温和",
      strictness: "适中",
      parentGoals: [],
    })),
  },
  child: {
    findFirst: vi.fn(async ({ where }: any) => {
      seen.childWhere.push(where);
      const child = CHILDREN[where.id];
      // 归属必须同时匹配：换家庭后同一个 id 也拿不到
      return child && where.familyId === "family-1" ? { ...child, familyId: "family-1", subjects: [] } : null;
    }),
  },
  tutorConversation: {
    findFirst: vi.fn(async ({ where }: any) => {
      const conversation = CONVERSATIONS[where.id];
      return conversation && conversation.familyId === where.familyId ? { ...conversation, title: null } : null;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      seen.conversationWhere.push(where);
      return Object.values(CONVERSATIONS).filter(
        (conversation) =>
          conversation.familyId === where.familyId &&
          (where.childId === undefined || conversation.childId === where.childId) &&
          (where.status === undefined || conversation.status === where.status),
      );
    }),
    create: vi.fn(async ({ data }: any) => ({ id: "conv-new", ...data })),
    update: vi.fn(async () => ({})),
  },
  tutorMessage: {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async ({ where }: any) => {
      seen.messageWhere.push(where);
      // 真实语义：消息按 conversationId + familyId 取；把别的孩子写进来的消息排除掉
      if (where.conversationId === "conv-2" && where.familyId === "family-1") {
        return [
          { id: "m-2", conversationId: "conv-2", childId: "child-2", role: "user", content: "老二的问题", createdAt: new Date(2) },
        ];
      }
      return [
        { id: "m-1", conversationId: "conv-1", childId: "child-1", role: "user", content: "老大的问题", createdAt: new Date(1) },
      ];
    }),
    create: vi.fn(async ({ data }: any) => {
      writes.message.push(data);
      return { id: `msg-${writes.message.length}`, createdAt: new Date(), ...data };
    }),
  },
  evidenceRecord: { findFirst: vi.fn(async () => null), create: evidenceCreate },
  auditLog: { create: vi.fn(async ({ data }: any) => ({ id: "audit-1", ...data })) },
};

// 未显式打桩的模型一律返回空值
prismaMock.$proxy = new Proxy(prismaMock, {
  get: (target: any, prop: string) =>
    prop in target
      ? target[prop]
      : new Proxy({}, { get: (_t, method: string) => vi.fn().mockResolvedValue(method === "count" ? 0 : method === "findFirst" || method === "findUnique" ? null : []) }),
});

vi.mock("../prisma.js", () => ({ prisma: prismaMock.$proxy }));

const { buildApp } = await import("../app.js");
const { buildTutorPersona } = await import("./persona.js");

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
  seen.conversationWhere.length = 0;
  seen.messageWhere.length = 0;
  seen.childWhere.length = 0;
  writes.evidence.length = 0;
  writes.message.length = 0;
});

function auth() {
  return { authorization: `Bearer ${token}` };
}

describe("同家庭不同孩子：会话与消息隔离", () => {
  it("按孩子筛会话时，查询条件必须同时带上 childId 与 familyId", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tutor/conversations?child_id=child-2",
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(seen.conversationWhere).toHaveLength(1);
    expect(seen.conversationWhere[0].familyId).toBe("family-1");
    // 只筛 familyId 会把老大老二的会话一起列出来
    expect(seen.conversationWhere[0].childId).toBe("child-2");

    const conversations = response.json().conversations;
    expect(conversations.map((row: any) => row.id)).toEqual(["conv-2"]);
  });

  it("不带孩子筛选时按家庭返回，但不会串家庭", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tutor/conversations", headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(seen.conversationWhere[0].familyId).toBe("family-1");
    expect(seen.conversationWhere[0].childId).toBeUndefined();
  });

  it("读老二的会话，取到的是老二的消息与他自己的身份", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tutor/conversations/conv-2/messages",
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.conversation.childId).toBe("child-2");
    // 消息查询也必须带 familyId，否则同 id 会话在别家被读到
    expect(seen.messageWhere[0].familyId).toBe("family-1");
    expect(seen.messageWhere[0].conversationId).toBe("conv-2");
    expect(body.messages.every((row: any) => row.childId === "child-2")).toBe(true);
    expect(JSON.stringify(body.messages)).not.toContain("老大的问题");
  });

  it("建会话时钉住的孩子属于本家庭，别的家庭的孩子拿不到", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations",
      headers: auth(),
      payload: { child_id: "child-2" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().conversation.childId).toBe("child-2");
    expect(seen.childWhere.at(-1)).toEqual({ id: "child-2", familyId: "family-1" });

    // 同一个 id 换家庭身份就查不到
    const otherToken = app.jwt.sign({ sub: "user-9", familyId: "family-2" });
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "user-9", familyId: "family-2", status: "active" });
    const denied = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations",
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { child_id: "child-2" },
    });
    expect(denied.statusCode).toBe(404);
  });
});

describe("同家庭不同孩子：人格与证据隔离", () => {
  it("老二的人格只带老二的信息，不会把老大的名字写进去", async () => {
    const prompt = await buildTutorPersona({ familyId: "family-1", persona: "child_tutor", childId: "child-2" });

    expect(prompt).toContain("庞靖泽");
    expect(prompt).not.toContain("庞欣格");
    // 取数必须按 id + familyId 定位，防止 id 撞车
    expect(seen.childWhere.at(-1)).toEqual({ id: "child-2", familyId: "family-1" });
    // 会话只服务一个孩子的规则必须随人格一起下发
    expect(prompt).toContain("只针对当前这个孩子");
  });

  it("老大的人格不会串到老二的名字", async () => {
    const prompt = await buildTutorPersona({ familyId: "family-1", persona: "child_tutor", childId: "child-1" });
    expect(prompt).toContain("庞欣格");
    expect(prompt).not.toContain("庞靖泽");
  });

  it("老二会话沉淀的证据落在他自己名下，不会写成老大的", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-2/evidence",
      headers: auth(),
      payload: { observed_behavior: "今天独立做完了一页口算", type: "HOMEWORK_COMPLETION" },
    });

    expect(response.statusCode).toBe(200);
    expect(writes.evidence).toHaveLength(1);
    expect(writes.evidence[0].childId).toBe("child-2");
    expect(writes.evidence[0].familyId).toBe("family-1");
    // 一律待家长确认，且来源标成私教
    expect(response.json().reviewStatus).toBe("PENDING_CONFIRMATION");
  });

  it("证据类型写错时给出合法值清单，而不是 500", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-2/evidence",
      headers: auth(),
      payload: { observed_behavior: "随便写点", type: "PRACTICE" },
    });

    expect(response.statusCode).toBe(400);
    // Fastify 把状态短语放在 error、详情放在 message；合法值清单必须在 message 里，
    // 否则调用方又要靠猜枚举值。
    expect(response.json().message).toContain("HOMEWORK_COMPLETION");
    expect(writes.evidence).toHaveLength(0);
  });
});
