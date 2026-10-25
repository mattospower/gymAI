import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { openStore } from "../server/store.mjs";
import { encrypt, decrypt } from "../server/security.mjs";

test("Backup consistente e restauração isolada preservam dados e chave", () => {
  const parent = resolve("test-results");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "backup-")),
    key = randomBytes(32),
    id = randomUUID();
  let db;
  try {
    const source = join(dir, "source.sqlite");
    db = openStore(source, key);
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)").run(
      id,
      "backup@example.com",
      "Conta fictícia",
      "hash-de-fixture",
      "teste",
      1,
      1,
    );
    const profile = {
      goal: "forca",
      equipment: ["peso-corporal"],
      limitations: "Somente dado fictício",
    };
    db.prepare("INSERT INTO profiles VALUES (?,?,?)").run(
      id,
      encrypt(profile, key, id),
      1,
    );
    const before = db.prepare("SELECT * FROM users").all();
    execFileSync(process.execPath, ["scripts/backup.mjs"], {
      cwd: resolve("."),
      env: { ...process.env, DATABASE_PATH: source },
      stdio: "pipe",
    });
    assert.deepEqual(db.prepare("SELECT * FROM users").all(), before);
    db.close();
    db = null;
    const copies = readdirSync(join(dir, "backups"));
    assert.equal(copies.length, 1);
    mkdirSync(join(dir, "restore"));
    const destination = join(dir, "restore", "restored.sqlite");
    copyFileSync(join(dir, "backups", copies[0]), destination);
    db = openStore(destination, key);
    assert.deepEqual(db.prepare("SELECT * FROM users").all(), before);
    assert.deepEqual(
      decrypt(
        db.prepare("SELECT payload FROM profiles").get().payload,
        key,
        id,
      ),
      profile,
    );
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db?.close();
    if (!resolve(dir).startsWith(parent + sep))
      throw new Error("Pasta inesperada");
    rmSync(dir, { recursive: true, force: true });
  }
});
