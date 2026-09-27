import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}"],
  theme: {
    extend: {
      borderRadius: {
        sm: "0.25rem",
        DEFAULT: "0.375rem",
        md: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
      },
      colors: {
        brand: {
          DEFAULT: "#2d6a4f",
          dark: "#1b4332",
          light: "#95d5b2",
          50: "#f1faf4",
          100: "#dff3e6",
        },
        ink: {
          DEFAULT: "#000000",
          soft: "#000000",
          mute: "#000000",
        },
        surface: {
          DEFAULT: "#ffffff",
          soft: "#fcfcfd",
          line: "#eef0f3",
        },
        warn: "#b45309",
        danger: "#b91c1c",
        ok: "#15803d",
        // 会員コミュニティ（Slack と同じ配色）
        sk: {
          frame: "#350D36",
          side: "#3F0E40",
          hover: "#350D36",
          active: "#1164A3",
          presence: "#2BAC76",
          badge: "#CD2553",
          text: "#1D1C1D",
          mute: "#616061",
          line: "#DDDDDD",
          soft: "#F8F8F8",
          link: "#1264A3",
          green: "#007A5A",
          greenhover: "#148567",
          yellow: "#FEF9ED",
          red: "#E01E5A",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-noto-sans-jp)",
          "Noto Sans JP",
          "Hiragino Sans",
          "Hiragino Kaku Gothic ProN",
          "Meiryo",
          "system-ui",
          "sans-serif",
        ],
        serif: [
          "var(--font-noto-serif-jp)",
          "Noto Serif JP",
          "Georgia",
          "serif",
        ],
        brand: [
          "var(--font-pacifico)",
          "Pacifico",
          "cursive",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
