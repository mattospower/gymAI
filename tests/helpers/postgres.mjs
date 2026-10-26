import { PGlite } from "@electric-sql/pglite";
import { openPostgres } from "../../server/postgres.mjs";

// A real PostgreSQL engine compiled to WASM. No external account, mock SQL
// implementation or production database is used by the automated suite.
export async function localPostgres(key, path) {
  const engine = new PGlite(path);
  await engine.waitReady;
  let tail = Promise.resolve();
  const reserve = async () => {
    const before = tail;
    let release;
    tail = new Promise((r) => {
      release = r;
    });
    await before;
    return release;
  };
  const raw = async (sql, params = []) => {
    const result = params.length
      ? await engine.query(sql, params)
      : (await engine.exec(sql)).at(-1);
    for (const f of result?.fields || [])
      if ([20, 1700].includes(f.dataTypeID))
        for (const row of result.rows)
          if (row[f.name] !== null) row[f.name] = Number(row[f.name]);
    return {
      ...result,
      rowCount: result.affectedRows ?? result.rows?.length ?? 0,
    };
  };
  const pool = {
    async query(sql, params) {
      const release = await reserve();
      try {
        return await raw(sql, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await reserve();
      return { query: raw, release };
    },
    async end() {
      await engine.close();
    },
  };
  return openPostgres({ pool, key });
}
