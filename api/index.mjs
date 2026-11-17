import { createRuntime } from "../server/runtime.mjs";

let application;
export default async function handler(req, res) {
  try {
    // Cache only the pool/application, never a user's account, session or data.
    application ||= createRuntime().catch((error) => {
      application = null;
      throw error;
    });
    await (await application).handler(req, res);
  } catch {
    console.error(
      "GymIA indisponível. Verifique a configuração e o banco de dados.",
    );
    if (!res.headersSent) {
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          message:
            "Serviço temporariamente indisponível. Tente novamente em instantes.",
        }),
      );
    } else res.end();
  }
}
