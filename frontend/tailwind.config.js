/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // CounterScout: charcoal/slate surfaces and a restrained sea-glass accent.
        // Semantic match/grenade colors stay distinct from navigation branding.
        scout: {
          bg: "#0b1118",
          panel: "#131e28",
          card: "#182530",
          cardHi: "#21333f",
          // Borders switch to near-white-at-low-alpha via hex. Tailwind v3
          // opacity shorthand (border-scout-border/60 etc.) continues to work.
          border: "#324454",
          borderHi: "#4a6274",
          text: "#e7eef5",
          muted: "#9aaabd",
          accent: "#5ee0c2",
          accentHot: "#2dbfa4",
          gold: "#f0a500",
          green: "#34d399",
          red: "#f87171",
          blue: "#60a5fa",
          smoke: "#cbd5e1",
          flash: "#fde047",
          molotov: "#fb923c",
          he: "#f87171",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        glow: "0 0 30px rgba(94, 224, 194, 0.15)",
        glowHi: "0 0 40px rgba(94, 224, 194, 0.35)",
        card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 20px 40px -20px rgba(0,0,0,0.8)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(rgba(94, 224, 194,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(94, 224, 194,0.04) 1px, transparent 1px)",
        "card-gradient":
          "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 50%)",
      },
    },
  },
  plugins: [],
};
