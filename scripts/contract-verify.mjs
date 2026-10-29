// Проверка контракта одной командой: Spring собирается, поднимается на чистой схеме PostgreSQL,
// его ответы сравниваются с эталонами contract/snapshots/ (сняты со старого бэкенда при переносе),
// сервер останавливается.
//
//   npm run contract:verify
//
// Рабочую базу и запущенный npm run dev не трогает: Spring — на 8089 в отдельной новой схеме.
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { buildBackend, ensureDatabase, startBackend } from "./backend.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const baseline = JSON.parse(readFileSync(join(root, "contract", "baseline.json"), "utf8"));
if (typeof baseline.clockInstant !== "string" || !Number.isFinite(Date.parse(baseline.clockInstant)))
  throw new Error("contract/baseline.json должен содержать корректный clockInstant исходного эталона");
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14)
  + "_" + randomUUID().replaceAll("-", "").slice(0, 12);
const work = join(".local", "contract-runs", stamp);
const PORT = "8089";
const schema = `contract_${stamp}`;

async function requireFreePort() {
  const probe = createServer();
  await new Promise((accept, reject) => {
    probe.once("error", () => reject(new Error("Порт 8089 занят: существующий сервер проверять нельзя")));
    probe.listen(Number(PORT), "127.0.0.1", accept);
  });
  await new Promise((accept, reject) => probe.close((error) => error ? reject(error) : accept()));
}

async function waitFor(url) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error("Spring Boot завершился до проверки готовности");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* ещё стартует */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Spring Boot не запустился за 90 секунд");
}

let server;
let exitCode = 1;
try {
  mkdirSync(join(root, work), { recursive: true });
  await requireFreePort();
  console.log("Сборка Spring…");
  await buildBackend("package -DskipTests");
  ensureDatabase();

  server = startBackend({
    env: {
      PORT,
      SPRING_PROFILES_ACTIVE: "contract",
      CONTRACT_INSTANT: baseline.clockInstant,
      DB_SCHEMA: schema,
      LEGACY_DB_PATH: "", // чистая схема без переноса старых данных
      DEMO_SEED_PATH: "",
      DEMO_MODE: "false",
      UPLOADS_PATH: join(work, "uploads"),
      ACCOUNT_MODE: "true",
      LAB_MODE: "false",
      SESSION_COOKIE_SECURE: "false",
      CATALOG_IMPORT: "true",
      DATA_PATH: "data/verified-hotels.json",
      AREA_DATA_PATH: "data/area-assessments.json",
      NOISE_DATA_PATH: "data/noise-context.json",
      TRAFFIC_DATA_PATH: "data/traffic-ktdb-2024.json",
      FRONTEND_ORIGIN: "",
      LLM_API_KEY: "",
      AI_PROVIDER: "rules",
      DEEPSEEK_API_KEY: "",
      LLM_MODEL: "",
      ADVISOR_LOCAL_MODEL: "",
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
    check.once("error", (error) => { console.error(error.message); accept(1); });
    check.once("exit", (code) => accept(code ?? 1));
  });
  console.log(
    exitCode === 0 ? "\nКонтракт соблюдён: ответы совпадают с эталонами." : "\nЕсть расхождения — пришлите вывод выше.",
  );
} catch (error) {
  console.error(error.message);
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  process.exitCode = exitCode;
}
