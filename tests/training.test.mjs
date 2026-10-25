import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { createApp } from "../server/app.mjs";
import { hashPassword, digest, encrypt } from "../server/security.mjs";

test("Etapa 2: migração, planos, sessões, histórico e privacidade", async (t) => {
  const parent = resolve("test-results");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "training-"));
  const key = randomBytes(32),
    encryptionKey = key.toString("hex"),
    databasePath = join(directory, "legacy.sqlite");
  const origin = "http://localhost:3105",
    password = "Uma senha de teste para preservar a Etapa 1!";
  const owner = randomUUID(),
    sessionToken = randomBytes(32).toString("hex"),
    created = Date.now();
  // Genuine v1 fixture: the existing account, encrypted profile and login session
  // are written before the new application is opened for the first time.
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,terms_version TEXT NOT NULL,accepted_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;`);
  const hash = await hashPassword(password);
  legacy
    .prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)")
    .run(
      owner,
      "legado@example.com",
      "Conta existente",
      hash,
      "2026-10-18",
      created,
      created,
    );
  legacy.prepare("INSERT INTO profiles VALUES (?,?,?)").run(
    owner,
    encrypt(
      {
        goal: "forca",
        experience: "iniciante",
        days: 3,
        minutes: 45,
        location: "casa",
        equipment: ["peso-corporal"],
        otherEquipment: "",
        limitations: "Informação sensível do perfil",
        sensitiveConsent: true,
      },
      key,
      owner,
    ),
    created,
  );
  legacy
    .prepare("INSERT INTO sessions VALUES (?,?,?)")
    .run(digest(sessionToken), owner, created + 12 * 3600000);
  legacy
    .prepare("INSERT INTO settings VALUES (?,?)")
    .run("encryption-check", encrypt("gymia", key, "gymia-key-check"));
  const original = legacy.prepare("SELECT * FROM users").get();
  legacy.close();
  let app = createApp({ origin, databasePath, encryptionKey });
  const listen = () =>
    new Promise((resolve) => app.server.listen(3105, "127.0.0.1", resolve));
  await listen();
  const a = `gymia_session=${sessionToken}`;
  let b, plan, copy, workout;
  const request = async (path, method = "GET", data, cookie = a) => {
    const response = await fetch(origin + path, {
      method,
      redirect: "manual",
      headers: {
        Origin: origin,
        "X-GymIA-Request": "1",
        Connection: "close",
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const body = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : await response.text();
    return {
      status: response.status,
      body,
      headers: response.headers,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const exercise = (id) => ({
    exerciseId: id,
    sets: 2,
    mode: id === "prancha" ? "seconds" : "reps",
    target: id === "prancha" ? 30 : 8,
    rest: 60,
    notes: "Definido pelo usuário",
  });
  const data = {
    name: "Meu plano <teste>",
    goal: "forca",
    description: "Descrição privada",
    sessions: [
      {
        name: "Sessão A",
        day: "Segunda-feira",
        exercises: [exercise("agachamento"), exercise("prancha")],
      },
    ],
  };
  const operation = async (item, action) => {
    const result = await request(`/api/plans/${item.id}/${action}`, "POST", {
      version: item.version,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.plan;
  };
  try {
    await t.test(
      "Migração 1→3 preserva integralmente conta, perfil e sessão",
      async () => {
        assert.deepEqual(
          app.db.prepare("SELECT * FROM users WHERE id=?").get(owner),
          original,
        );
        assert.equal(
          app.db.prepare("PRAGMA user_version").get().user_version,
          3,
        );
        assert.equal(
          (await request("/api/session")).body.user.name,
          "Conta existente",
        );
        assert.equal(
          (await request("/api/profile")).body.profile.limitations,
          "Informação sensível do perfil",
        );
        const context = (await request("/api/training-context")).body.profile;
        assert.equal(context.goal, "forca");
        assert.ok(!("limitations" in context));
      },
    );
    await t.test("Protege todas as páginas e APIs de treinos", async () => {
      for (const page of [
        "treinos",
        "plano",
        "exercicios",
        "sessao-treino",
        "historico",
      ])
        assert.equal(
          (await request(`/${page}.html`, "GET", null, "")).status,
          303,
        );
      for (const path of ["plans", "workouts", "exercises", "training-context"])
        assert.equal(
          (await request(`/api/${path}`, "GET", null, "")).status,
          401,
        );
    });
    await t.test(
      "Biblioteca tem referências e criação valida dados no servidor",
      async () => {
        const library = (await request("/api/exercises")).body.exercises;
        assert.equal(library.length, 16);
        assert.ok(
          library.every(
            (e) =>
              e.source.startsWith("https://www.acefitness.org/") &&
              e.guidance &&
              e.category,
          ),
        );
        assert.equal(
          (await request("/api/plans", "POST", { ...data, sessions: [] }))
            .status,
          400,
        );
        assert.equal(
          (
            await request("/api/plans", "POST", {
              ...data,
              sessions: [
                {
                  name: "X",
                  exercises: [{ ...exercise("agachamento"), sets: 0 }],
                },
              ],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("/api/plans", "POST", {
              ...data,
              sessions: [{ name: "X", exercises: [exercise("inexistente")] }],
            })
          ).status,
          400,
        );
        assert.equal((await request("/api/workouts", "POST", {})).status, 400);
        const result = await request("/api/plans", "POST", data);
        assert.equal(result.status, 200);
        plan = result.body.plan;
        assert.equal(plan.sessions[0].exercises.length, 2);
        assert.ok(
          !app.db
            .prepare("SELECT payload FROM training_plans")
            .get()
            .payload.includes(data.description),
        );
      },
    );
    await t.test(
      "Edita, adiciona, reordena e remove exercícios sem perder versões",
      async () => {
        plan.sessions[0].exercises.push({
          ...exercise("flexao"),
          id: randomUUID(),
        });
        plan.sessions[0].exercises.reverse();
        let result = await request(`/api/plans/${plan.id}`, "PUT", plan);
        assert.equal(result.status, 200);
        plan = result.body.plan;
        assert.deepEqual(
          plan.sessions[0].exercises.map((e) => e.exerciseId),
          ["flexao", "prancha", "agachamento"],
        );
        const stale = structuredClone(plan);
        plan.sessions[0].exercises.splice(0, 1);
        plan.name = "Plano editado";
        result = await request(`/api/plans/${plan.id}`, "PUT", plan);
        plan = result.body.plan;
        assert.equal(plan.sessions[0].exercises.length, 2);
        assert.equal(
          (await request(`/api/plans/${plan.id}`, "PUT", stale)).status,
          409,
        );
      },
    );
    await t.test(
      "Duplica, define um único ativo, arquiva e reativa",
      async () => {
        copy = await operation(plan, "duplicate");
        assert.notEqual(copy.id, plan.id);
        assert.notEqual(copy.sessions[0].id, plan.sessions[0].id);
        assert.equal(copy.status, "saved");
        plan = await operation(plan, "activate");
        copy = await operation(copy, "activate");
        plan = (await request(`/api/plans/${plan.id}`)).body.plan;
        assert.equal(plan.status, "saved");
        copy = await operation(copy, "archive");
        assert.equal(copy.status, "archived");
        assert.equal(
          (
            await request("/api/workouts", "POST", {
              planId: copy.id,
              sessionId: copy.sessions[0].id,
            })
          ).status,
          400,
        );
        copy = await operation(copy, "restore");
        assert.equal(copy.status, "saved");
        plan = await operation(plan, "activate");
        assert.equal(
          app.db
            .prepare(
              "SELECT count(*) n FROM training_plans WHERE user_id=? AND status='active'",
            )
            .get(owner).n,
          1,
        );
      },
    );
    await t.test(
      "Inicia, salva progresso real e rejeita registros forjados",
      async () => {
        const result = await request("/api/workouts", "POST", {
          planId: plan.id,
          sessionId: plan.sessions[0].id,
        });
        assert.equal(result.status, 200);
        workout = result.body.workout;
        assert.equal(workout.records[0].sets[0].value, null);
        assert.equal(workout.records[0].sets[0].load, null);
        assert.equal(
          (
            await request("/api/workouts", "POST", {
              planId: plan.id,
              sessionId: plan.sessions[0].id,
            })
          ).status,
          409,
        );
        const input = {
          version: workout.version,
          status: "in_progress",
          notes: "Anotação privada",
          records: structuredClone(workout.records),
        };
        input.records[0].sets[0].completed = true;
        assert.equal(
          (await request(`/api/workouts/${workout.id}`, "PUT", input)).status,
          400,
        );
        input.records[0].sets[0] = { completed: true, value: 25, load: null };
        input.records[1].sets[0] = { completed: false, value: 6, load: 12.5 };
        const saved = await request(
          `/api/workouts/${workout.id}`,
          "PUT",
          input,
        );
        assert.equal(saved.status, 200);
        workout = saved.body.workout;
        assert.equal(workout.records[1].sets[0].load, 12.5);
        assert.equal(workout.records[0].sets[1].value, null);
        assert.equal(
          (await request(`/api/workouts/${workout.id}`, "PUT", input)).status,
          409,
        );
        assert.ok(
          !app.db
            .prepare("SELECT payload FROM workout_logs")
            .get()
            .payload.includes("Anotação privada"),
        );
      },
    );
    await t.test(
      "Persiste planos, progresso e login após reinício",
      async () => {
        await app.close();
        app = createApp({ origin, databasePath, encryptionKey });
        await listen();
        assert.equal((await request("/api/session")).body.user.id, owner);
        assert.equal(
          (await request(`/api/workouts/${workout.id}`)).body.workout.records[1]
            .sets[0].load,
          12.5,
        );
        assert.equal(
          (await request(`/api/plans/${plan.id}`)).body.plan.name,
          "Plano editado",
        );
      },
    );
    await t.test(
      "Encerra parcial e finalizada sem exigir todas as séries",
      async () => {
        let result = await request(`/api/workouts/${workout.id}`, "PUT", {
          ...workout,
          status: "partial",
        });
        assert.equal(result.status, 200);
        workout = result.body.workout;
        assert.equal(workout.status, "partial");
        assert.ok(workout.finishedAt);
        assert.equal(
          (await request(`/api/workouts/${workout.id}`, "PUT", workout)).status,
          400,
        );
        let second = (
          await request("/api/workouts", "POST", {
            planId: plan.id,
            sessionId: plan.sessions[0].id,
          })
        ).body.workout;
        result = await request(`/api/workouts/${second.id}`, "PUT", {
          ...second,
          status: "completed",
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.workout.status, "completed");
      },
    );
    await t.test(
      "Histórico filtra período e plano e mantém snapshot após editar/excluir",
      async () => {
        let result = await request(
          `/api/workouts?planId=${plan.id}&from=2000-01-01&to=2099-01-01`,
        );
        assert.equal(result.body.workouts.length, 2);
        assert.equal(
          (await request("/api/workouts?from=2099-01-01")).body.workouts.length,
          0,
        );
        assert.equal(
          (await request("/api/workouts?from=2026-02-31")).status,
          400,
        );
        plan.sessions[0].name = "Nome novo";
        plan = (await request(`/api/plans/${plan.id}`, "PUT", plan)).body.plan;
        assert.equal(
          (await request("/api/workouts")).body.workouts[0].snapshot
            .sessionName,
          "Sessão A",
        );
        assert.equal(
          (
            await request(`/api/plans/${plan.id}`, "DELETE", {
              version: plan.version,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(`/api/plans/${plan.id}`, "DELETE", {
              version: plan.version,
              confirmation: "EXCLUIR",
            })
          ).status,
          200,
        );
        result = await request(`/api/workouts?planId=${plan.id}`);
        assert.equal(result.body.workouts.length, 2);
        assert.equal(
          result.body.workouts[0].snapshot.planName,
          "Plano editado",
        );
      },
    );
    await t.test(
      "Isola todos os recursos entre contas e preserva login da Etapa 1",
      async () => {
        const registered = await request(
          "/api/register",
          "POST",
          {
            name: "Outra conta",
            email: "outra@example.com",
            password,
            confirmPassword: password,
            acceptTerms: true,
          },
          "",
        );
        b = registered.cookie;
        assert.equal(registered.status, 201);
        assert.deepEqual(
          (await request("/api/plans", "GET", null, b)).body.plans,
          [],
        );
        assert.deepEqual(
          (await request("/api/workouts", "GET", null, b)).body.workouts,
          [],
        );
        for (const [path, method, data] of [
          [`/api/plans/${copy.id}`, "GET"],
          [`/api/plans/${copy.id}`, "PUT", copy],
          [
            `/api/plans/${copy.id}/duplicate`,
            "POST",
            { version: copy.version },
          ],
          [`/api/plans/${copy.id}/archive`, "POST", { version: copy.version }],
          [
            `/api/plans/${copy.id}`,
            "DELETE",
            { version: copy.version, confirmation: "EXCLUIR" },
          ],
          [`/api/workouts/${workout.id}`, "GET"],
          [`/api/workouts/${workout.id}`, "PUT", workout],
          [
            "/api/workouts",
            "POST",
            { planId: copy.id, sessionId: copy.sessions[0].id },
          ],
        ])
          assert.equal((await request(path, method, data, b)).status, 404);
        assert.equal(
          (
            await request(
              "/api/login",
              "POST",
              { email: "legado@example.com", password },
              "",
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "Exclusão de conta elimina dados novos por cascata",
      async () => {
        const before = (await request("/api/profile")).body.profile;
        assert.equal(before.limitations, "Informação sensível do perfil");
        assert.equal(
          (
            await request("/api/account", "DELETE", {
              password,
              confirmation: "EXCLUIR",
            })
          ).status,
          200,
        );
        assert.equal(
          app.db
            .prepare("SELECT count(*) n FROM training_plans WHERE user_id=?")
            .get(owner).n,
          0,
        );
        assert.equal(
          app.db
            .prepare("SELECT count(*) n FROM workout_logs WHERE user_id=?")
            .get(owner).n,
          0,
        );
        assert.equal(
          (await request("/api/session", "GET", null, b)).body.user.email,
          "outra@example.com",
        );
      },
    );
  } finally {
    await app.close();
    if (!resolve(directory).startsWith(parent + sep))
      throw new Error("Pasta de teste inesperada.");
    rmSync(directory, { recursive: true, force: true });
  }
});
