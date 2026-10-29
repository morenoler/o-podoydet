import { existsSync, mkdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  demoToday,
  localDemoPath,
  root,
  seedDemoJson,
  readDemoSeed,
} from "./demo-seed.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

try {
  const action = process.argv[2];
  if (action === "seed" || action === "setup") {
    const argumentsAllowed = new Set(["--date", "--output"]);
    for (let index = 3; index < process.argv.length; index += 2)
      if (
        !argumentsAllowed.has(process.argv[index]) ||
        !process.argv[index + 1]
      )
        throw new Error(
          "Ожидаются --date YYYY-MM-DD и --output путь к новому JSON-образцу.",
        );
    const options = { date: option("--date") || demoToday(), ...(option("--output") ? { output: option("--output") } : {}) };
    const result = seedDemoJson(options);
    console.log(
      `Создан синтетический JSON-образец: ${relative(root, result.path)}. Дата примеров: ${result.seedDate}.`,
    );
    console.log(
      `${result.counts.account_users} аккаунта, ${result.counts.account_listings} объявлений, ${result.counts.account_bookings} поездок, ${result.counts.account_questions} вопросов. Сессии и история ИИ отсутствуют.`,
    );
    if (action === "setup")
      console.log(
        "Запуск: npm run demo:start. Учебные аккаунты перечислены в docs/DEMO.md.",
      );
  } else if (action === "start") {
    if (process.argv.length > 3)
      throw new Error(
        "Для порта задайте DEMO_PORT; другие аргументы запуска не поддерживаются.",
      );
    if (process.env.DEMO_DB_PATH)
      throw new Error("DEMO_DB_PATH относится к прежней SQLite. Для JSON используйте DEMO_SEED_PATH; старую базу переносите явно через LEGACY_DB_PATH и сборку -Plegacy-import.");
    const demoPath = resolve(root, process.env.DEMO_SEED_PATH || localDemoPath);
    if (!existsSync(demoPath))
      throw new Error("Сначала выполните npm run demo:setup.");
    readDemoSeed(demoPath);
    if (!existsSync(resolve(root, "dist/index.html")))
      throw new Error(
        "Сначала выполните npm run build:all: демо использует основную сборку dist/.",
      );
    const port = Number(process.env.DEMO_PORT || "8082");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("DEMO_PORT должен быть числом от 1 до 65535.");
    const demoSchema = process.env.DEMO_DB_SCHEMA || "demo";
    if (demoSchema === (process.env.DB_SCHEMA || "public"))
      throw new Error("Схема демо должна отличаться от схемы основного сайта.");
    Object.assign(process.env, {
      PORT: String(port),
      LEGACY_DB_PATH: "",
      DEMO_SEED_PATH: demoPath,
      DEMO_MODE: "true",
      DB_SCHEMA: demoSchema,
      UPLOADS_PATH: resolve(root, ".local/demo-uploads"),
      DIST_PATH: "dist",
      DATA_PATH: "data/verified-hotels.json",
      LAB_MODE: "false",
      ACCOUNT_MODE: "true",
      SESSION_COOKIE_SECURE: "false",
      FRONTEND_ORIGIN: "",
      LLM_API_KEY: "",
      AI_PROVIDER: "rules",
    });
    mkdirSync(process.env.UPLOADS_PATH, { recursive: true });
    // Import after setting the environment: backend.mjs snapshots it for the child JVM.
    const { startBackend } = await import("./backend.mjs");
    const child = startBackend();
    console.log(
      `Демо с публичными учебными паролями: http://127.0.0.1:${port}. Только локальная проверка.`,
    );
    child.once("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.once("exit", (code) => {
      process.exitCode = code ?? 1;
    });
    process.on("SIGINT", () => child.kill());
    process.on("SIGTERM", () => child.kill());
  } else throw new Error("Используйте demo.mjs seed, setup или start.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
