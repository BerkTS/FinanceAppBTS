import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = "http://127.0.0.1:8787";

const apiProxy = {
  target: apiTarget,
  changeOrigin: true,
  /** News aggregation can take >30s (GDELT spacing + upstream latency). */
  timeout: 180_000,
  proxyTimeout: 180_000,
};

export default defineConfig({
  plugins: [react()],
  server: {
    /** Listen on all interfaces so http://127.0.0.1:5173 and http://localhost:5173 both work. */
    host: true,
    port: 5173,
    /** If 5173 is taken (e.g. stale Vite), use the next free port instead of failing. */
    strictPort: false,
    proxy: {
      "/api": apiProxy,
    },
  },
  preview: {
    port: 4173,
    strictPort: false,
    proxy: {
      "/api": apiProxy,
    },
  },
});
