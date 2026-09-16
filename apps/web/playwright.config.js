import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  timeout: 30000,
  use: {
    baseURL: process.env.BASE_URL || "https://heyaagent.top/family-edu/",
    launchOptions: {
      executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
  },
});
