import fs from "node:fs";
import path from "node:path";
import { Client } from "minio";
import { env } from "./env.js";
function createS3Client() {
    if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY)
        return null;
    return new Client({
        endPoint: env.S3_ENDPOINT,
        port: env.S3_PORT || undefined,
        accessKey: env.S3_ACCESS_KEY,
        secretKey: env.S3_SECRET_KEY,
        useSSL: env.S3_USE_SSL,
        pathStyle: env.S3_ENDPOINT === "minio",
    });
}
export async function saveFile(key, buffer, contentType = "application/octet-stream") {
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
    if (!client)
        return;
    const exists = await client.bucketExists(env.S3_BUCKET).catch(() => false);
    if (!exists) {
        try {
            await client.makeBucket(env.S3_BUCKET);
        }
        catch (error) {
            const code = error?.code;
            if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") {
                throw error;
            }
        }
    }
}
export async function deleteFile(key) {
    const client = createS3Client();
    if (client) {
        await client.removeObject(env.S3_BUCKET, key);
    }
    else {
        const target = path.join(env.STORAGE_DIR, key);
        if (fs.existsSync(target))
            fs.unlinkSync(target);
    }
}
export async function openFile(fileKey) {
    const client = createS3Client();
    const s3Match = /^s3:\/\/([^/]+)\/(.+)$/.exec(fileKey);
    if (s3Match) {
        if (!client)
            throw new Error("对象存储未配置");
        return client.getObject(s3Match[1], s3Match[2]);
    }
    const storageRoot = path.resolve(env.STORAGE_DIR);
    const target = path.resolve(fileKey);
    if (target !== storageRoot && !target.startsWith(`${storageRoot}${path.sep}`))
        throw new Error("无效的文件路径");
    if (!fs.existsSync(target))
        throw new Error("文件不存在");
    return fs.createReadStream(target);
}
