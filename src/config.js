import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKBUDDY_PROMPT } from "./workbuddy-spec.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data");
export const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "db.json");
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");
export const WEB_DIR = path.join(ROOT, "apps", "web");

export const PORT = Number(process.env.PORT || 4100);
export const INVITE_CODES = new Set(
  (process.env.INVITE_CODES || "HE-2026,JOJO-2026")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
);

export const DEMO_EMAIL = process.env.DEMO_EMAIL || "jojo@example.com";
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "123456";

export { WORKBUDDY_PROMPT };
