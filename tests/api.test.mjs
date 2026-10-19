import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/app.mjs";

const origin = "http://localhost:3101";
const encryptionKey = randomBytes(32).toString("hex");
const password = "Uma frase de senha muito forte 42!";
const newPassword = "Outra frase de senha bem diferente 85!";
const training = {
  goal: "hipertrofia",
  experience: "iniciante",
  days: 3,
  minutes: 45,
  location: "academia",
  equipment: ["halteres", "peso-corporal"],
  otherEquipment: "",
  limitations: "Restrição privada de teste",
  sensitiveConsent: true,
};
const registration = (address) => ({
  name: "Pessoa de Teste",
  email: address,
  password,
  confirmPassword: password,
  acceptTerms: true,
});

test("Contas, dados privados e recuperação com banco real", async (t) => {
  const parent = resolve("test-results");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "api-"));
  let time = Date.now();
  const sent = [];
  const options = {
    origin,
    databasePath: join(dir, "gymia.sqlite"),
    encryptionKey,
    now: () => time,
    sendRecovery: async (mail) => {
      sent.push(mail);
    },
  };
  let app = createApp(options);
  await new Promise((resolve) => app.server.listen(3101, "127.0.0.1", resolve));
  const request = async (
    path,
    method = "GET",
    input,
    cookie = "",
    headers = {},
  ) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      redirect: "manual",
      headers: {
        Origin: origin,
        "X-GymIA-Request": "1",
        Connection: "close",
        ...(input ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      data: response.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(text)
        : text,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  let first, second, secondId;
  try {
    await t.test(
      "Protege páginas privadas e não serve arquivos internos",
      async () => {
        for (const page of ["/perfil.html", "/configurar-perfil.html"]) {
          const result = await request(page);
          assert.equal(result.status, 303);
          assert.equal(result.headers.get("location"), "/entrar.html");
        }
        for (const path of [
          "/.env",
          "/data/gymia.sqlite",
          "/server/app.mjs",
          "/package.json",
          "/%2e%2e/.env",
        ])
          assert.equal((await request(path)).status, 404);
        assert.equal((await request("/api/profile")).status, 401);
        assert.equal((await request("/api/session")).data.user, null);
      },
    );
    await t.test(
      "Valida cadastro e impede solicitações de outra origem",
      async () => {
        assert.equal(
          (
            await request("/api/register", "POST", {
              ...registration("a@example.com"),
              acceptTerms: false,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("/api/register", "POST", {
              ...registration("a@example.com"),
              password: "curta",
              confirmPassword: "curta",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/api/register",
              "POST",
              registration("a@example.com"),
              "",
              { Origin: "https://outro.site" },
            )
          ).status,
          403,
        );
        const result = await request(
          "/api/register",
          "POST",
          registration("a@example.com"),
        );
        assert.equal(result.status, 201);
        assert.equal(result.data.user.hasProfile, false);
        assert.match(
          result.headers.get("set-cookie"),
          /HttpOnly; SameSite=Strict/,
        );
        first = result.cookie;
        assert.equal(
          (await request("/perfil.html", "GET", null, first)).headers.get(
            "location",
          ),
          "/configurar-perfil.html",
        );
        const user = app.db.prepare("SELECT * FROM users").get();
        assert.match(user.password_hash, /^scrypt\$131072\$8\$1\$/);
        assert.ok(!user.password_hash.includes(password));
        assert.ok(!JSON.stringify(result.data).includes(user.password_hash));
      },
    );
    await t.test(
      "Valida perfil, exige consentimento e criptografa dados",
      async () => {
        assert.equal(
          (
            await request(
              "/api/profile",
              "PUT",
              { ...training, sensitiveConsent: false },
              first,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/api/profile",
              "PUT",
              { ...training, equipment: [] },
              first,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/api/profile",
              "PUT",
              { ...training, days: 8 },
              first,
            )
          ).status,
          400,
        );
        assert.equal(
          (await request("/api/profile", "PUT", training, first)).status,
          200,
        );
        assert.equal(
          (await request("/api/profile", "GET", null, first)).data.profile
            .limitations,
          training.limitations,
        );
        assert.ok(
          !app.db
            .prepare("SELECT payload FROM profiles")
            .get()
            .payload.includes(training.limitations),
        );
        assert.ok(
          !readFileSync(options.databasePath).includes(
            Buffer.from(training.limitations),
          ),
        );
      },
    );
    await t.test(
      "Persiste perfil e sessão após reiniciar o servidor",
      async () => {
        await app.close();
        app = createApp(options);
        await new Promise((resolve) =>
          app.server.listen(3101, "127.0.0.1", resolve),
        );
        assert.equal(
          (await request("/api/profile", "GET", null, first)).data.profile.goal,
          "hipertrofia",
        );
        assert.throws(
          () =>
            createApp({
              ...options,
              encryptionKey: randomBytes(32).toString("hex"),
            }),
          /chave de criptografia/,
        );
      },
    );
    await t.test(
      "Isola contas e ignora tentativa de alterar o dono do perfil",
      async () => {
        const result = await request(
          "/api/register",
          "POST",
          registration("b@example.com"),
        );
        assert.equal(result.status, 201);
        second = result.cookie;
        secondId = result.data.user.id;
        assert.equal(
          (await request("/api/profile", "GET", null, second)).data.profile,
          null,
        );
        await request(
          "/api/profile",
          "PUT",
          {
            ...training,
            goal: "forca",
            user_id: secondId,
            userId: secondId,
            limitations: "",
            sensitiveConsent: false,
          },
          first,
        );
        assert.equal(
          (await request("/api/profile", "GET", null, second)).data.profile,
          null,
        );
        assert.equal(
          (await request("/api/profile", "GET", null, first)).data.profile.goal,
          "forca",
        );
      },
    );
    await t.test(
      "Login real, erro genérico, rotação de cookie e logout",
      async () => {
        assert.equal(
          (
            await request("/api/login", "POST", {
              email: "a@example.com",
              password: "Senha errada",
            })
          ).status,
          401,
        );
        const result = await request(
          "/api/login",
          "POST",
          { email: "a@example.com", password },
          first,
        );
        assert.equal(result.status, 200);
        assert.notEqual(result.cookie, first);
        assert.equal(
          (await request("/api/profile", "GET", null, first)).status,
          401,
        );
        first = result.cookie;
        await request("/api/logout", "POST", {}, first);
        assert.equal(
          (await request("/api/profile", "GET", null, first)).status,
          401,
        );
        first = (
          await request("/api/login", "POST", {
            email: "a@example.com",
            password,
          })
        ).cookie;
      },
    );
    await t.test(
      "Recuperação não revela contas e links são de uso único",
      async () => {
        const unknown = await request("/api/recover", "POST", {
          email: "semconta@example.com",
        });
        const known = await request("/api/recover", "POST", {
          email: "a@example.com",
        });
        assert.deepEqual(known.data, unknown.data);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, "a@example.com");
        assert.ok(sent[0].url.includes("#token="));
        const resetToken = new URLSearchParams(
          new URL(sent[0].url).hash.slice(1),
        ).get("token");
        assert.ok(
          !app.db
            .prepare("SELECT token_hash FROM resets")
            .get()
            .token_hash.includes(resetToken),
        );
        const input = {
          token: resetToken,
          password: newPassword,
          confirmPassword: newPassword,
        };
        assert.equal((await request("/api/reset", "POST", input)).status, 200);
        assert.equal((await request("/api/reset", "POST", input)).status, 400);
        assert.equal(
          (await request("/api/profile", "GET", null, first)).status,
          401,
        );
        assert.equal(
          (
            await request("/api/login", "POST", {
              email: "a@example.com",
              password,
            })
          ).status,
          401,
        );
        const result = await request("/api/login", "POST", {
          email: "a@example.com",
          password: newPassword,
        });
        assert.equal(result.status, 200);
        first = result.cookie;
      },
    );
    await t.test(
      "Links e sessões expiram; proteção contra excesso de tentativas",
      async () => {
        await request("/api/recover", "POST", { email: "a@example.com" });
        const resetToken = new URLSearchParams(
          new URL(sent.at(-1).url).hash.slice(1),
        ).get("token");
        time += 31 * 60 * 1000;
        assert.equal(
          (
            await request("/api/reset", "POST", {
              token: resetToken,
              password,
              confirmPassword: password,
            })
          ).status,
          400,
        );
        for (let i = 0; i < 5; i++)
          assert.equal(
            (
              await request("/api/recover", "POST", {
                email: "semconta@example.com",
              })
            ).status,
            200,
          );
        assert.equal(
          (
            await request("/api/recover", "POST", {
              email: "semconta@example.com",
            })
          ).status,
          429,
        );
        time += 12 * 60 * 60 * 1000;
        assert.equal(
          (await request("/api/profile", "GET", null, first)).status,
          401,
        );
        first = (
          await request("/api/login", "POST", {
            email: "a@example.com",
            password: newPassword,
          })
        ).cookie;
      },
    );
    await t.test(
      "Retira consentimento e exclui dados e sessões com reautenticação",
      async () => {
        const erased = await request(
          "/api/profile",
          "PUT",
          { ...training, limitations: "", sensitiveConsent: false },
          first,
        );
        assert.equal(erased.data.profile.sensitiveConsentAt, null);
        assert.equal(
          (
            await request(
              "/api/account",
              "DELETE",
              { password: "errada", confirmation: "EXCLUIR" },
              first,
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await request(
              "/api/account",
              "DELETE",
              { password: newPassword, confirmation: "EXCLUIR" },
              first,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("/api/profile", "GET", null, first)).status,
          401,
        );
        assert.equal(
          app.db.prepare("SELECT count(*) AS n FROM profiles").get().n,
          0,
        );
        assert.equal(
          app.db.prepare("SELECT count(*) AS n FROM resets").get().n,
          0,
        );
        const users = app.db.prepare("SELECT * FROM users").all();
        assert.equal(users.length, 1);
        assert.equal(users[0].id, secondId);
      },
    );
    await t.test("Headers de segurança, CSP e páginas estáticas", async () => {
      const result = await request("/");
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.ok(
        result.headers
          .get("content-security-policy")
          .includes("script-src 'self'"),
      );
      assert.equal(result.headers.get("referrer-policy"), "no-referrer");
      for (const file of readdirSync(".").filter((name) =>
        name.endsWith(".html"),
      )) {
        const html = readFileSync(file, "utf8");
        assert.match(html, /^<!doctype html>/i, file);
        assert.ok(html.includes('href="style.css"'), file);
        assert.ok(!html.includes('href="#"'), file);
      }
      const css = await request("/style.css");
      assert.equal(css.status, 200);
      assert.ok(css.headers.get("content-type").startsWith("text/css"));
    });
    await t.test(
      "Configuração incompleta é informada; produção exige HTTPS",
      async () => {
        assert.throws(
          () => createApp({ ...options, production: true }),
          /HTTPS/,
        );
        const offline = createApp({
          ...options,
          origin: "http://localhost:3102",
          databasePath: ":memory:",
          sendRecovery: null,
        });
        await new Promise((resolve) =>
          offline.server.listen(3102, "127.0.0.1", resolve),
        );
        try {
          assert.equal(
            (await (await fetch("http://localhost:3102/api/config")).json())
              .passwordRecoveryAvailable,
            false,
          );
          const response = await fetch("http://localhost:3102/api/recover", {
            method: "POST",
            headers: {
              Origin: "http://localhost:3102",
              "X-GymIA-Request": "1",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ email: "a@example.com" }),
          });
          assert.equal(response.status, 503);
        } finally {
          await offline.close();
        }
      },
    );
  } finally {
    await app.close();
    if (!resolve(dir).startsWith(parent + sep))
      throw new Error("Diretório de teste fora do local esperado.");
    rmSync(dir, { recursive: true, force: true });
  }
});
