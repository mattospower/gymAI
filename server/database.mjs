import { AsyncLocalStorage } from "node:async_hooks";

const transactions = new AsyncLocalStorage();
export async function asyncTransaction(db, action, owner = "auth") {
  if (db.transaction) return db.transaction(action, owner);
  if (transactions.getStore() === db) return action();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await transactions.run(db, action);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Local transaction callbacks contain only synchronous SQLite statements and
// microtask continuations. Never await network/filesystem work inside them.
