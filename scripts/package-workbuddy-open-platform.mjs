import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve("workbuddy-open-platform");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });

const validation = spawnSync(process.execPath, ["scripts/validate-workbuddy-open-platform.mjs"], { stdio: "inherit" });
if (validation.status !== 0) process.exit(validation.status || 1);

const packages = [
  {
    cwd: path.join(root, "connector"),
    source: "heyah-family-education",
    target: path.join(dist, "heyah-family-education-connector.zip"),
  },
  {
    cwd: path.join(root, "expert"),
    source: "heyah-family-private-tutor",
    target: path.join(dist, "heyah-family-private-tutor-expert.zip"),
  },
  {
    source: ["SKILL.md", "references"],
    cwd: path.join(root, "connector", "heyah-family-education", "skills", "heyah-family-private-tutor"),
    target: path.join(dist, "heyah-family-private-tutor-skill.zip"),
  },
];

for (const item of packages) {
  if (fs.existsSync(item.target)) fs.unlinkSync(item.target);
  const sources = Array.isArray(item.source) ? item.source : [item.source];
  const result = spawnSync("zip", ["-q", "-r", item.target, ...sources], { cwd: item.cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`failed to package ${sources.join(", ")}`);
}

console.log(`WorkBuddy upload packages created in ${dist}`);
