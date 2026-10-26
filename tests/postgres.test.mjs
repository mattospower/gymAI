import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../server/app.mjs";
import { createRuntime } from "../server/runtime.mjs";
import { localPostgres } from "./helpers/postgres.mjs";

test("Vercel recusa SQLite efêmero e falta de segredos", async () => {
  await assert.rejects(createRuntime({ VERCEL: "1" }), /APP_ORIGIN/);
  await assert.rejects(
    createRuntime({ VERCEL: "1", APP_ORIGIN: "https://example.com" }),
    /DATA_ENCRYPTION_KEY/,
  );
  await assert.rejects(
    createRuntime({
      VERCEL: "1",
      APP_ORIGIN: "https://example.com",
      DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    }),
    /DATABASE_URL/,
  );
});

test(
  "PostgreSQL: contas, transações, todas as etapas e reinício",
  { timeout: 120000 },
  async (t) => {
    const key = randomBytes(32),
      encryptionKey = key.toString("hex");
    await mkdir(resolve("test-results"), { recursive: true });
    const dir = await mkdtemp(resolve("test-results/pg-"));
    const path = resolve(dir, "database");
    let db = await localPostgres(key, path);
    const origin = "http://localhost:3120",
      password = "Uma frase longa de teste PostgreSQL 42!",
      mail = [];
    const options = {
      origin,
      encryptionKey,
      sendRecovery: async (value) => mail.push(value),
    };
    let app = createApp({ ...options, store: db });
    const listen = () =>
      new Promise((r) => app.server.listen(3120, "127.0.0.1", r));
    await listen();
    const req = async (
      path,
      method = "GET",
      input,
      cookie = "",
      headers = {},
    ) => {
      const r = await fetch(origin + path, {
        method,
        redirect: "manual",
        headers: {
          Origin: origin,
          "X-GymIA-Request": "1",
          Connection: "close",
          ...(input ? { "Content-Type": "application/json" } : {}),
          Cookie: cookie,
          ...headers,
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      const raw = await r.text();
      return {
        status: r.status,
        data: r.headers.get("content-type")?.includes("application/json")
          ? JSON.parse(raw)
          : raw,
        cookie: r.headers.get("set-cookie")?.split(";")[0],
        headers: r.headers,
      };
    };
    const register = (address) =>
      req("/api/register", "POST", {
        name: "Conta fictícia PostgreSQL",
        email: address,
        password,
        confirmPassword: password,
        acceptTerms: true,
      });
    let first, second, plan, workout, event;
    try {
      await t.test("Cadastro, CSRF, cookies e isolamento", async () => {
        first = await register("pg-one@example.com");
        second = await register("pg-two@example.com");
        assert.equal(first.status, 201, JSON.stringify(first));
        assert.equal(second.status, 201);
        assert.match(
          first.headers.get("set-cookie"),
          /HttpOnly; SameSite=Strict/,
        );
        assert.equal(
          (
            await req("/api/profile", "PUT", {}, first.cookie, {
              Origin: "https://evil.example",
            })
          ).status,
          403,
        );
        assert.equal((await req("/perfil.html")).status, 303);
        for (const path of [
          "/.env",
          "/server/postgres.mjs",
          "/data/gymia.sqlite",
          "/.vercel/output/config.json",
        ])
          assert.equal((await req(path)).status, 404);
      });
      await t.test(
        "Perfil, configurações, catálogo e planos com versões concorrentes",
        async () => {
          const p = {
            goal: "forca",
            experience: "iniciante",
            days: 3,
            minutes: 45,
            location: "casa",
            equipment: ["peso-corporal"],
            limitations: "",
            sensitiveConsent: false,
          };
          assert.equal(
            (await req("/api/profile", "PUT", p, first.cookie)).status,
            200,
          );
          const prefs = (
            await req("/api/preferences", "GET", null, first.cookie)
          ).data.preferences;
          assert.equal(
            (
              await req(
                "/api/preferences",
                "PUT",
                { ...prefs, weekStart: 0 },
                first.cookie,
              )
            ).status,
            200,
          );
          const ex = (await req("/api/exercises", "GET", null, first.cookie))
            .data.exercises;
          assert.equal(ex.length, 40);
          const body = {
            name: "Plano PG",
            goal: "forca",
            description: "",
            sessions: [
              {
                name: "Sessão PG",
                day: "",
                exercises: [
                  {
                    exerciseId: ex[0].id,
                    sets: 1,
                    mode: "reps",
                    target: 8,
                    rest: 60,
                    notes: "",
                  },
                ],
              },
            ],
          };
          const created = await req("/api/plans", "POST", body, first.cookie);
          assert.equal(created.status, 200, JSON.stringify(created));
          plan = created.data.plan;
          const edits = await Promise.all(
            [1, 2].map((n) =>
              req(
                "/api/plans/" + plan.id,
                "PUT",
                { ...plan, name: "Plano PG " + n },
                first.cookie,
              ),
            ),
          );
          assert.deepEqual(edits.map((x) => x.status).sort(), [200, 409]);
          plan = (await req("/api/plans/" + plan.id, "GET", null, first.cookie))
            .data.plan;
          assert.equal(
            (await req("/api/plans/" + plan.id, "GET", null, second.cookie))
              .status,
            404,
          );
          assert.equal(
            (
              await req(
                `/api/plans/${plan.id}/versions`,
                "GET",
                null,
                first.cookie,
              )
            ).data.versions.length,
            2,
          );
          plan = (
            await req(
              `/api/plans/${plan.id}/activate`,
              "POST",
              { version: plan.version },
              first.cookie,
            )
          ).data.plan;
        },
      );
      await t.test(
        "Calendário recorrente, vínculo e execução reais",
        async () => {
          const d = new Date().toISOString().slice(0, 10),
            next = new Date(Date.now() + 7 * 86400000)
              .toISOString()
              .slice(0, 10);
          const series = await req(
            "/api/calendar-series",
            "POST",
            {
              planId: plan.id,
              sessionId: plan.sessions[0].id,
              startDate: d,
              until: next,
              intervalWeeks: 1,
              weekdays: [new Date(d).getUTCDay()],
            },
            first.cookie,
          );
          assert.equal(series.status, 200, JSON.stringify(series));
          const cal = await req(
            `/api/calendar?from=${d}&to=${next}`,
            "GET",
            null,
            first.cookie,
          );
          event = cal.data.events[0];
          assert.ok(event);
          const started = await req(
            `/api/calendar/${event.id}/start`,
            "POST",
            { version: event.version },
            first.cookie,
          );
          assert.equal(started.status, 200, JSON.stringify(started));
          workout = started.data.workout;
          workout.records[0].sets[0] = { completed: true, value: 8, load: 10 };
          const done = await req(
            `/api/workouts/${workout.id}`,
            "PUT",
            { ...workout, status: "completed" },
            first.cookie,
          );
          assert.equal(done.status, 200);
          workout = done.data.workout;
          assert.equal(
            (
              await req(
                `/api/workouts/${workout.id}`,
                "GET",
                null,
                second.cookie,
              )
            ).status,
            404,
          );
        },
      );
      await t.test(
        "Dashboard, histórico, relatório, CSV/JSON, exportação e assistente",
        async () => {
          assert.equal(
            (await req("/api/dashboard", "GET", null, first.cookie)).data
              .completed,
            1,
          );
          assert.equal(
            (await req("/api/workouts?limit=1", "GET", null, first.cookie)).data
              .workouts[0].id,
            workout.id,
          );
          for (const suffix of ["", "?format=json", "?format=csv"]) {
            const r = await req(
              "/api/reports" + suffix,
              "GET",
              null,
              first.cookie,
            );
            assert.equal(r.status, 200, JSON.stringify(r));
          }
          const exported = await req("/api/export", "GET", null, first.cookie);
          assert.equal(exported.status, 200);
          assert.equal(exported.data.calendarSeries.length, 1);
          assert.equal(
            (await req("/api/export", "GET", null, second.cookie)).data.plans
              .length,
            0,
          );
          const ai = await req(
            "/api/ai/chat",
            "POST",
            { message: "Como funciona o calendário?" },
            first.cookie,
          );
          assert.equal(ai.status, 200);
          assert.equal(ai.data.provider, "demo");
          const prefs = {
            goal: "forca",
            experience: "iniciante",
            days: 3,
            minutes: 45,
            equipment: ["peso-corporal"],
          };
          const draft = await req(
            "/api/ai/drafts",
            "POST",
            { message: "", preferences: prefs },
            first.cookie,
          );
          assert.equal(draft.status, 200, JSON.stringify(draft));
          assert.equal(
            (await req("/api/ai/drafts", "GET", null, first.cookie)).data.drafts
              .length,
            1,
          );
        },
      );
      await t.test(
        "Reinício preserva sessão e dados; recuperação revoga sessões e uso único",
        async () => {
          await app.close();
          db = await localPostgres(key, path);
          app = createApp({ ...options, store: db });
          await listen();
          assert.equal(
            (await req("/api/session", "GET", null, first.cookie)).data.user
              .email,
            "pg-one@example.com",
          );
          assert.equal(
            (await req("/api/dashboard", "GET", null, first.cookie)).data
              .completed,
            1,
          );
          assert.equal(
            (await req("/api/recover", "POST", { email: "pg-one@example.com" }))
              .status,
            200,
          );
          assert.equal(mail.length, 1);
          const token = new URL(mail[0].url).hash.slice(7),
            newer = password + " novo";
          assert.equal(
            (
              await req("/api/reset", "POST", {
                token,
                password: newer,
                confirmPassword: newer,
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await req("/api/reset", "POST", {
                token,
                password: newer,
                confirmPassword: newer,
              })
            ).status,
            400,
          );
          assert.equal(
            (await req("/api/profile", "GET", null, first.cookie)).status,
            401,
          );
          const login = await req("/api/login", "POST", {
            email: "pg-one@example.com",
            password: newer,
          });
          assert.equal(login.status, 200);
          assert.equal(
            (await req("/api/logout", "POST", {}, login.cookie)).status,
            200,
          );
          assert.equal(
            (await req("/api/profile", "GET", null, login.cookie)).status,
            401,
          );
        },
      );
      await t.test(
        "Rollback e integridade não deixam gravações parciais",
        async () => {
          const id = randomUUID();
          await assert.rejects(
            db.transaction(async () => {
              await db
                .prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)")
                .run(id, "rollback@example.com", "Teste", "hash", "v", 1, 1);
              throw Error("rollback");
            }, "test"),
          );
          assert.equal(
            await db.prepare("SELECT id FROM users WHERE id=?").get(id),
            undefined,
          );
          await assert.rejects(
            db
              .prepare("INSERT INTO profiles VALUES(?,?,?)")
              .run("missing-user", "payload", 1),
          );
        },
      );
    } finally {
      await app.close();
    }
  },
);
