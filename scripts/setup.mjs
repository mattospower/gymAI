import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

try {
  const example = await readFile(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  await writeFile(
    new URL("../.env", import.meta.url),
    example.replace(
      "DATA_ENCRYPTION_KEY=",
      `DATA_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Configuração local criada. Execute npm start e abra http://localhost:3000.",
  );
} catch (error) {
  if (error.code === "EEXIST")
    console.log("A configuração .env já existe e foi preservada.");
  else throw error;
}
