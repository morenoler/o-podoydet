import { defineConfig, type Plugin } from "vite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";

function localLicenses(): Plugin {
  let directory: string;
  return {
    name: "local-third-party-licenses",
    apply: "build",
    configResolved(config) { directory = join(config.root, "licenses"); },
    generateBundle() {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile()) this.emitFile({
          type: "asset", fileName: `licenses/${entry.name}`,
          source: readFileSync(join(directory, entry.name)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), localLicenses()],
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: process.env.BUILD_OUT_DIR || "dist" },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    // Isolated builds and immutable backend JARs may be locked on Windows.
    watch: { ignored: ["**/.local/**", "**/server/target/**"] },
    proxy: {
      "/api": "http://127.0.0.1:" + (process.env.PORT || "8080"),
      "/uploads": "http://127.0.0.1:" + (process.env.PORT || "8080"),
    },
  },
});
