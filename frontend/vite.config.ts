import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const version = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();

export default defineConfig({
  plugins: [react()],
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(version) },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Match the launcher's IPv4 loopback bind; localhost can resolve to ::1.
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
