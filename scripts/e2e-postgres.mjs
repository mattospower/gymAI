import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);
const child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env, GYMIA_TEST_POSTGRES: "1" },
});
child.once("error", () => {
  console.error("Não foi possível iniciar os testes de navegador.");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
