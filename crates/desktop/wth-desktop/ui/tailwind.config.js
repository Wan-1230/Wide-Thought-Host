/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#0d1117",
          1: "#161b22",
          2: "#1c2129",
          3: "#21262d",
          4: "#2a2f38",
        },
        accent: {
          blue: "#58a6ff",
          green: "#3fb950",
          orange: "#d2991d",
          red: "#f85149",
          purple: "#bc8cff",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "monospace"],
      },
    },
  },
  plugins: [],
};
