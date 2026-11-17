import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { encrypt, decrypt } from "./security.mjs";

// Milliseconds, counts and sums must keep the number contract of the SQLite API.
const types = {
  getTypeParser(oid, format) {
    if (oid === 20 || oid === 1700)
      return (value) => {
        const result = Number(value);
        if (!Number.isSafeInteger(result))
          throw new Error("Valor fora do intervalo seguro.");
        return result;
      };
    return pg.types.getTypeParser(oid, format);
  },
};

export function postgresSql(sql) {
  let index = 0,
    quoted = false,
    out = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      if (quoted && sql[i + 1] === "'") {
        out += sql[++i];
        continue;
      }
      quoted = !quoted;
    } else out += ch === "?" && !quoted ? `$${++index}` : ch;
  }
  // PostgreSQL needs a type for a standalone NULL parameter.
  out = out.replace(/(\$\d+) IS NULL/g, "$1::text IS NULL");
  if (/INSERT INTO user_preferences/i.test(out))
    out = out.replace(
      "version=version+1",
      "version=user_preferences.version+1",
    );
  return out;
}

export async function openPostgres({
  connectionString,
  key,
  pool: suppliedPool,
  production = process.env.NODE_ENV === "production",
}) {
  if (!suppliedPool) {
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw new Error("DATABASE_URL inválida.");
    if (
      production &&
      ["disable", "no-verify"].includes(url.searchParams.get("sslmode"))
    )
      throw new Error("PostgreSQL de produção exige TLS verificado.");
    // Prefer the provider's pooled URL. Never disable certificate validation.
    if (production) url.searchParams.set("sslmode", "verify-full");
    connectionString = url.toString();
  }
  const pool =
    suppliedPool ||
    new pg.Pool({
      connectionString,
      types,
      max: 4,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
      statement_timeout: 15000,
      query_timeout: 20000,
    });
  pool.on?.("error", () => console.error("Conexão PostgreSQL interrompida."));
  const context = new AsyncLocalStorage();
  const query = (sql, values = []) =>
    (context.getStore() || pool).query(sql, values);
  const store = {
    dialect: "postgres",
    prepare(sql) {
      const text = postgresSql(sql);
      return {
        async get(...values) {
          return (await query(text, values)).rows[0];
        },
        async all(...values) {
          return (await query(text, values)).rows;
        },
        async run(...values) {
          const r = await query(text, values);
          return { changes: r.rowCount };
        },
      };
    },
    async transaction(action, owner = "auth") {
      if (context.getStore()) return action();
      const client = await pool.connect();
      try {
        await client.query(
          owner === "backup"
            ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
            : "BEGIN",
        );
        await client.query("SET LOCAL lock_timeout = '10s'");
        // All operations for a user share the same lock, across Vercel instances.
        // A hash collision only serializes unrelated users; it cannot mix data.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`gymia:${owner}`],
        );
        const result = await context.run(client, action);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  try {
    await store.transaction(async () => {
      await query(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      const version = await store
        .prepare("SELECT value FROM settings WHERE key=?")
        .get("postgres-schema-version");
      if (version && version.value !== "1")
        throw new Error("Esquema PostgreSQL incompatível.");
      const check = await store
        .prepare("SELECT value FROM settings WHERE key=?")
        .get("encryption-check");
      if (check) {
        try {
          if (decrypt(check.value, key, "gymia-key-check") !== "gymia")
            throw new Error();
        } catch {
          throw new Error(
            "A chave de criptografia não corresponde ao banco. Restaure a chave original.",
          );
        }
      }
      if (!version) {
        const existing = await query("SELECT to_regclass('users') AS users");
        if (existing.rows[0].users)
          throw new Error(
            "O destino já contém tabelas sem versão GymIA. Use um banco vazio dedicado.",
          );
        const schema = await readFile(
          new URL("./migrations/postgres/001.sql", import.meta.url),
          "utf8",
        );
        await query(schema);
        await store
          .prepare("INSERT INTO settings VALUES (?,?)")
          .run("postgres-schema-version", "1");
      }
      if (!check)
        await store
          .prepare("INSERT INTO settings VALUES (?,?)")
          .run("encryption-check", encrypt("gymia", key, "gymia-key-check"));
    }, "schema-migration");
  } catch (error) {
    await pool.end();
    throw error;
  }
  return store;
}
