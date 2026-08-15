import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/family-edu/",
  server: {
    proxy: {
      "/api": "http://localhost:4100",
      "/mcp": "http://localhost:4100",
    },
  },
});
