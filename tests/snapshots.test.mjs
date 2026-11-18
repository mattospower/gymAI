import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openStore } from "../server/store.mjs";
import { encrypt } from "../server/security.mjs";
import { localPostgres } from "./helpers/postgres.mjs";
import {
  captureSnapshot,
  sealSnapshot,
  unsealSnapshot,
  restoreSnapshot,
} from "../server/snapshots.mjs";

test(
  "Migração SQLite→PostgreSQL e backup/restauração criptografados",
  { timeout: 120000 },
  async () => {
    const key = randomBytes(32),
      backupKey = randomBytes(32),
      user = randomUUID(),
      plan = randomUUID();
    await mkdir(resolve("test-results"), { recursive: true });
    const dir = await mkdtemp(resolve("test-results/import-")),
      file = resolve(dir, "source.sqlite");
    const sqlite = openStore(file, key);
    sqlite
      .prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)")
      .run(user, "ficticio@example.com", "Nome fictício", "hash", "v1", 1, 1);
    sqlite
      .prepare("INSERT INTO profiles VALUES(?,?,?)")
      .run(user, encrypt({ goal: "forca" }, key, user), 1);
    sqlite
      .prepare("INSERT INTO training_plans VALUES(?,?,?,?,?,?,?)")
      .run(
        plan,
        user,
        "saved",
        encrypt(
          { name: "Plano fictício", sessions: [] },
          key,
          `plan:${user}:${plan}`,
        ),
        1,
        1,
        1,
      );
    sqlite
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run("revoked-token", user, Date.now() + 999999);
    const snapshot = await captureSnapshot(sqlite);
    sqlite.close();
    const fingerprint = async () =>
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
    const before = await fingerprint();
    const pg = await localPostgres(key),
      restored = await localPostgres(key);
    try {
      await restoreSnapshot(pg, snapshot, key);
      assert.equal((await pg.prepare("SELECT * FROM users").all()).length, 1);
      assert.equal(
        (await pg.prepare("SELECT * FROM plan_versions").all()).length,
        1,
      );
      assert.equal(
        (await pg.prepare("SELECT * FROM sessions").all()).length,
        0,
      );
      const captured = await pg.transaction(
        () => captureSnapshot(pg),
        "backup",
      );
      const sealed = sealSnapshot(captured, backupKey);
      assert.ok(!sealed.includes("ficticio@example.com"));
      assert.throws(() => unsealSnapshot(sealed, randomBytes(32)));
      await restoreSnapshot(restored, unsealSnapshot(sealed, backupKey), key);
      const roundtrip = await captureSnapshot(restored);
      assert.deepEqual(roundtrip.data, captured.data);
      await assert.rejects(restoreSnapshot(restored, snapshot, key), /vazio/);
      assert.equal(
        await fingerprint(),
        before,
        "SQLite original não foi modificado",
      );
    } finally {
      await pg.close();
      await restored.close();
    }
  },
);
