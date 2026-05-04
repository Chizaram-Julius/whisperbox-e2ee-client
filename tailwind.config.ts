import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        signal: "#0f766e",
        "signal-dark": "#115e59",
        paper: "#f7f8f5",
      },
      boxShadow: {
        panel: "0 16px 50px rgba(17, 24, 39, 0.10)",
      },
    },
  },
  plugins: [],
} satisfies Config;
