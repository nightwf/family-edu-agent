import type { FastifyRequest } from "fastify";

/**
 * 取 multipart 表单里上传的文件。
 *
 * 本项目在 app.ts 里以 `attachFieldsToBody: true` 注册 @fastify/multipart，
 * 这个模式下 `request.file()` / `request.files()` **不存在**，文件挂在
 * `request.body.<字段名>` 上（形如 `{ toBuffer(), filename, mimetype }`）。
 * 踩过一次坑：私教的两个上传接口写成 `request.file()`，于是永远"没有收到文件"。
 * 统一从这里取文件，别再各写一份。
 */
export type UploadedFile = {
  buffer: Buffer;
  filename: string;
  mimetype: string;
};

export async function readUploadedFile(request: FastifyRequest, field = "file"): Promise<UploadedFile | null> {
  const part = (request.body as any)?.[field];
  if (part && typeof part.toBuffer === "function") {
    const buffer: Buffer = await part.toBuffer();
    return {
      buffer,
      filename: String(part.filename || ""),
      mimetype: String(part.mimetype || "application/octet-stream"),
    };
  }

  // 防御性分支：一旦哪天改成非 attachFieldsToBody 模式，这里仍能取到文件。
  const legacy = (request as any).file;
  if (typeof legacy === "function") {
    const file = await legacy.call(request).catch(() => null);
    if (file && typeof file.toBuffer === "function") {
      return {
        buffer: await file.toBuffer(),
        filename: String(file.filename || ""),
        mimetype: String(file.mimetype || "application/octet-stream"),
      };
    }
  }
  return null;
}
