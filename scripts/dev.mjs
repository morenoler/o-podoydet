import { buildBackend, startBackend, runtimeEnv } from "./backend.mjs";
import { createServer } from "vite";

let backend;
let frontend;
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  await frontend?.close();
  backend?.kill();
  process.exitCode = code;
}
try {
  await buildBackend();
  runtimeEnv.FRONTEND_ORIGIN = "http://127.0.0.1:3000";
  backend = startBackend();
  backend.on("error", (e) => {
    console.error(e.message);
    void close(1);
  });
  backend.on("exit", (code) => {
    if (!closing) void close(code || 1);
  });
  const endpoint = `http://127.0.0.1:${process.env.PORT || "8080"}/api/health`;
  let ready = false;
  const startupDeadline = Date.now() + 90000;
  while (Date.now() < startupDeadline && !closing) {
    try {
      ready = (await fetch(endpoint, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      /* booting */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("Spring Boot API не запустился за 90 секунд");
  frontend = await createServer();
  await frontend.listen();
  frontend.printUrls();
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
} catch (e) {
  console.error(e.message);
  await close(1);
}
