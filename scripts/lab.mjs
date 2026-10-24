import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
function run(script, args, env = process.env) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`Command exited: ${code}`)),
    );
  });
}

try {
  if (process.argv[2] === "build") {
    await run("node_modules/typescript/bin/tsc", ["--noEmit"]);
    await run("node_modules/vite/bin/vite.js", ["build", "--outDir", "dist-lab"], {
      ...process.env,
      VITE_LAB_MODE: "true",
    });
  } else if (process.argv[2] === "start") {
    // A separate origin and database isolate test trips, host answers and agent history.
    process.env.PORT = process.env.LAB_PORT || "8081";
    process.env.LAB_MODE = "true";
    const mainDatabase = process.env.DB_PATH || ".local/busan.sqlite3";
    process.env.DB_PATH = process.env.LAB_DB_PATH || ".local/lab.sqlite3";
    const canonicalPath = (path) => {
      const absolute = resolve(root, path);
      return process.platform === "win32" ? absolute.toLowerCase() : absolute;
    };
    if (canonicalPath(process.env.DB_PATH) === canonicalPath(mainDatabase)) {
      throw new Error("База лаборатории должна отличаться от базы основного сайта.");
    }
    const { writeLabDataset } = await import("./lab-data.ts");
    const labDataPath = resolve(root, ".local/lab-hotels.json");
    await writeLabDataset(
      resolve(root, process.env.DATA_PATH || "data/verified-hotels.json"),
      labDataPath,
    );
    process.env.DATA_PATH = labDataPath;
    process.env.DIST_PATH = "dist-lab";
    // Lab experiments must never invoke the optional paid search text parser.
    process.env.LLM_API_KEY = "";
    const { startBackend } = await import("./backend.mjs");
    const child = startBackend();
    child.once("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.once("exit", (code) => {
      process.exitCode = code ?? 1;
    });
    process.on("SIGINT", () => child.kill());
    process.on("SIGTERM", () => child.kill());
  } else {
    throw new Error("Use build or start");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
