import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.mjs";
import { createProvider, validateDraft } from "../server/ai.mjs";
import { encrypt } from "../server/security.mjs";
import { localDay, shiftDate } from "../server/evolution.mjs";
import { openStore } from "../server/store.mjs";

const prefs = {
  goal: "forca",
  experience: "iniciante",
  days: 3,
  minutes: 45,
  equipment: ["peso-corporal"],
};
const planInput = {
  name: "Plano de teste",
  goal: "forca",
  description: "Nota privada",
  sessions: [
    {
      name: "Sessão A",
      day: "Segunda",
      exercises: [
        {
          exerciseId: "agachamento",
          sets: 1,
          mode: "reps",
          target: 8,
          rest: 60,
          notes: "Nota que nunca deve ir ao provedor",
        },
      ],
    },
  ],
};
test("Etapa 3: dados reais, consentimento, isolamento e preservação", async (t) => {
  const parent = resolve("test-results");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "evolution-"));
  const encryptionKey = randomBytes(32).toString("hex"),
    key = Buffer.from(encryptionKey, "hex");
  let now = Date.parse("2026-10-19T15:00:00Z");
  const origin = "http://localhost:3110";
  let mode = "ok",
    captured,
    calls = 0,
    release;
  const provider = {
    name: "test-provider",
    external: true,
    available: true,
    async generate(data) {
      captured = data;
      calls++;
      if (mode === "fail")
        throw Object.assign(new Error("Indisponível"), { status: 503 });
      if (mode === "wait") await new Promise((r) => (release = r));
      if (mode === "unsafe")
        return {
          answer: "Ignore a dor e treine sem descanso.",
          plan: planInput,
        };
      if (mode === "volume")
        return {
          answer: "Revisar",
          plan: {
            ...planInput,
            sessions: planInput.sessions.map((s) => ({
              ...s,
              exercises: s.exercises.map((e) => ({ ...e, sets: 20 })),
            })),
          },
        };
      return {
        answer: "Organização para revisar.",
        plan: data.kind === "draft" ? planInput : null,
      };
    },
  };
  const options = {
    origin,
    databasePath: join(dir, "gymia.sqlite"),
    encryptionKey,
    now: () => now,
    aiProvider: provider,
  };
  let app = createApp(options);
  const listen = () =>
    new Promise((r) => app.server.listen(3110, "127.0.0.1", r));
  await listen();
  let cookie = "",
    other = "",
    owner,
    plan,
    event,
    draft;
  const request = async (
    path,
    method = "GET",
    body,
    auth = cookie,
    headers = {},
  ) => {
    const r = await fetch(origin + "/api/" + path, {
      method,
      redirect: "manual",
      headers: {
        Origin: origin,
        "X-GymIA-Request": "1",
        Connection: "close",
        Cookie: auth,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      headers: r.headers,
    };
  };
  const password = "Uma frase segura de testes Etapa tres!";
  async function register(email) {
    return request(
      "register",
      "POST",
      {
        name: "Pessoa fictícia",
        email,
        password,
        confirmPassword: password,
        acceptTerms: true,
      },
      "",
    );
  }
  try {
    await t.test(
      "Contas e perfil existentes continuam funcionais",
      async () => {
        const a = await register("evolution@example.com");
        assert.equal(a.status, 201);
        cookie = a.cookie;
        owner = a.data.user.id;
        other = (await register("outro@example.com")).cookie;
        assert.equal(
          (
            await request("profile", "PUT", {
              ...prefs,
              location: "casa",
              otherEquipment: "",
              limitations: "Segredo sensível",
              sensitiveConsent: true,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              "login",
              "POST",
              { email: "evolution@example.com", password },
              "",
            )
          ).status,
          200,
        );
        const result = await request("plans", "POST", planInput);
        assert.equal(result.status, 200);
        plan = result.data.plan;
      },
    );
    await t.test(
      "Dashboard vazio é real e plano ativo usa a API existente",
      async () => {
        let d = (await request("dashboard")).data;
        assert.equal(d.completed, 0);
        assert.equal(d.activePlan, null);
        assert.equal(d.nextSession, null);
        assert.deepEqual(d.recent, []);
        plan = (
          await request(`plans/${plan.id}/activate`, "POST", {
            version: plan.version,
          })
        ).data.plan;
        assert.equal((await request("dashboard")).data.activePlan.id, plan.id);
      },
    );
    await t.test(
      "Calendário valida, edita, detecta conflito e não cria registros",
      async () => {
        const input = {
          date: "2026-10-21",
          planId: plan.id,
          sessionId: plan.sessions[0].id,
        };
        assert.equal(
          (await request("calendar", "POST", { ...input, date: "2026-02-31" }))
            .status,
          400,
        );
        assert.equal(
          (await request("calendar", "POST", { ...input, date: "2026-10-18" }))
            .status,
          400,
        );
        event = (await request("calendar", "POST", input)).data.event;
        assert.ok(event.id);
        const stale = { ...event };
        event = (
          await request(`calendar/${event.id}`, "PUT", {
            ...event,
            date: "2026-10-22",
          })
        ).data.event;
        assert.equal(event.version, 2);
        assert.equal(
          (await request(`calendar/${event.id}`, "PUT", stale)).status,
          409,
        );
        assert.equal((await request("workouts")).data.workouts.length, 0);
        assert.equal(
          (await request("dashboard")).data.nextSession.date,
          "2026-10-22",
        );
        assert.equal(
          (await request("calendar?from=2026-10-01&to=2026-10-31")).data.events
            .length,
          1,
        );
        assert.equal(
          (await request("calendar?from=2026-01-01&to=2029-01-01")).status,
          400,
        );
      },
    );
    await t.test(
      "Estatísticas calculam valores, estados, períodos e fuso",
      async () => {
        for (const [status, started, value, load] of [
          ["completed", "2026-10-18T01:00:00Z", 8, 12.5],
          ["partial", "2026-10-19T01:00:00Z", 6, null],
          ["completed", "2026-10-15T12:00:00Z", 4, 10],
        ]) {
          let w = (
            await request("workouts", "POST", {
              planId: plan.id,
              sessionId: plan.sessions[0].id,
            })
          ).data.workout;
          w.records[0].sets[0] = { completed: true, value, load };
          assert.equal(
            (await request(`workouts/${w.id}`, "PUT", { ...w, status })).status,
            200,
          );
          app.db
            .prepare("UPDATE workout_logs SET started_at=? WHERE id=?")
            .run(Date.parse(started), w.id);
        }
        const stats = (
          await request("statistics?from=2026-10-17&to=2026-10-19")
        ).data;
        assert.equal(stats.current.total, 2);
        assert.equal(stats.previous.total, 1);
        assert.equal(stats.current.completed, 1);
        assert.equal(stats.current.partial, 1);
        assert.equal(stats.current.averageGapDays, 1);
        assert.equal(stats.current.daysRecorded, 2);
        assert.equal(stats.current.timeline[0].date, "2026-10-17");
        assert.equal(stats.current.timeline[0].maxLoad, 12.5);
        assert.equal(stats.current.timeline[1].maxLoad, null);
        assert.equal(stats.current.timeline[1].values, 6);
        assert.equal(
          (
            await request(
              "statistics?from=2026-10-17&to=2026-10-19&status=completed",
            )
          ).data.current.total,
          1,
        );
        assert.equal(
          (
            await request(
              "statistics?from=2026-10-17&to=2026-10-19&exerciseId=prancha",
            )
          ).data.current.total,
          0,
        );
        assert.equal((await request("statistics?exerciseId=bad")).status, 400);
        assert.equal(
          (await request("statistics?from=2026-10-30&to=2026-10-01")).status,
          400,
        );
        assert.equal((await request("dashboard")).data.completed, 2);
        const calendar = (
          await request("calendar?from=2026-10-17&to=2026-10-19")
        ).data;
        assert.equal(calendar.workouts.length, 2);
        assert.equal(calendar.workouts[0].date, "2026-10-17");
        assert.equal(
          localDay(Date.parse("2026-10-19T01:00:00Z"), "America/Sao_Paulo"),
          "2026-10-18",
        );
        assert.equal(shiftDate("2024-02-28", 1), "2024-02-29");
      },
    );
    await t.test(
      "Consentimentos são separados e versionados; mensagem e contexto são mínimos",
      async () => {
        assert.equal(
          (
            await request("ai/chat", "POST", {
              message: "Olá",
              externalConsent: true,
            })
          ).status,
          403,
        );
        assert.equal(calls, 0);
        let p = (await request("preferences")).data.preferences;
        assert.equal(
          (await request("preferences", "PUT", { ...p, timeZone: "bad" }))
            .status,
          400,
        );
        p = (await request("preferences", "PUT", { ...p, aiConsent: true }))
          .data.preferences;
        assert.equal(
          (
            await request("ai/chat", "POST", {
              message: "Explique séries",
              useProfile: true,
              externalConsent: true,
            })
          ).status,
          403,
        );
        const stale = { ...p };
        p = (
          await request("preferences", "PUT", { ...p, aiProfileConsent: true })
        ).data.preferences;
        assert.equal((await request("preferences", "PUT", stale)).status, 409);
        assert.equal(
          (
            await request("ai/chat", "POST", {
              message: "Explique séries",
              useProfile: true,
              planId: plan.id,
              externalConsent: true,
            })
          ).status,
          200,
        );
        assert.deepEqual(captured.preferences, prefs);
        assert.ok(!JSON.stringify(captured).includes("Segredo"));
        assert.ok(!JSON.stringify(captured).includes("Nota"));
        assert.ok(!JSON.stringify(captured).includes("example.com"));
        assert.equal(
          (
            await request("ai/chat", "POST", {
              message: "x".repeat(2001),
              externalConsent: true,
            })
          ).status,
          400,
        );
        const count = calls;
        assert.equal(
          (
            await request("ai/chat", "POST", {
              message: "Treinar com dor e lesão",
              externalConsent: true,
            })
          ).status,
          200,
        );
        assert.equal(calls, count);
      },
    );
    await t.test(
      "Rascunho é criptografado, não ativa plano e exige revisão para salvar",
      async () => {
        const before = (await request("plans")).data.plans.length;
        const r = await request("ai/drafts", "POST", {
          preferences: prefs,
          externalConsent: true,
        });
        assert.equal(r.status, 200);
        draft = r.data.draft;
        assert.equal((await request("plans")).data.plans.length, before);
        assert.ok(
          !app.db
            .prepare("SELECT payload FROM ai_drafts")
            .get()
            .payload.includes("Plano de teste"),
        );
        assert.equal(
          (
            await request(`ai/drafts/${draft.id}/save`, "POST", {
              plan: draft.plan,
            })
          ).status,
          400,
        );
        const saved = await request(`ai/drafts/${draft.id}/save`, "POST", {
          reviewed: true,
          plan: { ...draft.plan, name: "Revisado" },
        });
        assert.equal(saved.status, 200);
        assert.equal(saved.data.plan.status, "saved");
        assert.equal(saved.data.plan.name, "Revisado");
        assert.equal((await request("dashboard")).data.activePlan.id, plan.id);
        assert.equal((await request(`ai/drafts/${draft.id}`)).status, 404);
      },
    );
    await t.test(
      "Falhas, volume e conteúdo inseguro não salvam planos",
      async () => {
        const n = (await request("plans")).data.plans.length;
        for (const [m, status] of [
          ["fail", 503],
          ["unsafe", 502],
          ["volume", 422],
        ]) {
          mode = m;
          assert.equal(
            (
              await request("ai/drafts", "POST", {
                preferences: prefs,
                externalConsent: true,
              })
            ).status,
            status,
          );
        }
        mode = "ok";
        assert.equal((await request("plans")).data.plans.length, n);
        assert.throws(() =>
          validateDraft(
            {
              ...planInput,
              sessions: [
                {
                  ...planInput.sessions[0],
                  exercises: [
                    {
                      ...planInput.sessions[0].exercises[0],
                      exerciseId: "remada-halter",
                    },
                  ],
                },
              ],
            },
            prefs,
          ),
        );
      },
    );
    await t.test(
      "Retirada de consentimento durante chamada descarta a resposta",
      async () => {
        mode = "wait";
        const pending = request("ai/chat", "POST", {
          message: "Explique séries",
          externalConsent: true,
        });
        for (let i = 0; i < 100 && !release; i++)
          await new Promise((r) => setTimeout(r, 5));
        assert.ok(release);
        assert.equal(
          (
            await request("ai/chat", "POST", {
              message: "Outro pedido",
              externalConsent: true,
            })
          ).status,
          429,
        );
        let p = (await request("preferences")).data.preferences;
        await request("preferences", "PUT", {
          ...p,
          aiConsent: false,
          aiProfileConsent: false,
        });
        release();
        assert.equal((await pending).status, 409);
        mode = "ok";
      },
    );
    await t.test(
      "Isolamento, CSRF, exportação e calendário cancelado preservam histórico",
      async () => {
        assert.equal(
          (await request(`calendar/${event.id}`, "PUT", event, other)).status,
          404,
        );
        assert.equal(
          (
            await request(
              `calendar/${event.id}`,
              "DELETE",
              { version: event.version, confirmation: "CANCELAR" },
              other,
            )
          ).status,
          404,
        );
        assert.deepEqual(
          (
            await request(
              "calendar?from=2026-10-01&to=2026-10-31",
              "GET",
              null,
              other,
            )
          ).data.events,
          [],
        );
        assert.equal(
          (await request("statistics", "GET", null, other)).data.current.total,
          0,
        );
        assert.equal(
          (await request("dashboard", "GET", null, other)).data.completed,
          0,
        );
        assert.equal(
          (await request("export", "GET", null, other)).data.workouts.length,
          0,
        );
        const p = (await request("preferences")).data.preferences;
        assert.equal(
          (
            await request("preferences", "PUT", p, cookie, {
              Origin: "https://evil.invalid",
            })
          ).status,
          403,
        );
        const ex = await request("export");
        assert.equal(ex.status, 200);
        assert.equal(ex.data.workouts.length, 3);
        assert.equal(ex.data.profile.limitations, "Segredo sensível");
        assert.ok(!JSON.stringify(ex.data).includes("password_hash"));
        assert.ok(!JSON.stringify(ex.data).includes(encryptionKey));
        assert.match(ex.headers.get("content-disposition"), /attachment/);
        assert.equal(
          (
            await request(`calendar/${event.id}`, "DELETE", {
              version: event.version,
              confirmation: "CANCELAR",
            })
          ).status,
          200,
        );
        assert.equal((await request("workouts")).data.workouts.length, 3);
        for (const path of [
          "preferences",
          "dashboard",
          "statistics",
          "calendar",
          "export",
          "ai/config",
        ])
          assert.equal((await request(path, "GET", null, "")).status, 401);
      },
    );
    await t.test(
      "Migração 2→3 preserva todos os dados antigos e reinício mantém preferências",
      async () => {
        const running = (
          await request("workouts", "POST", {
            planId: plan.id,
            sessionId: plan.sessions[0].id,
          })
        ).data.workout;
        const snapshots = Object.fromEntries(
          [
            "users",
            "profiles",
            "sessions",
            "training_plans",
            "workout_logs",
            "settings",
          ].map((name) => [
            name,
            app.db.prepare(`SELECT * FROM ${name}`).all(),
          ]),
        );
        await app.close();
        const legacy = new DatabaseSync(options.databasePath);
        legacy.exec(
          "DROP TRIGGER plan_created_version; DROP TRIGGER plan_updated_version; DROP TABLE plan_versions; DROP TABLE calendar_links; DROP TABLE calendar_occurrences; DROP TABLE calendar_series; DROP INDEX workouts_owner_plan_date; DROP TABLE user_preferences; DROP TABLE calendar_events; DROP TABLE ai_drafts; PRAGMA user_version=2;",
        );
        legacy.close();
        app = createApp(options);
        await listen();
        assert.equal(
          app.db.prepare("PRAGMA user_version").get().user_version,
          4,
        );
        for (const [name, rows] of Object.entries(snapshots))
          assert.deepEqual(app.db.prepare(`SELECT * FROM ${name}`).all(), rows);
        assert.equal(
          (await request(`workouts/${running.id}`)).data.workout.status,
          "in_progress",
        );
        let p = (await request("preferences")).data.preferences;
        await request("preferences", "PUT", {
          ...p,
          calendarView: "week",
          timeZone: "America/Manaus",
        });
        event = (
          await request("calendar", "POST", {
            date: "2026-10-25",
            planId: plan.id,
            sessionId: plan.sessions[0].id,
          })
        ).data.event;
        await app.close();
        app = createApp(options);
        await listen();
        assert.equal(
          (await request("preferences")).data.preferences.calendarView,
          "week",
        );
        assert.equal(
          (await request("dashboard")).data.nextSession.id,
          event.id,
        );
        assert.equal(
          (await request("profile")).data.profile.limitations,
          "Segredo sensível",
        );
        assert.throws(
          () =>
            createApp({
              ...options,
              encryptionKey: randomBytes(32).toString("hex"),
            }),
          /chave/,
        );
      },
    );
    await t.test(
      "Dashboard, exportação e estatísticas não truncam em 500",
      async () => {
        const sample = (await request("workouts")).data.workouts[0];
        for (let i = 0; i < 501; i++) {
          const id = randomUUID();
          app.db
            .prepare(
              "INSERT INTO workout_logs (id,user_id,plan_id,plan_ref,status,payload,version,started_at,finished_at) VALUES (?,?,?,?,?,?,1,?,?)",
            )
            .run(
              id,
              owner,
              plan.id,
              plan.id,
              "completed",
              encrypt(
                {
                  snapshot: sample.snapshot,
                  notes: "",
                  records: sample.records,
                },
                key,
                `workout:${owner}:${id}`,
              ),
              now,
              now,
            );
        }
        assert.equal((await request("dashboard")).data.completed, 503);
        assert.equal((await request("export")).data.workouts.length, 505);
        assert.equal(
          (await request("statistics?from=2026-10-01&to=2026-10-31")).data
            .current.total,
          504,
        );
      },
    );
    await t.test(
      "Rascunhos podem ser retomados, descartados e não vazam para outra conta",
      async () => {
        let p = (await request("preferences")).data.preferences;
        await request("preferences", "PUT", { ...p, aiConsent: true });
        const r = await request("ai/drafts", "POST", {
          preferences: prefs,
          externalConsent: true,
        });
        draft = r.data.draft;
        assert.ok(draft);
        assert.equal((await request("ai/drafts")).data.drafts.length, 1);
        assert.deepEqual(
          (await request("ai/drafts", "GET", null, other)).data.drafts,
          [],
        );
        assert.equal(
          (await request(`ai/drafts/${draft.id}`, "GET", null, other)).status,
          404,
        );
        assert.equal(
          (
            await request(
              `ai/drafts/${draft.id}/save`,
              "POST",
              { reviewed: true, plan: draft.plan },
              other,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `ai/drafts/${draft.id}`,
              "DELETE",
              { confirmation: "DESCARTAR" },
              other,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(`ai/drafts/${draft.id}`, "DELETE", {
              confirmation: "DESCARTAR",
            })
          ).status,
          200,
        );
        assert.deepEqual((await request("ai/drafts")).data.drafts, []);
      },
    );
    await t.test(
      "Limite de uso da IA persiste e bloqueia excesso",
      async () => {
        app.db.prepare("DELETE FROM rate_limits WHERE key LIKE 'ai:%'").run();
        for (let i = 0; i < 20; i++)
          assert.equal(
            (
              await request("ai/chat", "POST", {
                message: "Conceitos",
                externalConsent: true,
              })
            ).status,
            200,
          );
        assert.equal(
          (
            await request("ai/chat", "POST", {
              message: "Conceitos",
              externalConsent: true,
            })
          ).status,
          429,
        );
        await app.close();
        app = createApp(options);
        await listen();
        assert.equal(
          (
            await request("ai/chat", "POST", {
              message: "Conceitos",
              externalConsent: true,
            })
          ).status,
          429,
        );
      },
    );
    await t.test(
      "Conta excluída remove tabelas novas por cascata",
      async () => {
        assert.equal(
          (
            await request("account", "DELETE", {
              password,
              confirmation: "EXCLUIR",
            })
          ).status,
          200,
        );
        for (const table of [
          "user_preferences",
          "calendar_events",
          "ai_drafts",
        ])
          assert.equal(
            app.db
              .prepare(`SELECT count(*) n FROM ${table} WHERE user_id=?`)
              .get(owner).n,
            0,
          );
        assert.equal(
          (await request("session", "GET", null, other)).data.user.email,
          "outro@example.com",
        );
      },
    );
  } finally {
    await app.close();
    if (!resolve(dir).startsWith(parent + sep))
      throw new Error("Pasta de teste inesperada");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Adaptador OpenAI: contrato real e falhas controladas sem rede", async () => {
  let call;
  const env = {
    AI_PROVIDER: "openai",
    AI_ALLOW_PAID: "true",
    OPENAI_API_KEY: "test-key-only",
    AI_MODEL: "configured-model",
  };
  const provider = createProvider(env, async (url, options) => {
    call = { url, options };
    return new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ answer: "Texto válido", plan: null }),
              },
            ],
          },
        ],
      }),
    );
  });
  assert.equal(
    (await provider.generate({ kind: "chat", message: "Teste" })).answer,
    "Texto válido",
  );
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  const payload = JSON.parse(call.options.body);
  assert.equal(payload.store, false);
  assert.equal(payload.max_output_tokens, 3000);
  assert.equal(payload.text.format.type, "json_schema");
  assert.equal(payload.model, "configured-model");
  assert.equal(call.options.redirect, "error");
  assert.ok(call.options.signal);
  assert.equal(
    createProvider({ ...env, AI_ALLOW_PAID: "false" }).available,
    false,
  );
  for (const mock of [
    async () => new Response("{}", { status: 429 }),
    async () => new Response("not-json"),
    async () => new Response(JSON.stringify({ status: "incomplete" })),
    async () => {
      throw new Error("Private provider error");
    },
    async () => new Response("x".repeat(131073)),
  ])
    await assert.rejects(
      createProvider(env, mock).generate({ kind: "chat", message: "private" }),
      (e) => e.status === 503 && !e.message.includes("Private"),
    );
  const demo = await createProvider().generate({
    kind: "draft",
    preferences: prefs,
  });
  assert.match(demo.answer, /Demonstração local/);
  assert.equal(validateDraft(demo.plan, prefs).sessions.length, 1);
  assert.throws(
    () => validateDraft(null, prefs),
    (error) => error.status === 400,
  );
});

