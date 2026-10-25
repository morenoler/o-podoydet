import { spawn } from "node:child_process";

const child = spawn(
  process.env.ADVISOR_PYTHON || "python",
  ["-m", "unittest", "discover", "-s", "agents/tests", "-v"],
  { stdio: "inherit", windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" } },
);
child.on("error", () => {
  console.error("Не найден Python. Укажите путь к Python 3.11+ в ADVISOR_PYTHON в .env.");
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
