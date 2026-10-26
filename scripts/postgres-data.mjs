import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openPostgres } from "../server/postgres.mjs";
import {
  captureSnapshot,
  sealSnapshot,
  unsealSnapshot,
  restoreSnapshot,
} from "../server/snapshots.mjs";

const [command, filename, confirmation] = process.argv.slice(2);
if (!["backup", "restore", "import-sqlite"].includes(command) || !filename) {
  console.error(
    "Uso: node --env-file=.env scripts/postgres-data.mjs backup|restore|import-sqlite CAMINHO [confirmação]",
  );
  process.exit(1);
}
let store, source;
try {
  const env = process.env;
  if (
    !env.DATABASE_URL ||
    !/^[a-f0-9]{64}$/i.test(env.DATA_ENCRYPTION_KEY || "")
  )
    throw new Error(
      "Configure DATABASE_URL e DATA_ENCRYPTION_KEY no ambiente protegido.",
    );
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "hex");
  if (
    command === "import-sqlite" &&
    confirmation !== "--allow-personal-data-transfer"
  )
    throw new Error(
      "Importação não autorizada: exige --allow-personal-data-transfer após autorização específica do responsável.",
    );
  if (command === "restore" && confirmation !== "--confirm-empty-target")
    throw new Error("Confirme o destino vazio com --confirm-empty-target.");
  const path = resolve(filename);
  let snapshot;
  if (command === "import-sqlite") {
    source = new DatabaseSync(path, { readOnly: true });
    if (source.prepare("PRAGMA user_version").get().user_version !== 4)
      throw new Error(
        "Use uma cópia SQLite v4 validada. O original não será alterado.",
      );
    if (
      source.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      source.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("SQLite com falha de integridade.");
    source.exec("BEGIN");
    snapshot = await captureSnapshot(source);
    source.exec("COMMIT");
  } else {
    if (!/^[a-f0-9]{64}$/i.test(env.BACKUP_ENCRYPTION_KEY || ""))
      throw new Error(
        "Configure BACKUP_ENCRYPTION_KEY separada, com 64 dígitos hexadecimais.",
      );
    if (command === "restore")
      snapshot = unsealSnapshot(
        await readFile(path, "utf8"),
        Buffer.from(env.BACKUP_ENCRYPTION_KEY, "hex"),
      );
  }
  store = await openPostgres({ connectionString: env.DATABASE_URL, key });
  if (command === "backup") {
    snapshot = await store.transaction(() => captureSnapshot(store), "backup");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(
      path,
      sealSnapshot(snapshot, Buffer.from(env.BACKUP_ENCRYPTION_KEY, "hex")),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      "Backup criptografado criado. Guarde as duas chaves separadamente e teste a restauração.",
    );
  } else {
    await restoreSnapshot(store, snapshot, key);
    console.log(
      "Dados restaurados no destino vazio. Sessões e links de recuperação não foram importados.",
    );
  }
} catch {
  // Never print connection strings, raw SQL errors, emails, tokens or passwords.
  console.error(
    "Operação recusada ou não concluída. Verifique configuração, confirmações, chaves, integridade e destino vazio; consulte docs/DEPLOY-VERCEL.md.",
  );
  process.exitCode = 1;
} finally {
  source?.close();
  await store?.close();
}
