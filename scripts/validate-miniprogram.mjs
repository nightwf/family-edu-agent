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
const wxmlFiles = [];
const wxssFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".json")) {
      jsonFiles.push(full);
    } else if (entry.name.endsWith(".js")) {
      jsFiles.push(full);
    } else if (entry.name.endsWith(".wxml")) {
      wxmlFiles.push(full);
    } else if (entry.name.endsWith(".wxss")) {
      wxssFiles.push(full);
    }
  }
}

walk(root);

for (const file of jsonFiles) {
  JSON.parse(fs.readFileSync(file, "utf8"));
}

const appConfig = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const projectConfigPath = path.resolve("project.config.json");
if (fs.existsSync(projectConfigPath)) {
  JSON.parse(fs.readFileSync(projectConfigPath, "utf8"));
}
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

// 小程序的 WXML 不会被 node 校验，这里自己检查标签嵌套，避免提交后才在开发者工具里报错。
const VOID_TAGS = new Set([
  "input", "image", "icon", "progress", "switch", "slider", "checkbox", "radio",
  "canvas", "camera", "video", "audio", "map", "textarea", "import", "include",
  "wxs", "open-data",
]);

for (const file of wxmlFiles) {
  const source = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const stack = [];
  let line = 1;
  const tagPattern = /<(\/?)([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|\n/g;
  let match;
  while ((match = tagPattern.exec(source))) {
    if (match[0] === "\n") {
      line += 1;
      continue;
    }
    const [, closing, name, , selfClosing] = match;
    line += (match[0].match(/\n/g) || []).length;
    if (selfClosing || VOID_TAGS.has(name)) continue;
    if (closing) {
      const open = stack.pop();
      if (!open) throw new Error(`${file}:${line} 出现了多余的 </${name}>`);
      if (open.name !== name) {
        throw new Error(`${file}:${line} 标签错嵌套，第 ${open.line} 行的 <${open.name}> 与 </${name}> 不匹配`);
      }
    } else {
      stack.push({ name, line });
    }
  }
  if (stack.length) {
    throw new Error(`${file} 存在未闭合标签：${stack.map((item) => `<${item.name}>(第 ${item.line} 行)`).join(", ")}`);
  }
}

for (const file of wxssFiles) {
  const source = fs.readFileSync(file, "utf8");
  const open = (source.match(/\{/g) || []).length;
  const close = (source.match(/\}/g) || []).length;
  if (open !== close) {
    throw new Error(`${file} 的花括号不闭合：{ 出现 ${open} 次，} 出现 ${close} 次`);
  }
}

// class 引用检查：静态写死的 class 必须有样式定义，只提示不阻断。
const appWxss = fs.readFileSync(path.join(root, "app.wxss"), "utf8");
const classWarnings = [];
for (const file of wxmlFiles) {
  const source = fs.readFileSync(file, "utf8");
  const used = new Set();
  for (const attr of source.match(/class="[^"]*"/g) || []) {
    for (const name of attr.slice(7, -1).replace(/\{\{[\s\S]*?\}\}/g, " ").split(/\s+/)) {
      // 忽略 class 拼接片段，例如 "tone-{{item.tone}}" 会残留 "tone-"
      if (name && !name.endsWith("-")) used.add(name);
    }
  }
  if (!used.size) continue;
  const wxssPath = file.replace(/\.wxml$/, ".wxss");
  const localWxss = fs.existsSync(wxssPath) ? fs.readFileSync(wxssPath, "utf8") : "";
  const defined = new Set(
    (localWxss + appWxss).match(/\.[A-Za-z][\w-]*/g)?.map((item) => item.slice(1)) || [],
  );
  const missing = [...used].filter((name) => !defined.has(name));
  if (missing.length) classWarnings.push(`${file}: ${missing.join(", ")}`);
}

const tabPages = new Set((appConfig.tabBar?.list || []).map((item) => item.pagePath));
for (const tabPage of tabPages) {
  if (!appConfig.pages.includes(tabPage)) {
    throw new Error(`tabBar page not declared in pages: ${tabPage}`);
  }
}

if (classWarnings.length) {
  console.warn("警告：以下 class 在 WXML 中使用但没有样式定义（不影响编译）");
  for (const warning of classWarnings) console.warn(`  - ${warning}`);
}

console.log(
  `miniprogram validation passed: ${appConfig.pages.length} pages, ${jsonFiles.length} json, `
  + `${jsFiles.length} js, ${wxmlFiles.length} wxml, ${wxssFiles.length} wxss`,
);
