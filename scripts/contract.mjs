#!/usr/bin/env node
// Контракт API: эталонные ответы (contract/snapshots/) независимой сборки исходного main.
// Commit, JAR SHA-256, входные данные и время эталона записаны в contract/baseline.json.
//
//   node scripts/contract.mjs check   --base http://127.0.0.1:8080        сравнить сервер с эталонами
//   node scripts/contract.mjs capture --base http://127.0.0.1:8080        переснять эталоны (осознанное изменение API)
//   node scripts/contract.mjs diff    --base URL --against URL            сравнить два живых сервера
//
// contract:verify фиксирует Clock отдельным Spring-профилем contract.
// При сравнении самостоятельно запущенных серверов согласуйте время и снимки данных.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readSnapshot, writeSnapshot, snapshotDigest } from "./contract-files.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(readFileSync(join(root, "contract", "requests.json"), "utf8"));
const snapshots = join(root, "contract", "snapshots");

// Поля, которые законно меняются от запуска к запуску. Значение заменяется на "<volatile>".
const VOLATILE_KEYS = new Set([
  "searchId", "runId", "createdAt", "updatedAt", "expiresAt", "startedAt", "finishedAt",
  "lastSeenAt", "loggedInAt", "requestedAt", "answeredAt", "checkedAt", "generatedAt",
  "durationMs", "elapsedMs", "tookMs",
]);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function parseContractArguments(argv = process.argv.slice(2)) {
  const [mode, ...rest] = argv;
  const options = { mode };
  for (let i = 0; i < rest.length; i += 2) {
    if (!["--base", "--against", "--only"].includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith("--"))
      throw new Error("Ожидаются --base URL, --against URL или --only имена-запросов.");
    options[rest[i].slice(2)] = rest[i + 1];
  }
  if (!["capture", "check", "diff"].includes(mode) || !options.base || (mode === "diff" && !options.against)) {
    throw new Error("Использование: contract.mjs capture|check --base URL  |  diff --base URL --against URL");
  }
  if (options.only) {
    options.only = new Set(options.only.split(","));
    const known = new Set(spec.requests.map(({ name }) => name));
    const unknown = [...options.only].filter((name) => !known.has(name));
    if (unknown.length) throw new Error(`Неизвестные имена запросов --only: ${unknown.join(", ")}`);
  }
  return options;
}

/** Подставляет {{run}} и значения, сохранённые из прошлых ответов ({{listingId}} и т. п.). */
function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (all, key) => (key in vars ? vars[key] : all));
}

/** Тело запроса: JSON, «сырая» строка или файл (фото). */
function body(request, vars) {
  if (request.bodyFile) return { bytes: readFileSync(join(root, request.bodyFile)), type: request.contentType };
  if (request.raw !== undefined) return { bytes: request.raw, type: "application/json" };
  if (request.trip) return { bytes: JSON.stringify({ ...spec.trip, ...request.trip }), type: "application/json" };
  if (request.body) return { bytes: fill(JSON.stringify(request.body), vars), type: "application/json" };
  return undefined;
}

/** Значение по пути вида $.a.0.b из разобранного ответа. */
function pick(value, path) {
  return path.replace(/^\$\.?/, "").split(".").filter(Boolean).reduce((v, k) => (v == null ? v : v[k]), value);
}

/** Выполняет все запросы на одном сервере; cookie живут в рамках session. */
async function runAll(base, options) {
  const run = randomUUID().slice(0, 8);
  const vars = { run };
  const jars = new Map();
  const results = new Map();
  for (const request of spec.requests) {
    if (options.only && !options.only.has(request.name)) continue;
    const payload = body(request, vars);
    const headers = {};
    if (payload !== undefined) headers["Content-Type"] = payload.type;
    for (const [k, v] of Object.entries(request.headers ?? {})) headers[k] = fill(v, vars);
    if (request.session && jars.get(request.session)) headers.Cookie = jars.get(request.session);
    let response;
    try {
      response = await fetch(base.replace(/\/$/, "") + fill(request.path, vars), {
        method: request.method,
        headers,
        body: payload?.bytes,
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      results.set(request.name, { status: "NETWORK", body: String(error.cause ?? error), servedBy: "-" });
      continue;
    }
    if (request.session) {
      const cookies = response.headers.getSetCookie().map((c) => c.split(";")[0]);
      if (cookies.length) {
        const jar = new Map((jars.get(request.session) ?? "").split("; ").filter(Boolean).map((c) => c.split("=")));
        for (const c of cookies) {
          const [k, ...v] = c.split("=");
          jar.set(k, v.join("="));
        }
        jars.set(request.session, [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      }
    }
    const contentType = response.headers.get("content-type") ?? "";
    let parsed;
    if (contentType.includes("json")) {
      const text = await response.text();
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { "<text>": text.slice(0, 2000) };
      }
    } else {
      // Фото и прочие файлы сравниваем по типу и размеру.
      const bytes = new Uint8Array(await response.arrayBuffer());
      parsed = { "<binary>": bytes.length, contentType };
    }
    for (const [key, path] of Object.entries(request.capture ?? {})) {
      const value = pick(parsed, path);
      if (value !== undefined && value !== null) vars[key] = String(value);
    }
    results.set(request.name, {
      status: response.status,
      body: normalize(parsed, run),
      servedBy: response.headers.get("x-served-by") ?? "legacy-direct",
    });
  }
  return results;
}

function normalize(value, run) {
  if (Array.isArray(value)) return value.map((v) => normalize(v, run));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value))
      out[k] = VOLATILE_KEYS.has(k) && v !== null ? "<volatile>" : normalize(v, run);
    return out;
  }
  if (typeof value === "string") return value.replaceAll(run, "<run>").replace(UUID, "<uuid>");
  return value;
}

