import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { encrypt, decrypt } from "./security.mjs";

export function openStore(path, key) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 });
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 4) {
    db.close();
    throw new Error("Banco criado por uma versão mais recente do GymIA.");
  }
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, terms_version TEXT NOT NULL,
      accepted_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resets (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS resets_user ON resets(user_id);
  `);
  const check = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("encryption-check");
  if (check) {
    try {
      decrypt(check.value, key, "gymia-key-check");
    } catch {
      db.close();
      throw new Error(
        "A chave de criptografia não corresponde ao banco. Restaure a chave original.",
      );
    }
  } else {
    db.prepare("INSERT INTO settings VALUES (?, ?)").run(
      "encryption-check",
      encrypt("gymia", key, "gymia-key-check"),
    );
  }
  try {
    if (version < 2)
      transaction(db, () =>
        db.exec(`
    CREATE TABLE IF NOT EXISTS training_plans (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('saved','active','archived')), payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_plan ON training_plans(user_id) WHERE status='active';
    CREATE INDEX IF NOT EXISTS plans_owner ON training_plans(user_id,updated_at);
    CREATE TABLE IF NOT EXISTS workout_logs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT REFERENCES training_plans(id) ON DELETE SET NULL, plan_ref TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('in_progress','completed','partial')), payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, started_at INTEGER NOT NULL, finished_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_workout ON workout_logs(user_id) WHERE status='in_progress';
    CREATE INDEX IF NOT EXISTS workouts_owner_date ON workout_logs(user_id,started_at);
    PRAGMA user_version = 2;
  `),
      );
    if (version < 3)
      transaction(db, () =>
        db.exec(`
    CREATE TABLE user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
    );
    CREATE TABLE calendar_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX calendar_owner_date ON calendar_events(user_id,date);
    CREATE TABLE ai_drafts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX drafts_owner ON ai_drafts(user_id,expires_at);
    PRAGMA user_version = 3;
  `),
      );
    if (version < 4)
      transaction(db, () =>
        db.exec(`
      CREATE TABLE calendar_series (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        cancelled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX series_owner ON calendar_series(user_id);
      CREATE TABLE calendar_occurrences (
        series_id TEXT NOT NULL REFERENCES calendar_series(id) ON DELETE CASCADE,
        date TEXT NOT NULL, event_id TEXT UNIQUE REFERENCES calendar_events(id) ON DELETE SET NULL,
        exception INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(series_id,date)
      );
      CREATE TABLE calendar_links (
        event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
        workout_id TEXT NOT NULL UNIQUE REFERENCES workout_logs(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX links_owner ON calendar_links(user_id);
      CREATE TABLE plan_versions (
        plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        version INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(plan_id,version)
      );
      CREATE INDEX versions_owner ON plan_versions(user_id,plan_id);
      INSERT INTO plan_versions SELECT id,user_id,version,status,payload,updated_at FROM training_plans;
      CREATE TRIGGER plan_created_version AFTER INSERT ON training_plans BEGIN
        INSERT INTO plan_versions VALUES(NEW.id,NEW.user_id,NEW.version,NEW.status,NEW.payload,NEW.updated_at);
      END;
      CREATE TRIGGER plan_updated_version AFTER UPDATE ON training_plans WHEN NEW.version<>OLD.version BEGIN
        INSERT INTO plan_versions VALUES(NEW.id,NEW.user_id,NEW.version,NEW.status,NEW.payload,NEW.updated_at);
        DELETE FROM plan_versions WHERE plan_id=NEW.id AND version NOT IN
          (SELECT version FROM plan_versions WHERE plan_id=NEW.id ORDER BY version DESC LIMIT 30);
      END;
      CREATE INDEX workouts_owner_plan_date ON workout_logs(user_id,plan_ref,started_at DESC,id);
      PRAGMA user_version=4;
    `),
      );
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export function transaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
