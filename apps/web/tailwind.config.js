export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 与小程序共用一套配色，保证两端视觉一致
        ink: "#203238",
        "ink-soft": "#34474d",
        muted: "#728186",
        cream: "#f7f1df",
        panel: "#fffdf7",
        accent: "#c9503a",
        "accent-soft": "#fff0eb",
        teal: "#0f766e",
        "teal-deep": "#205159",
        "teal-soft": "#e4f3ef",
        gold: "#f3c969",
        "gold-soft": "#fff4cf",
        line: "#e8ddc5",
        "line-soft": "#f1eadb",
      },
    },
  },
  plugins: [],
};
