import { buildApp } from "./app.js";
import { env } from "./env.js";
import { ensureStorageBucket } from "./storage.js";
import { ensureBaseSkillVersions } from "./personalization.js";
await ensureStorageBucket();
await ensureBaseSkillVersions();
const app = await buildApp();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
console.log(`[family-edu-agent] API running at http://localhost:${env.PORT}`);