/** Список расхождений в виде путей JSON. */
function ignoresPath(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix + ".") || path.startsWith(prefix + "["));
}

export function differences(expected, actual, path = "$", out = [], valueChanges = [], ignoredPaths = []) {
  // Ignore approved subtrees before limiting diagnostics: otherwise allowed
  // changes can consume the limit and hide a later incompatible field.
  if (ignoresPath(path, ignoredPaths)) return out;
  if (out.length > 20) return out;
  // Exact scalar transition at one exact path; never skip the rest of a trace object.
  if (valueChanges.some((change) => change.path === path
      && Object.is(change.from, expected) && Object.is(change.to, actual))) return out;
  if (typeof expected !== typeof actual || Array.isArray(expected) !== Array.isArray(actual) || (expected === null) !== (actual === null)) {
    out.push(`${path}: ${short(expected)} → ${short(actual)}`);
  } else if (Array.isArray(expected)) {
    if (expected.length !== actual.length) out.push(`${path}.length: ${expected.length} → ${actual.length}`);
    for (let i = 0; i < Math.min(expected.length, actual.length); i++) differences(expected[i], actual[i], `${path}[${i}]`, out, valueChanges, ignoredPaths);
  } else if (expected && typeof expected === "object") {
    for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (ignoresPath(`${path}.${k}`, ignoredPaths)) continue;
      if (!(k in actual)) out.push(`${path}.${k}: пропало поле`);
      else if (!(k in expected)) continue; // новые поля разрешены: фронт их игнорирует
      else differences(expected[k], actual[k], `${path}.${k}`, out, valueChanges, ignoredPaths);
    }
  } else if (expected !== actual) out.push(`${path}: ${short(expected)} → ${short(actual)}`);
  return out;
}

const short = (v) => {
  const s = JSON.stringify(v);
  return s === undefined ? "undefined" : s.length > 80 ? s.slice(0, 77) + "..." : s;
};

const allowed = new Map(spec.requests.map((r) => [r.name, r.allowChanges ?? []]));
const allowedValues = new Map(spec.requests.map((r) => [r.name, r.allowValueChanges ?? []]));

function compare(expected, actual) {
  let failed = 0;
  let total = 0;
  for (const [name, want] of expected) {
    const got = actual.get(name);
    if (!got) continue;
    total++;
    const problems = [];
    if (want.status !== got.status) problems.push(`HTTP ${want.status} → ${got.status}`);
    // Прежние исключения по путям проверяются отдельно от точных переходов значений.
    const skip = allowed.get(name) ?? [];
    problems.push(
      ...differences(want.body, got.body, "$", [], allowedValues.get(name) ?? [], skip),
    );
    if (problems.length) {
      failed++;
      console.log(`✗ ${name}`);
      for (const p of problems.slice(0, 12)) console.log(`    ${p}`);
      if (problems.length > 12) console.log(`    … ещё ${problems.length - 12}`);
    } else console.log(`✓ ${name}`);
  }
  console.log(`\n${total - failed}/${total} совпадают с эталонами`);
  return failed;
}

async function main() {
  const options = parseContractArguments();
  if (options.mode === "capture") {
    mkdirSync(snapshots, { recursive: true });
    const results = await runAll(options.base, options);
    const broken = [...results].filter(([, r]) => r.status === "NETWORK" || r.status >= 500);
    if (broken.length) {
      throw new Error("Эталоны не изменены: ошибки сервера в " + broken.map(([n]) => n).join(", "));
    }
    for (const [name, { status, body }] of results) writeSnapshot(snapshots, name, { status, body });
    const manifest = Object.fromEntries(spec.requests.map(({ name }) => [name, snapshotDigest(readSnapshot(snapshots, name))]));
    writeFileSync(join(root, "contract", "snapshots-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Сохранено эталонов: ${results.size} → contract/snapshots/`);
  } else if (options.mode === "check") {
    const expected = new Map();
    for (const r of spec.requests) {
      if (options.only && !options.only.has(r.name)) continue;
      expected.set(r.name, JSON.parse(readSnapshot(snapshots, r.name).toString("utf8")));
    }
    process.exit(compare(expected, await runAll(options.base, options)) ? 1 : 0);
  } else {
    const [left, right] = await Promise.all([runAll(options.base, options), runAll(options.against, options)]);
    process.exit(compare(left, right) ? 1 : 0);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
