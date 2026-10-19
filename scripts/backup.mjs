import { DatabaseSync, backup } from "node:sqlite";
import { resolve, dirname, join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
const source = resolve(process.env.DATABASE_PATH || "./data/gymia.sqlite");
if (!existsSync(source))
  throw new Error("Banco não encontrado. Nenhuma cópia foi criada.");
const directory = join(dirname(source), "backups");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const target = join(directory, `gymia-${Date.now()}.sqlite`);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, target);
  console.log(
    "Backup consistente criado no diretório backups ao lado do banco. Guarde também a chave separadamente.",
  );
} finally {
  db.close();
}
