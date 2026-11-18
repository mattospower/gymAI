import { createTestApp as createApp } from "./helpers/app.mjs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";

const parent = resolve("test-results");
mkdirSync(parent, { recursive: true });
const directory = mkdtempSync(resolve(parent, "e2e-"));
const app = await createApp({
  origin: "http://localhost:3100",
  databasePath: resolve(directory, "gymia.sqlite"),
  encryptionKey: randomBytes(32).toString("hex"),
});
app.server.listen(3100, "127.0.0.1", () =>
  console.log("Testes: http://localhost:3100"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
