// Portable synthetic fixture for direct PostgreSQL import; no SQLite or database client.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const localDemoPath = resolve(root, ".local/demo-seed.json");
export const kind = "opodoydet-synthetic-demo-json-v1";

export function demoToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function validateDemoSeed(value) {
  if (value?.kind !== kind || value.is_demo !== true || value.fixtures?.version !== 2)
    throw new Error("Это не синтетический JSON-образец демо.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.seedDate) || new Date(`${value.seedDate}T12:00:00Z`).toISOString().slice(0, 10) !== value.seedDate)
    throw new Error("Некорректная календарная дата.");
  const fixtures = value.fixtures;
  if (value.fixtureSha256 !== createHash("sha256").update(JSON.stringify(fixtures)).digest("hex"))
    throw new Error("SHA-256 синтетического образца не совпадает.");
  if (!Array.isArray(fixtures.accounts) || fixtures.accounts.length !== 2 || !fixtures.accounts.every(account => account.email.endsWith(".test")))
    throw new Error("Демо должно содержать только два учебных аккаунта .test.");
  if (!Array.isArray(fixtures.listings) || fixtures.listings.length !== 8 || !fixtures.listings.every(listing => listing.demo === true && listing.photos.length === 0))
    throw new Error("Все учебные объявления должны иметь demo=true и не содержать фотографий.");
  if (!Array.isArray(fixtures.bookings) || fixtures.bookings.length !== 6 || !Array.isArray(fixtures.questions) || fixtures.questions.length !== 6)
    throw new Error("Неожиданный состав учебных поездок или вопросов.");
  return { seedDate: value.seedDate, counts: { account_users: 2, account_listings: 8, account_bookings: 6, account_questions: 6, account_sessions: 0, advisor_runs: 0 } };
}

export function readDemoSeed(path) {
  return validateDemoSeed(JSON.parse(readFileSync(path, "utf8")));
}

export function seedDemoJson({ output = localDemoPath, date = demoToday() } = {}) {
  const path = resolve(root, output);
  const within = relative(root, path).replaceAll("\\", "/");
  if (isAbsolute(within) || within.startsWith("../") || !within.endsWith(".json") ||
      !(within.startsWith(".local/demo-") || within.startsWith(".local/demo/") || within.startsWith("data/demo/")))
    throw new Error("Демо JSON должен находиться в data/demo/ или .local/demo*. Основные базы недоступны этому скрипту.");
  const fixtures = JSON.parse(readFileSync(resolve(root, "data/demo/fixtures.json"), "utf8"));
  const seed = { kind, is_demo: true, seedDate: date, fixtureSha256: createHash("sha256").update(JSON.stringify(fixtures)).digest("hex"), fixtures };
  const report = validateDemoSeed(seed);
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, JSON.stringify(seed, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Файл уже существует. Перезапись запрещена.");
    throw error;
  }
  return { path, ...report };
}
