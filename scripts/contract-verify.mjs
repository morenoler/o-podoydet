// Проверка контракта одной командой: Spring собирается, поднимается на чистой схеме PostgreSQL,
// его ответы сравниваются с эталонами contract/snapshots/ (сняты со старого бэкенда при переносе),
// сервер останавливается.
//
//   npm run contract:verify
//
// Рабочую базу и запущенный npm run dev не трогает: Spring — на 8089 в отдельной новой схеме.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildBackend, ensureDatabase, startBackend } from "./backend.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const work = join(".local", "contract-runs", stamp);
const PORT = "8089";
const schema = `contract_${stamp}`;

/** Тот же DATABASE_URL, но с отдельной схемой. */
function withSchema(url) {
  if (!url) return undefined;
  const clean = url.replace(/([?&])currentSchema=[^&]*&?/, "$1").replace(/[?&]$/, "");
  return clean + (clean.includes("?") ? "&" : "?") + "currentSchema=" + schema;
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* ещё стартует */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Spring Boot не запустился за 60 секунд (порт 8089 занят или ошибка при старте)");
}

let server;
let exitCode = 1;
try {
  mkdirSync(join(root, work), { recursive: true });
  console.log("Сборка Spring…");
  await buildBackend("package -DskipTests");
  ensureDatabase();

  server = startBackend({
    env: {
      PORT,
      DB_SCHEMA: schema,
      ...(process.env.DATABASE_URL ? { DATABASE_URL: withSchema(process.env.DATABASE_URL) } : {}),
      DB_PATH: join(work, "no-legacy-import.sqlite3"), // чистая схема без переноса старых данных
      UPLOADS_PATH: join(work, "uploads"),
      FRONTEND_ORIGIN: "",
      LLM_API_KEY: "",
    },
    database: false, // база уже поднята выше
  });
  await waitFor(`http://127.0.0.1:${PORT}/api/health`);

  console.log(`\nКонтракт: Spring :${PORT} против эталонов contract/snapshots/\n`);
  exitCode = await new Promise((accept) => {
    const check = spawn(
      process.execPath,
      ["scripts/contract.mjs", "check", "--base", `http://127.0.0.1:${PORT}`],
      { cwd: root, stdio: "inherit", windowsHide: true },
    );
    check.once("exit", (code) => accept(code ?? 1));
  });
  console.log(
    exitCode === 0 ? "\nКонтракт соблюдён: ответы совпадают с эталонами." : "\nЕсть расхождения — пришлите вывод выше.",
  );
} catch (error) {
  console.error(error.message);
} finally {
  server?.kill();
  process.exitCode = exitCode;
}
