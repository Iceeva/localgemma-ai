import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#0f1117", raised: "#161923", border: "#262b3a" },
        accent: { DEFAULT: "#6d7cff", soft: "#8b97ff" },
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "-apple-system", "Roboto", "sans-serif"],
        mono: ["Cascadia Code", "Consolas", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
