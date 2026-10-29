import {
  existsSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tools = join(root, ".local", "tools");
const folders = existsSync(tools) ? readdirSync(tools) : [];
const localJdk = folders.find((n) => n.startsWith("jdk-21"));
const localMaven = folders.find((n) => n.startsWith("apache-maven-"));
const javaHome = process.env.JAVA_HOME || (localJdk && join(tools, localJdk));
export const runtimeEnv = {
  ...process.env,
  MAVEN_BASEDIR: root,
  ...(javaHome
    ? {
        JAVA_HOME: javaHome,
        PATH:
          join(javaHome, "bin") +
          (process.platform === "win32" ? ";" : ":") +
          process.env.PATH,
      }
    : {}),
};
const java = javaHome
  ? join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java")
  : "java";
const maven = process.env.MAVEN_HOME
  ? join(
      process.env.MAVEN_HOME,
      "bin",
      process.platform === "win32" ? "mvn.cmd" : "mvn",
    )
  : localMaven
    ? join(
        tools,
        localMaven,
        "bin",
        process.platform === "win32" ? "mvn.cmd" : "mvn",
      )
    : "mvn";

export function verifyJava() {
  const result = spawnSync(java, ["-version"], {
    env: runtimeEnv,
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  const output = (result.stdout || "") + (result.stderr || "");
  if (
    result.error ||
    result.status !== 0 ||
    !/(?:openjdk|java) version "21[.\"]/.test(output)
  ) {
    throw new Error(
      "Нужен JDK 21. Установите JAVA_HOME на JDK 21 (или распакуйте его в .local/tools/jdk-21*). " +
        (result.error?.message || output),
    );
  }
}
/** Бэкенд — Spring Boot (server/). */
export const SERVER_POM = "server/pom.xml";

export function buildBackend(goal = "package -DskipTests", pom = SERVER_POM) {
  verifyJava();
  return new Promise((accept, reject) => {
    // The command and arguments are fixed here; no user-supplied shell fragments.
    const child =
      process.platform === "win32"
        ? spawn(
            process.env.ComSpec || "cmd.exe",
            [
              "/d",
              "/s",
              "/c",
              `""${maven}" -B -f ${pom} "-Dmaven.repo.local=${join(root, ".local", "m2")}" ${goal}"`,
            ],
            {
              cwd: root,
              env: runtimeEnv,
              stdio: "inherit",
              windowsHide: true,
              windowsVerbatimArguments: true,
            },
          )
        : spawn(
            maven,
            [
              "-B",
              "-f",
              pom,
              `-Dmaven.repo.local=${join(root, ".local", "m2")}`,
              ...goal.split(" "),
            ],
            { cwd: root, env: runtimeEnv, stdio: "inherit" },
          );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`Maven завершился с кодом ${code}`)),
    );
  });
}
/**
 * PostgreSQL + PostGIS из docker-compose.yml. Пропускается, если задан свой DATABASE_URL.
 */
export function ensureDatabase(environment = runtimeEnv) {
  if (environment.DATABASE_URL) return;
  const result = spawnSync("docker", ["compose", "up", "-d", "--wait", "db"], {
    cwd: root,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
    timeout: 120000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "Не удалось запустить базу через Docker. Запустите Docker Desktop или укажите свою базу в DATABASE_URL.",
    );
}

/** A named schema always applies, even when DATABASE_URL is supplied explicitly. */
export function databaseEnvironment(environment) {
  const schema = environment.DB_SCHEMA || "public";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw new Error("DB_SCHEMA должен быть простым именем PostgreSQL (a-z, 0-9, _).");
  const port = environment.POSTGRES_PORT || "5432";
  if (!environment.DATABASE_URL && (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535))
    throw new Error("POSTGRES_PORT должен быть числом от 1 до 65535.");
  const jdbc = environment.DATABASE_URL || `jdbc:postgresql://127.0.0.1:${port}/opodoydet`;
  if (!jdbc.startsWith("jdbc:postgresql://"))
    throw new Error("DATABASE_URL должен быть JDBC URL PostgreSQL.");
  const url = new URL(jdbc.slice(5));
  url.searchParams.set("currentSchema", schema);
  return { ...environment, DB_SCHEMA: schema, DATABASE_URL: "jdbc:" + url.toString() };
}

/**
 * Запуск Spring Boot из неизменяемой копии JAR. SQLite импортируется только по явно
 * заданному LEGACY_DB_PATH; DB_PATH не является базой нового приложения.
 */
export function startBackend({
  jarPath = join("server", "target", "o-podoydet-server.jar"),
  env = {},
  database = true,
} = {}) {
  verifyJava();
  const environment = { ...runtimeEnv, ...env };
  const childEnv = databaseEnvironment(environment);
  if (database) ensureDatabase(environment);
  const jar = resolve(root, jarPath);
  if (!existsSync(jar))
    throw new Error("Сначала выполните npm run backend:build");
  // Run an immutable copy so rebuilding target/ cannot invalidate lazy class loading.
  const runtimeDirectory = join(root, ".local", "runtime");
  mkdirSync(runtimeDirectory, { recursive: true });
  const runtimeJar = join(runtimeDirectory, `backend-${randomUUID()}.jar`);
  copyFileSync(jar, runtimeJar);
  const child = spawn(
    java,
    ["-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-jar", runtimeJar],
    {
      cwd: root,
      env: childEnv,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const clean = () => {
    try {
      rmSync(runtimeJar, { force: true });
    } catch {
      /* Windows may briefly retain the file handle. */
    }
  };
  child.once("exit", clean);
  child.once("error", clean);
  return child;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const action = process.argv[2] || "start";
    if (action === "build") await buildBackend("package -DskipTests", process.argv[3] || SERVER_POM);
    else if (action === "test") await buildBackend("verify", process.argv[3] || SERVER_POM);
    else if (action === "start") {
      const child = startBackend();
      child.on("error", (e) => {
        console.error(e.message);
        process.exitCode = 1;
      });
      child.on("exit", (code) => {
        process.exitCode = code ?? 1;
      });
      process.on("SIGINT", () => child.kill());
      process.on("SIGTERM", () => child.kill());
    } else throw new Error("Ожидается build, test или start");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
