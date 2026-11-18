import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.mjs";
import { openStore } from "../server/store.mjs";
import { encrypt } from "../server/security.mjs";
import { shiftDate } from "../server/dates.mjs";

const planData = {
  name: '=Plano, "teste"',
  goal: "forca",
  description: "Só no servidor",
  sessions: [
    {
      name: "A",
      day: "Livre",
      exercises: [
        {
          exerciseId: "agachamento",
          sets: 2,
          mode: "reps",
          target: 8,
          rest: 60,
          notes: "",
        },
      ],
    },
  ],
};
const drop4 =
  "DROP TRIGGER plan_created_version; DROP TRIGGER plan_updated_version; DROP TABLE plan_versions; DROP TABLE calendar_links; DROP TABLE calendar_occurrences; DROP TABLE calendar_series; DROP INDEX workouts_owner_plan_date; PRAGMA user_version=3;";
test("Etapa 4: recorrências, versões, relatórios, paginação e preservação", async (t) => {
  const parent = resolve("test-results");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "expansion-"));
  const options = {
    origin: "http://localhost:3112",
    databasePath: join(dir, "db.sqlite"),
    encryptionKey: randomBytes(32).toString("hex"),
    now: () => clock,
  };
  let clock = Date.parse("2026-10-25T02:30:00Z"),
    app = createApp(options),
    cookie = "",
    other = "",
    plan,
    series,
    events = [],
    workout,
    owner;
  const listen = () =>
    new Promise((r) => app.server.listen(3112, "127.0.0.1", r));
  await listen();
  const request = async (
    path,
    method = "GET",
    data,
    auth = cookie,
    origin = options.origin,
  ) => {
    const r = await fetch(options.origin + "/api/" + path, {
      method,
      headers: {
        Origin: origin,
        "X-GymIA-Request": "1",
        Cookie: auth,
        Connection: "close",
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const content = r.headers.get("content-type") || "";
    return {
      status: r.status,
      data: content.includes("json") ? await r.json() : await r.text(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      headers: r.headers,
    };
  };
  const seriesInput = () => ({
    planId: plan.id,
    sessionId: plan.sessions[0].id,
    startDate: "2026-10-24",
    until: "2026-11-14",
    intervalWeeks: 1,
    weekdays: [6],
  });
  const calendar = async () =>
    (await request("calendar?from=2026-10-01&to=2026-12-31")).data;
  try {
    await t.test(
      "Autenticação e catálogo preservam IDs e exemplos não prescrevem valores",
      async () => {
        const register = async (email) =>
          request(
            "register",
            "POST",
            {
              name: "Conta fictícia",
              email,
              password: "Uma frase segura de testes Etapa4!",
              confirmPassword: "Uma frase segura de testes Etapa4!",
              acceptTerms: true,
            },
            "",
          );
        const a = await register("expansion-a@example.com");
        cookie = a.cookie;
        owner = a.data.user.id;
        other = (await register("expansion-b@example.com")).cookie;
        assert.equal(
          (await request("reports", "GET", undefined, "")).status,
          401,
        );
        const library = (await request("exercises")).data.exercises;
        assert.equal(library.length, 40);
        assert.equal(new Set(library.map((e) => e.id)).size, 40);
        for (const group of [
          "Peso corporal",
          "Pesos livres",
          "Máquinas",
          "Alongamento",
          "Mobilidade",
          "Aeróbico",
        ])
          assert.ok(library.some((e) => e.group === group));
        const templates = (await request("plan-templates")).data.templates;
        assert.equal(templates.length, 4);
        assert.ok(
          templates.every((t) =>
            t.sessions.every((s) => typeof s === "string"),
          ),
        );
        plan = (await request("plans", "POST", planData)).data.plan;
        assert.equal((await request("plans", "POST", null)).status, 415);
      },
    );
    await t.test(
      "Recorrência usa datas locais e não cria registros; limites e dias inválidos são recusados",
      async () => {
        const result = await request("calendar-series", "POST", seriesInput());
        assert.equal(result.status, 200);
        series = result.data.series;
        events = (await calendar()).events;
        assert.deepEqual(
          events.map((e) => e.date),
          ["2026-10-24", "2026-10-31", "2026-11-07", "2026-11-14"],
        );
        assert.ok(events.every((e) => e.seriesId === series.id));
        assert.equal((await request("workouts")).data.workouts.length, 0);
        for (const bad of [
          { weekdays: [] },
          { weekdays: [1, 1] },
          { intervalWeeks: 0 },
          { until: "2029-01-01" },
          { weekdays: [0, 1, 2, 3, 4, 5, 6], until: "2027-12-31" },
        ])
          assert.equal(
            (
              await request("calendar-series", "POST", {
                ...seriesInput(),
                ...bad,
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await request(
              "calendar-series",
              "POST",
              seriesInput(),
              cookie,
              "https://evil.invalid",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "calendar-series/" + series.id,
              "GET",
              undefined,
              other,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "Exceções e cancelamentos não reaparecem ao editar série; versão detecta conflito",
      async () => {
        const moved = await request("calendar/" + events[1].id, "PUT", {
          version: events[1].version,
          date: "2026-11-01",
          planId: plan.id,
          sessionId: plan.sessions[0].id,
        });
        assert.equal(moved.status, 200);
        assert.equal(
          (
            await request("calendar/" + events[2].id, "DELETE", {
              version: events[2].version,
              confirmation: "CANCELAR",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request("calendar-series/" + series.id, "PUT", {
              ...seriesInput(),
              version: series.version,
              confirmation: "SUBSTITUIR",
            })
          ).status,
          409,
        );
        series = (await request("calendar-series/" + series.id)).data.series;
        assert.equal(
          (
            await request("calendar-series/" + series.id, "PUT", {
              ...seriesInput(),
              version: series.version,
            })
          ).status,
          400,
        );
        const result = await request("calendar-series/" + series.id, "PUT", {
          ...seriesInput(),
          version: series.version,
          until: "2026-11-21",
          confirmation: "SUBSTITUIR",
        });
        assert.equal(result.status, 200);
        series = result.data.series;
        events = (await calendar()).events;
        assert.deepEqual(
          events.map((e) => e.date),
          ["2026-10-24", "2026-11-01", "2026-11-14", "2026-11-21"],
        );
        assert.ok(events.find((e) => e.date === "2026-11-01").exception);
      },
    );
    await t.test(
      "Iniciar por agendamento é explícito, vínculo único acompanha estado real",
      async () => {
        const e = events[0],
          result = await request("calendar/" + e.id + "/start", "POST", {
            version: e.version,
          });
        assert.equal(result.status, 200);
        workout = result.data.workout;
        assert.equal(workout.status, "in_progress");
        const linked = (await calendar()).events.find((x) => x.id === e.id);
        assert.equal(linked.workoutStatus, "in_progress");
        assert.equal(
          (
            await request("calendar/" + e.id + "/start", "POST", {
              version: linked.version,
            })
          ).status,
          400,
        );
        const another = events.at(-1);
        assert.equal(
          (
            await request("calendar/" + another.id + "/link", "POST", {
              version: another.version,
              workoutId: workout.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "calendar/" + another.id + "/link",
              "POST",
              { version: another.version, workoutId: workout.id },
              other,
            )
          ).status,
          404,
        );
        workout.records[0].sets[0] = { completed: true, value: 8, load: 12.5 };
        workout.records[0].sets[1] = { completed: false, value: 0, load: null };
        workout = (
          await request("workouts/" + workout.id, "PUT", {
            ...workout,
            status: "partial",
          })
        ).data.workout;
        assert.equal(
          (await calendar()).events.find((x) => x.id === e.id).workoutStatus,
          "partial",
        );
      },
    );
    await t.test(
      "Série editada/cancelada preserva ocorrências passadas e registros vinculados",
      async () => {
        clock = Date.parse("2026-10-26T12:00:00Z");
        cookie = (
          await request(
            "login",
            "POST",
            {
              email: "expansion-a@example.com",
              password: "Uma frase segura de testes Etapa4!",
            },
            "",
          )
        ).cookie;
        other = (
          await request(
            "login",
            "POST",
            {
              email: "expansion-b@example.com",
              password: "Uma frase segura de testes Etapa4!",
            },
            "",
          )
        ).cookie;
        series = (await request("calendar-series/" + series.id)).data.series;
        const result = await request("calendar-series/" + series.id, "PUT", {
          ...seriesInput(),
          startDate: "2026-10-26",
          version: series.version,
          until: "2026-11-28",
          confirmation: "SUBSTITUIR",
        });
        assert.equal(result.status, 200);
        series = result.data.series;
        assert.equal(
          (
            await request("calendar-series/" + series.id, "DELETE", {
              version: series.version,
              confirmation: "CANCELAR",
            })
          ).status,
          200,
        );
        assert.deepEqual(
          (await calendar()).events.map((e) => e.date),
          ["2026-10-24"],
        );
        assert.equal(
          (await request("workouts/" + workout.id)).data.workout.status,
          "partial",
        );
        assert.equal(
          (
            await request("calendar-series/" + series.id, "PUT", {
              ...seriesInput(),
              version: series.version + 1,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "Versões e conflitos preservam a edição salva e o snapshot do histórico",
      async () => {
        const original = structuredClone(plan);
        plan = (
          await request("plans/" + plan.id, "PUT", {
            ...plan,
            name: "Nova organização",
          })
        ).data.plan;
        assert.equal(
          (
            await request("plans/" + plan.id, "PUT", {
              ...original,
              name: "Sobrescrita",
            })
          ).status,
          409,
        );
        const versions = (await request("plans/" + plan.id + "/versions")).data
          .versions;
        assert.equal(versions.length, 2);
        assert.equal(
          (await request("plans/" + plan.id + "/versions/1")).data.plan.name,
          original.name,
        );
        assert.equal(
          (
            await request(
              "plans/" + plan.id + "/versions/1",
              "GET",
              undefined,
              other,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request("workouts/" + workout.id)).data.workout.snapshot
            .planName,
          original.name,
        );
        for (let i = 0; i < 33; i++)
          plan = (
            await request("plans/" + plan.id, "PUT", {
              ...plan,
              description: "Revisão " + i,
            })
          ).data.plan;
        assert.equal(
          (await request("plans/" + plan.id + "/versions")).data.versions
            .length,
          30,
        );
        assert.equal(
          (await request("plans/" + plan.id + "/versions/1")).status,
          404,
        );
      },
    );
    await t.test(
      "Relatórios têm valores reais, nulos, comparação, filtros e CSV protegido",
      async () => {
        const path = "reports?from=2026-10-01&to=2026-10-31";
        const r = await request(path);
        assert.equal(r.status, 200);
        assert.equal(r.data.current.total, 1);
        assert.equal(r.data.current.partial, 1);
        assert.equal(r.data.previous.total, 0);
        assert.equal(r.data.current.timeline[0].values, 8);
        assert.equal(r.data.workouts[0].records[0].sets[1].load, null);
        const csv = await request(path + "&format=csv");
        assert.match(csv.headers.get("content-type"), /text\/csv/);
        assert.ok(csv.data.includes(`"'=Plano, ""teste"""`));
        assert.match(csv.data, /"12.5"/);
        assert.ok(!csv.data.includes("Só no servidor"));
        assert.match(csv.data, /"reps","0",""/);
        assert.equal((await request(path + "&status=completed")).data.total, 0);
        assert.equal(
          (await request(path + "&exerciseId=flexao")).data.total,
          0,
        );
        assert.equal(
          (await request(path, "GET", undefined, other)).data.total,
          0,
        );
        assert.equal((await request(path + "&format=xml")).status, 400);
        assert.equal(
          (await request("reports?from=2025-01-01&to=2026-10-31")).status,
          400,
        );
        const exp = await request("export");
        assert.equal(exp.data.schemaVersion, 4);
        assert.equal(exp.data.calendar[0].workoutId, workout.id);
        assert.equal(exp.data.calendarSeries.length, 1);
        assert.equal(exp.data.planVersions.length, 30);
        assert.ok(!JSON.stringify(exp.data).includes(options.encryptionKey));
      },
    );
    await t.test(
      "Paginação estável não trunca nem duplica mais de 500 sessões com mesmo instante",
      async () => {
        const base = app.db
            .prepare("SELECT * FROM workout_logs WHERE id=?")
            .get(workout.id),
          key = Buffer.from(options.encryptionKey, "hex");
        for (let i = 0; i < 505; i++) {
          const id = randomUUID();
          app.db
            .prepare(
              "INSERT INTO workout_logs(id,user_id,plan_id,plan_ref,status,payload,version,started_at,finished_at) VALUES(?,?,?,?,?,?,1,?,?)",
            )
            .run(
              id,
              owner,
              plan.id,
              plan.id,
              "completed",
              encrypt(
                {
                  snapshot: workout.snapshot,
                  records: workout.records,
                  notes: "",
                },
                key,
                `workout:${owner}:${id}`,
              ),
              base.started_at,
              base.finished_at,
            );
        }
        let next = "",
          ids = [];
        do {
          const r = await request(
            "workouts?limit=73" + (next ? "&cursor=" + next : ""),
          );
          assert.equal(r.status, 200);
          ids.push(...r.data.workouts.map((w) => w.id));
          next = r.data.nextCursor;
        } while (next);
        assert.equal(ids.length, 506);
        assert.equal(new Set(ids).size, 506);
        assert.equal((await request("workouts?cursor=bad")).status, 400);
        assert.equal((await request("workouts?limit=501")).status, 400);
        const r = await request(
          "reports?from=2026-10-01&to=2026-10-31&page=2&pageSize=100",
        );
        assert.equal(r.data.total, 506);
        assert.equal(r.data.workouts.length, 100);
        assert.equal(r.data.current.total, 506);
        const j = await request(
          "reports?from=2026-10-01&to=2026-10-31&format=json",
        );
        assert.equal(j.data.workouts.length, 506);
        const dashboard = (await request("dashboard")).data;
        assert.equal(dashboard.week.total, 0);
        assert.equal(dashboard.completed, 505);
        assert.equal(dashboard.upcoming.length, 0);
      },
    );
    await t.test(
      "Backup e restauração v4 preservam dados, exceções, vínculos e versões",
      async () => {
        const profile = {
          goal: "forca",
          experience: "iniciante",
          days: 3,
          minutes: 45,
          equipment: ["peso-corporal"],
          location: "casa",
          otherEquipment: "",
          limitations: "",
          sensitiveConsent: false,
        };
        assert.equal((await request("profile", "PUT", profile)).status, 200);
        const prefs = (await request("preferences")).data.preferences;
        await request("preferences", "PUT", {
          ...prefs,
          aiConsent: true,
          aiProfileConsent: true,
        });
        assert.equal(
          (await request("ai/drafts", "POST", { preferences: profile })).status,
          200,
        );
        const tables = [
          "users",
          "profiles",
          "sessions",
          "settings",
          "training_plans",
          "workout_logs",
          "user_preferences",
          "calendar_events",
          "calendar_series",
          "calendar_occurrences",
          "calendar_links",
          "plan_versions",
          "ai_drafts",
        ];
        const before = Object.fromEntries(
          tables.map((name) => [
            name,
            app.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
          ]),
        );
        execFileSync(process.execPath, ["scripts/backup.mjs"], {
          cwd: resolve("."),
          env: { ...process.env, DATABASE_PATH: options.databasePath },
          stdio: "pipe",
        });
        const file = readdirSync(join(dir, "backups"))[0],
          target = join(dir, "restored", "db.sqlite");
        mkdirSync(join(dir, "restored"));
        copyFileSync(join(dir, "backups", file), target);
        const restored = openStore(
          target,
          Buffer.from(options.encryptionKey, "hex"),
        );
        try {
          for (const [name, rows] of Object.entries(before))
            assert.deepEqual(
              restored.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
              rows,
            );
          assert.equal(
            restored.prepare("PRAGMA integrity_check").get().integrity_check,
            "ok",
          );
          assert.deepEqual(
            restored.prepare("PRAGMA foreign_key_check").all(),
            [],
          );
        } finally {
          restored.close();
        }
        assert.throws(() => openStore(target, randomBytes(32)), /chave/);
      },
    );
    await t.test(
      "Migração v3→v4 preserva todos os dados antigos, versões iniciais e reinício",
      async () => {
        let p = (await request("preferences")).data.preferences;
        await request("preferences", "PUT", {
          ...p,
          aiConsent: true,
          aiProfileConsent: true,
        });
        await request("ai/drafts", "POST", {
          message: "",
          preferences: {
            goal: "forca",
            experience: "iniciante",
            days: 3,
            minutes: 45,
            equipment: ["peso-corporal"],
          },
        });
        const tables = [
          "users",
          "profiles",
          "sessions",
          "settings",
          "training_plans",
          "workout_logs",
          "user_preferences",
          "calendar_events",
          "ai_drafts",
        ];
        const before = Object.fromEntries(
          tables.map((n) => [
            n,
            app.db.prepare(`SELECT * FROM ${n} ORDER BY rowid`).all(),
          ]),
        );
        await app.close();
        let db = new DatabaseSync(options.databasePath);
        db.exec(drop4);
        db.close();
        app = createApp(options);
        await listen();
        assert.equal(
          app.db.prepare("PRAGMA user_version").get().user_version,
          4,
        );
        for (const [name, rows] of Object.entries(before))
          assert.deepEqual(
            app.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
            rows,
          );
        assert.equal(
          (await request("plans/" + plan.id + "/versions")).data.versions
            .length,
          1,
        );
        assert.ok((await request("ai/drafts")).data.drafts.length);
        assert.equal(
          (await request("preferences")).data.preferences.aiConsent,
          true,
        );
        await app.close();
        app = createApp(options);
        await listen();
        assert.equal(
          (await request("plans/" + plan.id)).data.plan.name,
          plan.name,
        );
      },
    );
    await t.test(
      "Exclusão de conta elimina tabelas novas sem atingir outra conta",
      async () => {
        const s = await request("calendar-series", "POST", {
          ...seriesInput(),
          startDate: "2026-10-31",
        });
        assert.equal(s.status, 200);
        assert.equal(
          (
            await request("account", "DELETE", {
              password: "Uma frase segura de testes Etapa4!",
              confirmation: "EXCLUIR",
            })
          ).status,
          200,
        );
        for (const table of [
          "calendar_series",
          "calendar_links",
          "plan_versions",
        ])
          assert.equal(
            app.db
              .prepare(`SELECT count(*) n FROM ${table} WHERE user_id=?`)
              .get(owner).n,
            0,
          );
        assert.equal(
          app.db.prepare("SELECT count(*) n FROM calendar_occurrences").get().n,
          0,
        );
        assert.equal(
          (await request("session", "GET", undefined, other)).data.user.email,
          "expansion-b@example.com",
        );
      },
    );
  } finally {
    await app.close();
    if (!resolve(dir).startsWith(parent + sep)) throw Error("Pasta inesperada");
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Migração v4 faz rollback sem deixar tabelas parciais", () => {
  const parent = resolve("test-results");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "rollback4-")),
    path = join(dir, "db.sqlite"),
    key = randomBytes(32);
  try {
    let db = openStore(path, key);
    db.exec(drop4 + "CREATE TABLE plan_versions(conflict TEXT)");
    db.close();
    assert.throws(() => openStore(path, key), /already exists/);
    db = new DatabaseSync(path);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM sqlite_master WHERE name='calendar_series'",
        )
        .get().n,
      0,
    );
    db.close();
  } finally {
    if (!resolve(dir).startsWith(parent + sep)) throw Error("Pasta inesperada");
    rmSync(dir, { recursive: true, force: true });
  }
});
