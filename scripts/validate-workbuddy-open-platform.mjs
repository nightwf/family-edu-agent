import fs from "node:fs";
import path from "node:path";

const root = path.resolve("workbuddy-open-platform");
const connectorRoot = path.join(root, "connector", "heyah-family-education");
const expertRoot = path.join(root, "expert", "heyah-family-private-tutor");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const connectorMeta = readJson(path.join(connectorRoot, "connector-meta.json"));
const connectorMcp = readJson(path.join(connectorRoot, "mcp.json"));
const tokenSchema = readJson(path.join(connectorRoot, "token-schema.json"));
const expertPlugin = readJson(path.join(expertRoot, ".codebuddy-plugin", "plugin.json"));
const expertMcp = readJson(path.join(expertRoot, ".mcp.json"));

assert(connectorMeta.source === "heyah-family-education", "connector source must be stable kebab-case");
assert(connectorMeta.auth_mode === "token", "connector must use WorkBuddy local token auth");
assert(connectorMeta.minWorkbuddyVersion === "4.24.0", "connector minimum WorkBuddy version must cover bilingual examples and token auth");
assert(connectorMeta.examples_zh?.length >= 2 && connectorMeta.examples_en?.length >= 2, "connector needs bilingual examples");

const connectorServer = connectorMcp.mcpServers?.["heyah-family-education"];
assert(connectorServer?.url === "https://edu.skillstores.com/family-edu/mcp", "connector MCP URL is incorrect");
assert(connectorServer?.headers?.["X-MCP-Token"] === "${HEYA_FAMILY_TOKEN}", "connector must inject the family token through X-MCP-Token");
assert(tokenSchema.fields?.length === 1, "token form must contain exactly one family token field");
assert(tokenSchema.fields[0].key === "HEYA_FAMILY_TOKEN", "token form key must match mcp.json placeholder");
assert(tokenSchema.fields[0].type === "password" && tokenSchema.fields[0].required === true, "family token must be a required password field");

assert(expertPlugin.name === expertPlugin.plugin, "expert plugin and name must match");
assert(expertPlugin.expertType === "agent", "expertType must be agent");
assert(expertPlugin.categoryId === "15-Education", "expert must use the education category");
assert(expertPlugin.tags?.length === 3, "expert must define exactly three tags");
assert(expertPlugin.quickPrompts?.length === 3, "expert must define exactly three quick prompts");
assert(expertPlugin.defaultInitPrompt.zh === expertPlugin.quickPrompts[0].zh, "Chinese default prompt must match the first quick prompt");
assert(expertPlugin.defaultInitPrompt.en === expertPlugin.quickPrompts[0].en, "English default prompt must match the first quick prompt");
const descriptionLength = Array.from(expertPlugin.displayDescription.zh).length;
assert(descriptionLength >= 40 && descriptionLength <= 50, `expert Chinese description must be 40-50 characters, received ${descriptionLength}`);

const expertServer = expertMcp.mcpServers?.["heyah-family-education"];
assert(expertServer?.url === connectorServer.url, "expert and connector must use the same MCP URL");
assert(expertServer?.headers?.["X-MCP-Token"] === "${HEYA_FAMILY_TOKEN}", "expert must inject the family token through X-MCP-Token");
assert(expertServer?.["x-workbuddy"]?.auth?.type === "token", "expert must show the WorkBuddy token authorization card");

for (const relative of [
  "agents/heyah-family-private-tutor.md",
  "skills/heyah-family-private-tutor/SKILL.md",
  "skills/heyah-family-private-tutor/references/tool-workflows.md",
  "skills/heyah-family-private-tutor/references/safety-and-sync.md",
]) {
  assert(fs.existsSync(path.join(expertRoot, relative)), `expert package is missing ${relative}`);
}

const connectorSkill = fs.readFileSync(path.join(connectorRoot, "skills", "heyah-family-private-tutor", "SKILL.md"), "utf8");
const expertSkill = fs.readFileSync(path.join(expertRoot, "skills", "heyah-family-private-tutor", "SKILL.md"), "utf8");
assert(connectorSkill === expertSkill, "connector and expert Skill copies have drifted");
assert(connectorSkill.includes("get_agent_bootstrap"), "Skill must instruct WorkBuddy to bootstrap the family context");

const avatarPath = path.join(expertRoot, "avatars", "expert.png");
const avatar = fs.readFileSync(avatarPath);
assert(avatar.length <= 500 * 1024, "expert avatar must be no larger than 500KB");
assert(avatar.readUInt32BE(16) === 512 && avatar.readUInt32BE(20) === 512, "expert avatar must be 512x512");

const packageText = [
  fs.readFileSync(path.join(connectorRoot, "mcp.json"), "utf8"),
  fs.readFileSync(path.join(connectorRoot, "token-schema.json"), "utf8"),
  fs.readFileSync(path.join(expertRoot, ".mcp.json"), "utf8"),
  connectorSkill,
].join("\n");
assert(!/AKID[A-Za-z0-9]{20,}|SecretKey\s*[:=]\s*[^$\s]/i.test(packageText), "package appears to contain a real credential");

console.log(`WorkBuddy packages validated: connector 1.0.0, expert 1.0.0, avatar ${avatar.length} bytes`);
