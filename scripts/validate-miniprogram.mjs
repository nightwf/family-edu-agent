import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve("miniprogram");
if (!fs.existsSync(root)) {
  console.error("miniprogram directory not found");
  process.exit(1);
}

const jsonFiles = [];
const jsFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".json")) {
      jsonFiles.push(full);
    } else if (entry.name.endsWith(".js")) {
      jsFiles.push(full);
    }
  }
}

walk(root);

for (const file of jsonFiles) {
  JSON.parse(fs.readFileSync(file, "utf8"));
}

const appConfig = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
for (const page of appConfig.pages) {
  for (const extension of ["js", "wxml", "wxss", "json"]) {
    const file = path.join(root, `${page}.${extension}`);
    if (!fs.existsSync(file)) {
      throw new Error(`missing page file: ${file}`);
    }
  }
}

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`JS syntax error in ${file}\n${result.stderr}`);
  }
}

const tabPages = new Set((appConfig.tabBar?.list || []).map((item) => item.pagePath));
for (const tabPage of tabPages) {
  if (!appConfig.pages.includes(tabPage)) {
    throw new Error(`tabBar page not declared in pages: ${tabPage}`);
  }
}

console.log(`miniprogram validation passed: ${appConfig.pages.length} pages, ${jsonFiles.length} json, ${jsFiles.length} js`);