test("Migração 2→3 faz rollback integral em falha e recusa versão futura", () => {
  const parent = resolve("test-results"),
    dir = mkdtempSync(join(parent, "rollback-")),
    path = join(dir, "db.sqlite"),
    key = randomBytes(32);
  try {
    let db = openStore(path, key);
    db.exec(
      "DROP TRIGGER plan_created_version; DROP TRIGGER plan_updated_version; DROP TABLE plan_versions; DROP TABLE calendar_links; DROP TABLE calendar_occurrences; DROP TABLE calendar_series; DROP INDEX workouts_owner_plan_date; DROP TABLE user_preferences; DROP TABLE calendar_events; DROP TABLE ai_drafts; PRAGMA user_version=2; CREATE TABLE calendar_events (legacy TEXT);",
    );
    db.close();
    assert.throws(() => openStore(path, key), /already exists/);
    db = new DatabaseSync(path);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM sqlite_master WHERE name='user_preferences'",
        )
        .get().n,
      0,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM sqlite_master WHERE name='ai_drafts'")
        .get().n,
      0,
    );
    db.exec("PRAGMA user_version=5");
    db.close();
    assert.throws(() => openStore(path, key), /mais recente/);
  } finally {
    if (!resolve(dir).startsWith(parent + sep))
      throw new Error("Pasta inesperada");
    rmSync(dir, { recursive: true, force: true });
  }
});
