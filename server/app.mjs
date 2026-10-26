import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.mjs";
import { asyncTransaction as transaction } from "./database.mjs";
import { trainingRoutes, isTrainingPath } from "./training.mjs";
import { evolutionRoutes, isEvolutionPath } from "./evolution.mjs";
import { aiRoutes, createProvider } from "./ai.mjs";
import {
  HttpError,
  token,
  digest,
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
  text,
  email,
  password,
  profile,
} from "./security.mjs";
const root = new URL("../", import.meta.url);
const publicFiles = new Set([
  "index.html",
  "entrar.html",
  "cadastro.html",
  "recuperar-senha.html",
  "redefinir-senha.html",
  "configurar-perfil.html",
  "perfil.html",
  "termos.html",
  "privacidade.html",
  "contato.html",
  "como-funciona.html",
  "recursos.html",
  "recursoso.html",
  "style.css",
  "assets/site.js",
  "assets/api.js",
  "assets/auth.js",
  "assets/profile.js",
  "treinos.html",
  "plano.html",
  "exercicios.html",
  "sessao-treino.html",
  "historico.html",
  "assets/training.js",
  "assets/training-ui.js",
]);
const privatePages = new Set([
  "configurar-perfil.html",
  "perfil.html",
  "treinos.html",
  "plano.html",
  "exercicios.html",
  "sessao-treino.html",
  "historico.html",
]);
for (const page of [
  "calendario.html",
  "evolucao.html",
  "assistente.html",
  "configuracoes.html",
  "relatorios.html",
]) {
  publicFiles.add(page);
  privatePages.add(page);
}
publicFiles.add("assets/evolution.js");
publicFiles.add("assets/reports.js");
publicFiles.add("assets/plan-tools.js");
publicFiles.add("assets/data-ui.js");
const mime = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
};
const sessionDuration = 12 * 60 * 60 * 1000;
const recoveryResponse = {
  message:
    "Se houver uma conta com esse e-mail, você receberá instruções de recuperação. Confira também a caixa de spam.",
};
export function createApp({
  origin,
  databasePath,
  store,
  trustedProxy = false,
  encryptionKey,
  production = false,
  sendRecovery = null,
  now = Date.now,
  aiProvider = createProvider(),
}) {
  const canonical = new URL(origin);
  if (
    canonical.origin !== origin ||
    !["http:", "https:"].includes(canonical.protocol) ||
    (production && canonical.protocol !== "https:")
  ) {
    throw new Error(
      "APP_ORIGIN deve conter somente a origem, sem barra final. Produção exige HTTPS.",
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey || ""))
    throw new Error("Defina DATA_ENCRYPTION_KEY com 64 dígitos hexadecimais.");
  const key = Buffer.from(encryptionKey, "hex");
  const db = store || openStore(databasePath, key);
  const training = trainingRoutes({
    db,
    key,
    now,
  });
  const secure = canonical.protocol === "https:";
  const cookieName = secure ? "__Host-gymia_session" : "gymia_session";
  // Same KDF work for an unknown account to reduce login enumeration by timing.
  const dummyHash = `scrypt$131072$8$1$${"0".repeat(32)}$${"0".repeat(128)}`;
  const pendingMail = new Set();
  const hashed = (value) =>
    createHmac("sha256", key).update(value).digest("hex");
  const json = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(body));
  };
  const clearCookie = (res) =>
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`,
    );
  const setCookie = (res, value) =>
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDuration / 1000}${secure ? "; Secure" : ""}`,
    );
  const cleanup = async () => {
    await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
    await db.prepare("DELETE FROM resets WHERE expires_at <= ?").run(now());
    await db.prepare("DELETE FROM rate_limits WHERE until <= ?").run(now());
  };
  const session = async (req) => {
    const value = (req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!/^[a-f0-9]{64}$/.test(value || "")) return null;
    return await db
      .prepare(
        `SELECT users.*, sessions.token_hash AS session_hash FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      )
      .get(digest(value), now());
  };
  const hasProfile = async (user) =>
    Boolean(
      await db.prepare("SELECT 1 FROM profiles WHERE user_id = ?").get(user.id),
    );
  const account = async (user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: new Date(user.created_at).toISOString(),
    hasProfile: await hasProfile(user),
  });
  const requireUser = async (req) => {
    const user = await session(req);
    if (!user)
      throw new HttpError(
        401,
        "Sua sessão terminou. Entre novamente para continuar.",
      );
    return user;
  };
  const addSession = async (userId) => {
    const value = token();
    await db
      .prepare("INSERT INTO sessions VALUES (?, ?, ?)")
      .run(digest(value), userId, now() + sessionDuration);
    return value;
  };
  const limit = async (limitKey, maximum, duration) => {
    const row = await db
      .prepare(
        `INSERT INTO rate_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_limits.until <= ? THEN 1 ELSE rate_limits.count + 1 END,
      until = CASE WHEN rate_limits.until <= ? THEN excluded.until ELSE rate_limits.until END
      RETURNING count`,
      )
      .get(limitKey, now() + duration, now(), now());
    if (row.count > maximum)
      throw new HttpError(
        429,
        "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      );
  };
  const body = async (req, maximum = 16384) => {
    if (req.headers.origin !== origin || req.headers["x-gymia-request"] !== "1")
      throw new HttpError(403, "Origem da solicitação não autorizada.");
    if (
      req.headers["content-type"]?.split(";")[0].trim() !== "application/json"
    )
      throw new HttpError(415, "Envie os dados em JSON.");
    let size = 0;
    const parts = [];
    for await (const part of req) {
      size += part.length;
      if (size > maximum)
        throw new HttpError(413, "O formulário excede o tamanho permitido.");
      parts.push(part);
    }
    try {
      const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (!value || Array.isArray(value) || typeof value !== "object")
        throw new Error();
      return value;
    } catch {
      throw new HttpError(400, "Não foi possível ler o formulário.");
    }
  };
  const evolution = evolutionRoutes({
    db,
    key,
    now,
    training,
  });
  const assistant = aiRoutes({
    db,
    key,
    now,
    provider: aiProvider,
    preferences: evolution.preferences,
    training,
    limit,
    hashed,
  });
  const handle = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
    );
    if (production)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      if (req.headers.host !== canonical.host)
        throw new HttpError(400, "Endereço do servidor inválido.");
      const url = new URL(req.url, origin);
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith("/api/")) {
        await cleanup();
        const route = `${req.method} ${path}`;
        if (route === "GET /api/config")
          return json(res, 200, {
            passwordRecoveryAvailable: Boolean(sendRecovery),
          });
        if (route === "GET /api/session") {
          const user = await session(req);
          return json(res, 200, {
            user: user ? await account(user) : null,
          });
        }
        if (route === "GET /api/profile") {
          const user = await requireUser(req);
          const row = await db
            .prepare("SELECT * FROM profiles WHERE user_id = ?")
            .get(user.id);
          return json(res, 200, {
            profile: row ? decrypt(row.payload, key, user.id) : null,
            updatedAt: row ? new Date(row.updated_at).toISOString() : null,
          });
        }
        if (isEvolutionPath(path) || path.startsWith("/api/ai/")) {
          const user = await requireUser(req);
          await limit(`evolution:${hashed(user.id)}`, 300, 15 * 60 * 1000);
          if (
            path === "/api/export" ||
            (path === "/api/reports" && url.searchParams.has("format"))
          )
            await limit(`export:${hashed(user.id)}`, 5, 3600000);
          let input = {};
          if (req.method !== "GET") {
            if (!["POST", "PUT", "DELETE"].includes(req.method))
              throw new HttpError(405, "Método não permitido.");
            input = await body(req, 32768);
          }
          const result = path.startsWith("/api/ai/")
            ? await assistant(
                req.method,
                url,
                await requireUser(req),
                input,
                async () => await requireUser(req),
              )
            : await transaction(
                db,
                async () =>
                  evolution.dispatch(
                    req.method,
                    url,
                    await requireUser(req),
                    input,
                  ),
                user.id,
              );
          if (path === "/api/reports" && result.csv !== undefined) {
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader(
              "Content-Disposition",
              'attachment; filename="gymia-relatorio.csv"',
            );
            res.writeHead(200);
            return res.end("\ufeff" + result.csv);
          }
          if (
            path === "/api/reports" &&
            url.searchParams.get("format") === "json"
          )
            res.setHeader(
              "Content-Disposition",
              'attachment; filename="gymia-relatorio.json"',
            );
          if (path === "/api/export")
            res.setHeader(
              "Content-Disposition",
              'attachment; filename="gymia-dados.json"',
            );
          return json(res, 200, result);
        }
        if (isTrainingPath(path)) {
          const user = await requireUser(req);
          let input = {};
          if (req.method !== "GET") {
            if (!["POST", "PUT", "DELETE"].includes(req.method))
              throw new HttpError(405, "Método não permitido.");
            await limit(`training:${hashed(user.id)}`, 300, 15 * 60 * 1000);
            input = await body(req, 262144);
          }
          return json(
            res,
            200,
            await transaction(
              db,
              async () =>
                training(req.method, url, await requireUser(req), input),
              user.id,
            ),
          );
        }
        if (!["POST", "PUT", "DELETE"].includes(req.method))
          throw new HttpError(404, "Página não encontrada.");
        // Rate-limit before parsing bodies and running password derivation.
        const forwarded = trustedProxy
          ? req.headers["x-vercel-forwarded-for"]
          : null;
        const ip = hashed(
          typeof forwarded === "string"
            ? forwarded.split(",")[0].trim()
            : req.socket.remoteAddress || "unknown",
        );
        await limit(`ip:${ip}`, 100, 15 * 60 * 1000);
        const input = await body(req);
        if (route === "POST /api/register") {
          await limit(`register:${ip}`, 5, 60 * 60 * 1000);
          const name = text(input.name, "o nome", 100, 2);
          const address = email(input.email);
          const secret = password(input.password, input.confirmPassword);
          if (input.acceptTerms !== true)
            throw new HttpError(
              400,
              "Aceite os termos e a política de privacidade para criar sua conta.",
            );
          const hash = await hashPassword(secret);
          const id = randomUUID();
          const value = await transaction(db, async () => {
            if (
              await db
                .prepare("SELECT 1 FROM users WHERE email = ?")
                .get(address)
            )
              throw new HttpError(
                409,
                "Não foi possível criar a conta. Tente entrar ou recuperar sua senha.",
              );
            await db
              .prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)")
              .run(id, address, name, hash, "2026-10-25", now(), now());
            return await addSession(id);
          });
          setCookie(res, value);
          return json(res, 201, {
            user: await account(
              await db.prepare("SELECT * FROM users WHERE id = ?").get(id),
            ),
          });
        }
        if (route === "POST /api/login") {
          await limit(`login:${ip}`, 30, 15 * 60 * 1000);
          const address = email(input.email);
          const accountKey = `account:${hashed(address)}`;
          await limit(accountKey, 10, 15 * 60 * 1000);
          if (typeof input.password !== "string" || input.password.length > 128)
            throw new HttpError(400, "Informe sua senha.");
          const user = await db
            .prepare("SELECT * FROM users WHERE email = ?")
            .get(address);
          const matches = await verifyPassword(
            input.password,
            user?.password_hash || dummyHash,
          );
          if (!matches || !user)
            throw new HttpError(401, "E-mail ou senha incorretos.");
          const value = await transaction(
            db,
            async () => {
              const current = await db
                .prepare("SELECT password_hash FROM users WHERE id = ?")
                .get(user.id);
              if (current?.password_hash !== user.password_hash)
                throw new HttpError(401, "E-mail ou senha incorretos.");
              await db
                .prepare("DELETE FROM rate_limits WHERE key = ?")
                .run(accountKey);
              const previous = await session(req);
              if (previous)
                await db
                  .prepare("DELETE FROM sessions WHERE token_hash = ?")
                  .run(previous.session_hash);
              return addSession(user.id);
            },
            user.id,
          );
          setCookie(res, value);
          return json(res, 200, {
            user: await account(user),
          });
        }
        if (route === "POST /api/logout") {
          const user = await session(req);
          if (user)
            await db
              .prepare("DELETE FROM sessions WHERE token_hash = ?")
              .run(user.session_hash);
          clearCookie(res);
          return json(res, 200, {
            message: "Você saiu da conta.",
          });
        }
        if (route === "PUT /api/profile") {
          const user = await requireUser(req);
          const validated = profile(input);
          await db
            .prepare(
              `INSERT INTO profiles VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
            )
            .run(user.id, encrypt(validated, key, user.id), now());
          return json(res, 200, {
            profile: validated,
            updatedAt: new Date(now()).toISOString(),
          });
        }
        if (route === "POST /api/recover") {
          if (!sendRecovery)
            throw new HttpError(
              503,
              "A recuperação por e-mail ainda não foi configurada nesta instalação.",
            );
          await limit(`recover:${ip}`, 5, 15 * 60 * 1000);
          const address = email(input.email);
          const user = await db
            .prepare("SELECT * FROM users WHERE email = ?")
            .get(address);
          if (user) {
            const value = token();
            await db
              .prepare("INSERT INTO resets VALUES (?, ?, ?)")
              .run(digest(value), user.id, now() + 30 * 60 * 1000);
            // Respond uniformly. No recipient, message body or token is written to logs.
            const task = Promise.resolve()
              .then(() =>
                sendRecovery({
                  to: address,
                  url: `${origin}/redefinir-senha.html#token=${value}`,
                }),
              )
              .catch(async () => {
                await db
                  .prepare("DELETE FROM resets WHERE token_hash = ?")
                  .run(digest(value));
                console.error(
                  "Não foi possível enviar um e-mail de recuperação. Verifique o serviço SMTP.",
                );
              })
              .finally(() => pendingMail.delete(task));
            pendingMail.add(task);
          }
          return json(res, 200, recoveryResponse);
        }
        if (route === "POST /api/reset") {
          await limit(`reset:${ip}`, 10, 15 * 60 * 1000);
          if (!/^[a-f0-9]{64}$/.test(input.token || ""))
            throw new HttpError(
              400,
              "Link de recuperação inválido ou expirado. Solicite um novo link.",
            );
          const tokenHash = digest(input.token);
          const valid = async () =>
            await db
              .prepare(
                "SELECT * FROM resets WHERE token_hash = ? AND expires_at > ?",
              )
              .get(tokenHash, now());
          const initial = await valid();
          if (!initial)
            throw new HttpError(
              400,
              "Link de recuperação inválido ou expirado. Solicite um novo link.",
            );
          const hash = await hashPassword(
            password(input.password, input.confirmPassword),
          );
          await transaction(
            db,
            async () => {
              const reset = await valid();
              if (!reset)
                throw new HttpError(
                  400,
                  "Link de recuperação inválido ou expirado. Solicite um novo link.",
                );
              await db
                .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
                .run(hash, reset.user_id);
              await db
                .prepare("DELETE FROM sessions WHERE user_id = ?")
                .run(reset.user_id);
              await db
                .prepare("DELETE FROM resets WHERE user_id = ?")
                .run(reset.user_id);
            },
            initial.user_id,
          );
          clearCookie(res);
          return json(res, 200, {
            message: "Senha atualizada. Entre novamente com a nova senha.",
          });
        }
        if (route === "DELETE /api/account") {
          const user = await requireUser(req);
          await limit(`delete:${ip}`, 5, 15 * 60 * 1000);
          if (
            input.confirmation !== "EXCLUIR" ||
            typeof input.password !== "string" ||
            input.password.length > 128
          )
            throw new HttpError(
              400,
              "Digite EXCLUIR e confirme sua senha atual.",
            );
          if (!(await verifyPassword(input.password, user.password_hash)))
            throw new HttpError(
              401,
              "Senha incorreta. A conta foi preservada.",
            );
          await transaction(
            db,
            async () => {
              if ((await session(req))?.password_hash !== user.password_hash)
                throw new HttpError(
                  401,
                  "Sua sessão mudou. Entre novamente antes de excluir a conta.",
                );

              await db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
              await db
                .prepare("DELETE FROM rate_limits WHERE key = ?")
                .run(`account:${hashed(user.email)}`);
            },
            user.id,
          );
          if (db.dialect !== "postgres")
            db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
          clearCookie(res);
          return json(res, 200, {
            message:
              "Sua conta e os dados associados foram excluídos desta instalação.",
          });
        }
        throw new HttpError(404, "Página não encontrada.");
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new HttpError(405, "Método não permitido.");
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file === "favicon.ico") {
        res.writeHead(204);
        return res.end();
      }
      if (!publicFiles.has(file))
        throw new HttpError(404, "Página não encontrada.");
      if (privatePages.has(file)) {
        const user = await session(req);
        if (!user) {
          res.writeHead(303, {
            Location: "/entrar.html",
          });
          return res.end();
        }
        if (file === "perfil.html" && !(await hasProfile(user))) {
          res.writeHead(303, {
            Location: "/configurar-perfil.html",
          });
          return res.end();
        }
      }
      const content = await readFile(fileURLToPath(new URL(file, root)));
      res.writeHead(200, {
        "Content-Type": mime[file.split(".").pop()],
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (error instanceof URIError)
        return json(res, 400, {
          message: "Endereço inválido.",
        });
      const status = error.status || 500;
      if (status === 429) res.setHeader("Retry-After", "900");
      if (status === 500)
        console.error(
          "Erro interno ao processar solicitação. Nenhum dado do formulário foi registrado.",
        );
      if (!res.headersSent)
        json(res, status, {
          message:
            status === 500
              ? "Não foi possível concluir. Tente novamente em instantes."
              : error.message,
        });
      else res.end();
    }
  };
  const handler = async (req, res) => {
    await handle(req, res);
    // Keep the serverless invocation alive until SMTP settles and a failed token
    // is invalidated. Local HTTP behavior remains uniform for account privacy.
    await Promise.allSettled([...pendingMail]);
  };
  const server = createServer(handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 50;
  return {
    server,
    handler,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await Promise.allSettled([...pendingMail]);
      await db.close();
    },
  };
}
