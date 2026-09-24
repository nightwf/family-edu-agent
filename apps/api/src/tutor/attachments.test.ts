import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.WEB_DIST = ".";
process.env.TUTOR_ENABLED = "true";

const state: Record<string, any> = {};

/** 未显式打桩的模型返回空值；本测试只关心上传链路。 */
function fallbackModel(prop: string) {
  return vi.fn().mockResolvedValue(prop === "count" ? 0 : prop === "findFirst" || prop === "findUnique" ? null : []);
}

const prismaMock: any = new Proxy(
  {
    user: { findUnique: vi.fn(async () => ({ id: "user-1", familyId: "family-1", status: "active" })) },
    familyMember: { findFirst: vi.fn(async () => ({ id: "member-1", role: "owner", status: "active" })) },
    tutorConversation: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.id === state.conversationId && where.familyId === "family-1"
          ? { id: where.id, familyId: where.familyId, childId: "child-1", persona: "child_tutor", status: "active", title: null }
          : null,
      ),
    },
  } as Record<string, any>,
  { get: (target, prop: string) => (prop in target ? target[prop] : new Proxy({}, { get: (_t, method: string) => fallbackModel(method) })) },
);

vi.mock("../prisma.js", () => ({ prisma: prismaMock }));

const savedFiles: Array<{ key: string; bytes: number; contentType: string }> = [];
vi.mock("../storage.js", () => ({
  saveFile: vi.fn(async (key: string, buffer: Buffer, contentType: string) => {
    savedFiles.push({ key, bytes: buffer.length, contentType });
    return `s3://family-edu/${key}`;
  }),
  openFile: vi.fn(async () => {
    throw new Error("本测试不读回文件");
  }),
}));

/** 语音模块打桩：只为断言"文件真的传到了识别这一层"。 */
const transcribed: Array<{ bytes: number; format: string }> = [];
vi.mock("./voice/index.js", () => {
  class VoiceNotConfiguredError extends Error {
    constructor(part: "asr" | "tts") {
      super(part === "asr" ? "语音识别尚未开通" : "语音朗读尚未开通");
      this.name = "VoiceNotConfiguredError";
    }
  }
  return {
    VoiceNotConfiguredError,
    getVoiceStatus: vi.fn(() => ({ asr: true, tts: true })),
    transcribe: vi.fn(async (audio: Buffer, format: string) => {
      transcribed.push({ bytes: audio.length, format });
      return "老师我读完了";
    }),
    synthesize: vi.fn(async () => ({ audio: Buffer.from([1, 2, 3]), contentType: "audio/mpeg" })),
  };
});

const { buildApp } = await import("../app.js");

let app: FastifyInstance;
let token: string;

/** 手拼 multipart 请求体：真实客户端就是按这个形状发的。 */
function multipart(filename: string, contentType: string, bytes: Buffer, field = "file") {
  const boundary = "----familyEduTestBoundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, bytes, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function auth(extra: Record<string, unknown> = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ sub: "user-1", familyId: "family-1" });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  state.conversationId = "conv-1";
  savedFiles.length = 0;
  transcribed.length = 0;
});

describe("私教上传：multipart 取文件", () => {
  it("图片上传能收到文件并落到对象存储", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { payload, headers } = multipart("homework.png", "image/png", bytes);
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/attachments",
      headers: auth(headers),
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.objectKey).toContain("tutor/family-1/conv-1/");
    expect(body.objectKey.endsWith("homework.png")).toBe(true);
    expect(body.contentType).toBe("image/png");
    // 关键断言：字节数一致，说明真的读到了文件而不是空壳
    expect(savedFiles).toHaveLength(1);
    expect(savedFiles[0].bytes).toBe(bytes.length);
  });

  it("非图片被拒", async () => {
    const { payload, headers } = multipart("notes.txt", "text/plain", Buffer.from("hello"));
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/attachments",
      headers: auth(headers),
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "只支持图片" });
    expect(savedFiles).toHaveLength(0);
  });

  it("3MB 的作业照能传上去（默认 1MB 上限会把它截断）", async () => {
    const bytes = Buffer.alloc(3 * 1024 * 1024, 9);
    const { payload, headers } = multipart("photo.jpg", "image/jpeg", bytes);
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/attachments",
      headers: auth(headers),
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(savedFiles[0].bytes).toBe(bytes.length);
  });

  it("超过 8MB 的图片被拒，且报错是业务文案", async () => {
    const { payload, headers } = multipart("big.png", "image/png", Buffer.alloc(8 * 1024 * 1024 + 1, 1));
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/attachments",
      headers: auth(headers),
      payload,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: "图片过大（上限 8MB）" });
    expect(savedFiles).toHaveLength(0);
  });

  it("没带文件时明确报错（而不是静默成功）", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-1/attachments",
      headers: auth({ "content-type": "application/json" }),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "没有收到文件" });
  });

  it("别家会话不接受上传", async () => {
    const { payload, headers } = multipart("homework.png", "image/png", Buffer.from([1]));
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/conversations/conv-other/attachments",
      headers: auth(headers),
      payload,
    });
    expect(response.statusCode).toBe(404);
    expect(savedFiles).toHaveLength(0);
  });

  it("语音识别能收到音频，并把格式交给识别层", async () => {
    const bytes = Buffer.alloc(2048, 7);
    const { payload, headers } = multipart("voice.webm", "audio/webm", bytes);
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/voice/transcribe",
      headers: auth(headers),
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ text: "老师我读完了" });
    expect(transcribed).toEqual([{ bytes: bytes.length, format: "webm" }]);
  });

  it("语音接口没带文件时明确报错", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tutor/voice/transcribe",
      headers: auth({ "content-type": "application/json" }),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "没有收到音频" });
  });
});
