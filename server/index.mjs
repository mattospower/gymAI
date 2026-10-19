import { resolve } from "node:path";
import { createApp } from "./app.mjs";
import { recoveryMailer } from "./mail.mjs";

const production = process.env.NODE_ENV === "production";
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
const app = createApp({
  production,
  origin,
  databasePath: resolve(process.env.DATABASE_PATH || "./data/gymia.sqlite"),
  encryptionKey: process.env.DATA_ENCRYPTION_KEY,
  sendRecovery: recoveryMailer(process.env),
});
const port = Number(process.env.PORT || 3000);
app.server.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`gymAI disponível em ${origin}`);
  if (!process.env.SMTP_HOST)
    console.log(
      "Recuperação por e-mail indisponível: configure SMTP no servidor.",
    );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
