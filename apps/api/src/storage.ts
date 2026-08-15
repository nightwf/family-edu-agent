import fs from "node:fs";
import path from "node:path";
import { Client } from "minio";
import { env } from "./env.js";

function createS3Client() {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return null;
  return new Client({
    endPoint: env.S3_ENDPOINT,
    port: env.S3_PORT || undefined,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    useSSL: env.S3_USE_SSL,
  });
}

export async function saveFile(key: string, buffer: Buffer, contentType = "application/octet-stream") {
  const client = createS3Client();
  if (client) {
    await client.putObject(env.S3_BUCKET, key, buffer, buffer.length, { "Content-Type": contentType });
    return `s3://${env.S3_BUCKET}/${key}`;
  }
  const target = path.join(env.STORAGE_DIR, key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  return target;
}

export async function ensureStorageBucket() {
  const client = createS3Client();
  if (!client) return;
  const exists = await client.bucketExists(env.S3_BUCKET).catch(() => false);
  if (!exists) {
    await client.makeBucket(env.S3_BUCKET);
  }
}

export async function deleteFile(key: string) {
  const client = createS3Client();
  if (client) {
    await client.removeObject(env.S3_BUCKET, key);
  } else {
    const target = path.join(env.STORAGE_DIR, key);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}
