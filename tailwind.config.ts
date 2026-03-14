import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fdf8f0",
          100: "#faefd9",
          500: "#c4882a",
          600: "#a86f1c",
          700: "#8c5a14",
          900: "#4a2d08",
        },
      },
    },
  },
  plugins: [],
};

export default config;
