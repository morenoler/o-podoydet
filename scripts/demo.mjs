import { existsSync, mkdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  demoToday,
  localDemoPath,
  root,
  seedDemoDatabase,
  setupDemoDatabase,
  validateDemoDatabase,
} from "./demo-data.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

try {
  const action = process.argv[2];
  if (action === "seed" || action === "setup") {
    const argumentsAllowed = new Set(
      action === "seed" ? ["--date", "--output"] : ["--date"],
    );
    for (let index = 3; index < process.argv.length; index += 2)
      if (
        !argumentsAllowed.has(process.argv[index]) ||
        !process.argv[index + 1]
      )
        throw new Error(
          "Ожидаются --date YYYY-MM-DD и, только для seed, --output путь к новой демо-базе.",
        );
    const options = { date: option("--date") || demoToday() };
    const result =
      action === "seed"
        ? seedDemoDatabase({
            ...options,
            ...(option("--output") ? { output: option("--output") } : {}),
          })
        : setupDemoDatabase(options);
    console.log(
      `Создана синтетическая демо-база: ${relative(root, result.path)}. Дата примеров: ${result.seedDate}.`,
    );
    console.log(
      "2 аккаунта, 4 объявления, 6 поездок, 6 вопросов. Сессии и история ИИ отсутствуют.",
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
    if (!existsSync(localDemoPath))
      throw new Error("Сначала выполните npm run demo:setup.");
    validateDemoDatabase(localDemoPath, { strict: false });
    if (!existsSync(resolve(root, "dist/index.html")))
      throw new Error(
        "Сначала выполните npm run build:all: демо использует основную сборку dist/.",
      );
    const port = Number(process.env.DEMO_PORT || "8082");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("DEMO_PORT должен быть числом от 1 до 65535.");
    Object.assign(process.env, {
      PORT: String(port),
      DB_PATH: localDemoPath, // переносится в схему demo при первом старте
      DB_SCHEMA: "demo",
      UPLOADS_PATH: resolve(root, ".local/demo-uploads"),
      DIST_PATH: "dist",
      DATA_PATH: "data/verified-hotels.json",
      LAB_MODE: "false",
      ACCOUNT_MODE: "true",
      SESSION_COOKIE_SECURE: "false",
      FRONTEND_ORIGIN: "",
      LLM_API_KEY: "",
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
