export async function readUploadedFile(request, field = "file") {
    const part = request.body?.[field];
    if (part && typeof part.toBuffer === "function") {
        const buffer = await part.toBuffer();
        return {
            buffer,
            filename: String(part.filename || ""),
            mimetype: String(part.mimetype || "application/octet-stream"),
        };
    }
    // 防御性分支：一旦哪天改成非 attachFieldsToBody 模式，这里仍能取到文件。
    const legacy = request.file;
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
