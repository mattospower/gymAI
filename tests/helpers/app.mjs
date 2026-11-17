import { createApp } from "../../server/app.mjs";
import { localPostgres } from "./postgres.mjs";

export async function createTestApp(options) {
  if (process.env.GYMIA_TEST_POSTGRES !== "1") return createApp(options);
  return createApp({
    ...options,
    store: await localPostgres(Buffer.from(options.encryptionKey, "hex")),
  });
}
