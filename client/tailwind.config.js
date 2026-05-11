/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        surface: {
          DEFAULT: "#0c0f14",
          card: "#121722",
          border: "#1e2636",
        },
        accent: {
          DEFAULT: "#3b82f6",
          dim: "#2563eb",
        },
        muted: "#8b9cb5",
      },
    },
  },
  plugins: [],
};
