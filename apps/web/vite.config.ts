import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

/**
 * 把"这一版网页是哪个"落成一个静态文件，页面自己据此判断要不要提示更新。
 *
 * 版本号取入口脚本文件名里的内容哈希（Vite 已经算好的那个）。
 * 为什么不用构建时间或随机数：内容没变哈希就不变，一次只改了服务端的
 * 重新部署不会平白弹一个"有新版本"出来烦人；内容一变哈希必变。
 *
 * 同时塞进 index.html 的 <meta>：这样"页面自己是谁"和"服务器上是哪版"
 * 来自同一个来源，不会各说各话。
 */
function buildVersionPlugin(): Plugin {
  return {
    name: "heya-build-version",
    apply: "build",
    writeBundle(options, bundle) {
      const outDir = options.dir || path.resolve(process.cwd(), "dist");
      const htmlPath = path.join(outDir, "index.html");
      if (!fs.existsSync(htmlPath)) return;
      const entry = Object.values(bundle).find((item) => item.type === "chunk" && item.isEntry);
      const hash = entry?.fileName.match(/-([A-Za-z0-9_-]+)\.js$/)?.[1];
      // 取不到就退回文件名本身：宁可少省一次提示，也不能没有版本号
      const version = hash || entry?.fileName || String(Date.now());

      const html = fs.readFileSync(htmlPath, "utf8");
      if (!html.includes('name="app-version"')) {
        fs.writeFileSync(
          htmlPath,
          html.replace("</head>", `    <meta name="app-version" content="${version}" />\n  </head>`),
        );
      }
      fs.writeFileSync(
        path.join(outDir, "version.json"),
        `${JSON.stringify({ version, entry: entry?.fileName || "", builtAt: new Date().toISOString() }, null, 2)}\n`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), buildVersionPlugin()],
  base: "/family-edu/",
  server: {
    proxy: {
      "/api": "http://localhost:4100",
      "/mcp": "http://localhost:4100",
    },
  },
});
