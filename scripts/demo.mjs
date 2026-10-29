import { existsSync, mkdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { accountDemoEnvironment } from "./local-runtime.mjs";
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
    Object.assign(process.env, accountDemoEnvironment(process.env, root, demoPath));
    mkdirSync(process.env.UPLOADS_PATH, { recursive: true });
    // Import after setting the environment: backend.mjs snapshots it for the child JVM.
    const { startBackend } = await import("./backend.mjs");
    const child = startBackend();
    console.log(
      `Демо с публичными учебными паролями: http://127.0.0.1:${process.env.PORT}. Только локальная проверка.`,
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
