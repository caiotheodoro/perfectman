import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Matches `DEFAULT_PORT` in `packages/server/src/http/bootstrap.ts`. */
const API_ORIGIN = process.env["PERFECTMAN_WEB_API"] ?? "http://localhost:4317";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5317,
    // Same-origin in dev, so `EventSource("/api/...")` needs no CORS dance and
    // the built bundle — which the server hosts itself — uses identical URLs.
    proxy: {
      "/api": { target: API_ORIGIN, changeOrigin: true, ws: false },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
