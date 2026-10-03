import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
