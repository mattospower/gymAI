import { resolve } from "node:path";
import { createApp } from "./app.mjs";
import { openPostgres } from "./postgres.mjs";
import { recoveryMailer } from "./mail.mjs";
import { createProvider } from "./ai.mjs";

export async function createRuntime(env = process.env) {
  const production = env.NODE_ENV === "production" || env.VERCEL === "1";
  const origin = env.APP_ORIGIN || (production ? "" : "http://localhost:3000");
  if (!origin) throw new Error("Configure APP_ORIGIN com a URL HTTPS pública.");
  if (!/^[a-f0-9]{64}$/i.test(env.DATA_ENCRYPTION_KEY || ""))
    throw new Error(
      "Configure uma DATA_ENCRYPTION_KEY persistente de 32 bytes.",
    );
  if (env.VERCEL === "1" && !env.DATABASE_URL)
    throw new Error(
      "A Vercel exige DATABASE_URL persistente. SQLite temporário é proibido.",
    );
  const store = env.DATABASE_URL
    ? await openPostgres({
        connectionString: env.DATABASE_URL,
        key: Buffer.from(env.DATA_ENCRYPTION_KEY, "hex"),
        production,
      })
    : undefined;
  try {
    return createApp({
      origin,
      production,
      store,
      trustedProxy: env.VERCEL === "1",
      databasePath: resolve(env.DATABASE_PATH || "./data/gymia.sqlite"),
      encryptionKey: env.DATA_ENCRYPTION_KEY,
      sendRecovery: recoveryMailer(env),
      aiProvider: createProvider(env),
    });
  } catch (error) {
    await store?.close();
    throw error;
  }
}
