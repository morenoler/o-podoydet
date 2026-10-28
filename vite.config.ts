import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: process.env.BUILD_OUT_DIR || "dist" },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:" + (process.env.PORT || "8080"),
      "/uploads": "http://127.0.0.1:" + (process.env.PORT || "8080"),
    },
  },
});
