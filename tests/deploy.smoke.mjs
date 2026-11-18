import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, lstat, mkdtemp, mkdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

test("Pacote Vercel independente: rotas, autenticação e ausência de dados/segredos", async () => {
  const fn = resolve(".vercel/output/functions/gymia.func"),
    root = resolve(".");
  const config = JSON.parse(
    await readFile(join(fn, ".vc-config.json"), "utf8"),
  );
  assert.equal(config.runtime, "nodejs24.x");
  assert.equal(config.supportsResponseStreaming, true);
  const all = [];
  async function walk(dir) {
    for (const item of await readdir(dir)) {
      const path = join(dir, item),
        stat = await lstat(path);
      assert.equal(stat.isSymbolicLink(), false, "Pacote deve ser portátil");
      if (stat.isDirectory()) await walk(path);
      else all.push(relative(fn, path).replaceAll("\\", "/"));
    }
  }
  await walk(fn);
  assert.ok(
    !all.some((p) =>
      /(^|\/)(?:\.env(?:\.|$)|data|test-results|tests|backups|\.git)(\/|$)|\.sqlite/.test(
        p,
      ),
    ),
  );
  assert.ok(!all.some((p) => /playwright|pglite|\.modules\.yaml/.test(p)));
  for (const file of [
    "style.css",
    "index.html",
    "assets/api.js",
    "server/migrations/postgres/001.sql",
  ])
    assert.deepEqual(
      await readFile(join(fn, file)),
      await readFile(join(root, file)),
    );
  const require = createRequire(join(fn, "package.json"));
  for (const name of ["pg", "nodemailer"])
    assert.ok(require.resolve(name).startsWith(fn));
  await mkdir(resolve("test-results"), { recursive: true });
  const dir = await mkdtemp(resolve("test-results/package-"));
  Object.assign(process.env, {
    VERCEL: "0",
    NODE_ENV: "test",
    APP_ORIGIN: "http://localhost:3123",
    DATABASE_URL: "",
    DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    DATABASE_PATH: join(dir, "test.sqlite"),
  });
  const { default: handler } = await import(
    pathToFileURL(join(fn, "api/index.mjs"))
  );
  const server = createServer(handler);
  await new Promise((r) => server.listen(3123, "127.0.0.1", r));
  try {
    for (const route of ["/", "/style.css", "/assets/api.js", "/api/config"]) {
      const r = await fetch(process.env.APP_ORIGIN + route);
      assert.equal(r.status, 200, route);
      assert.equal(r.headers.get("x-frame-options"), "DENY");
    }
    const password = "Uma senha fictícia para testar o pacote!";
    const r = await fetch(process.env.APP_ORIGIN + "/api/register", {
      method: "POST",
      headers: {
        Origin: process.env.APP_ORIGIN,
        "X-GymIA-Request": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Conta fictícia",
        email: "package@example.com",
        password,
        confirmPassword: password,
        acceptTerms: true,
      }),
    });
    assert.equal(r.status, 201);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (
        await fetch(process.env.APP_ORIGIN + "/api/dashboard", {
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(process.env.APP_ORIGIN + "/perfil.html", {
          redirect: "manual",
        })
      ).status,
      303,
    );
    for (const route of [
      "/.env",
      "/server/app.mjs",
      "/package.json",
      "/data/gymia.sqlite",
    ])
      assert.equal((await fetch(process.env.APP_ORIGIN + route)).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
