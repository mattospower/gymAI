import { encrypt, decrypt } from "./security.mjs";

export const dataTables = Object.freeze({
  users: "id email name password_hash terms_version accepted_at created_at",
  profiles: "user_id payload updated_at",
  training_plans: "id user_id status payload version created_at updated_at",
  workout_logs:
    "id user_id plan_id plan_ref status payload version started_at finished_at",
  user_preferences: "user_id payload version updated_at",
  calendar_events: "id user_id date payload version created_at updated_at",
  ai_drafts: "id user_id payload created_at expires_at",
  calendar_series: "id user_id payload version cancelled created_at updated_at",
  calendar_occurrences: "series_id date event_id exception",
  calendar_links: "event_id workout_id user_id",
  plan_versions: "plan_id user_id version status payload created_at",
});

export async function captureSnapshot(db) {
  const data = {};
  for (const table of Object.keys(dataTables))
    data[table] = await db
      .prepare(`SELECT ${dataTables[table].split(" ").join(",")} FROM ${table}`)
      .all();
  const check = await db
    .prepare("SELECT value FROM settings WHERE key=?")
    .get("encryption-check");
  return {
    format: "gymia-snapshot-v1",
    schemaVersion: 4,
    createdAt: new Date().toISOString(),
    encryptionCheck: check.value,
    data,
  };
}

export function sealSnapshot(snapshot, backupKey) {
  return encrypt(snapshot, backupKey, "gymia-backup-v1");
}
export function unsealSnapshot(value, backupKey) {
  return decrypt(value, backupKey, "gymia-backup-v1");
}

// Target must be empty. Sessions/resets/rate limits are deliberately never
// imported: restoring an old backup must not revive login or recovery tokens.
export async function restoreSnapshot(db, snapshot, key) {
  if (
    snapshot.format !== "gymia-snapshot-v1" ||
    snapshot.schemaVersion !== 4 ||
    decrypt(snapshot.encryptionCheck, key, "gymia-key-check") !== "gymia"
  )
    throw new Error("Backup incompatível ou chave de dados incorreta.");
  await db.transaction(async () => {
    await db
      .prepare(
        `LOCK TABLE ${Object.keys(dataTables).join(",")} IN ACCESS EXCLUSIVE MODE`,
      )
      .run();
    for (const table of Object.keys(dataTables))
      if ((await db.prepare(`SELECT count(*) n FROM ${table}`).get()).n !== 0)
        throw new Error(
          "Restauração exige um banco de destino vazio. Nenhum dado foi substituído.",
        );
    for (const [table, columns] of Object.entries(dataTables)) {
      if (!Array.isArray(snapshot.data[table]))
        throw new Error("Tabela ausente no backup.");
      const fields = columns.split(" ");
      for (const row of snapshot.data[table]) {
        if (Object.keys(row).some((k) => !fields.includes(k)))
          throw new Error("Coluna não reconhecida no backup.");
        // Inserting plans automatically captures their current version; replace
        // that generated snapshot with the complete retained version history.
        if (table === "plan_versions")
          await db
            .prepare("DELETE FROM plan_versions WHERE plan_id=? AND version=?")
            .run(row.plan_id, row.version);
        await db
          .prepare(
            `INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
          )
          .run(...fields.map((f) => row[f]));
      }
    }
    for (const table of Object.keys(dataTables))
      if (
        (await db.prepare(`SELECT count(*) n FROM ${table}`).get()).n !==
        snapshot.data[table].length
      )
        throw new Error(
          "Contagem de restauração divergente; transação revertida.",
        );
  }, "restore");
}
