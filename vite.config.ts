import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
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
