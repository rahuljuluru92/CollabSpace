/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0f1a",
        slate: "#0f172a",
        fog: "#eef2ff",
        neon: "#22d3ee",
        lime: "#a3e635",
        coral: "#fb7185"
      },
      fontFamily: {
        display: ["\"Space Grotesk\"", "system-ui", "sans-serif"],
        body: ["\"IBM Plex Sans\"", "system-ui", "sans-serif"]
      },
      boxShadow: {
        glow: "0 0 40px rgba(34, 211, 238, 0.35)"
      }
    }
  },
  plugins: []
};
