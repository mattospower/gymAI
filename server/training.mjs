import { randomUUID } from "node:crypto";
import { HttpError, text, encrypt, decrypt } from "./security.mjs";
import { transaction } from "./store.mjs";
import { exercises, exerciseById } from "./exercises.mjs";

const fail = (message) => {
  throw new HttpError(400, message);
};
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max)
    fail(`Informe ${label} entre ${min} e ${max}.`);
  return value;
};
const uuid = (value) =>
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value || "");
const list = (value, min, max, label) => {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail(`Informe ${label} (de ${min} a ${max}).`);
  return value;
};
const goals = ["hipertrofia", "forca", "resistencia", "condicionamento"];
export function validatePlan(input) {
  if (!input || typeof input !== "object") fail("Plano inválido.");
  if (!goals.includes(input.goal)) fail("Selecione o objetivo do plano.");
  const ids = new Set();
  const uniqueId = (value) => {
    const id = value || randomUUID();
    if (!uuid(id) || ids.has(id))
      fail("Identificadores de sessões ou exercícios inválidos.");
    ids.add(id);
    return id;
  };
  return {
    name: text(input.name, "o nome do plano", 100),
    goal: input.goal,
    description: text(input.description ?? "", "a descrição", 1000, 0),
    sessions: list(input.sessions, 1, 7, "as sessões do plano").map(
      (session) => {
        if (!session || typeof session !== "object") fail("Sessão inválida.");
        return {
          id: uniqueId(session.id),
          name: text(session.name, "o nome da sessão", 80),
          day: text(session.day ?? "", "o dia da sessão", 40, 0),
          exercises: list(session.exercises, 0, 30, "os exercícios").map(
            (entry) => {
              if (!entry || !exerciseById.has(entry.exerciseId))
                fail("Escolha um exercício da biblioteca.");
              if (!["reps", "seconds"].includes(entry.mode))
                fail("Escolha repetições ou duração.");
              return {
                id: uniqueId(entry.id),
                exerciseId: entry.exerciseId,
                sets: integer(entry.sets, 1, 20, "as séries"),
                mode: entry.mode,
                target: integer(
                  entry.target,
                  1,
                  entry.mode === "seconds" ? 3600 : 1000,
                  "a quantidade",
                ),
                rest: integer(entry.rest, 0, 3600, "o descanso em segundos"),
                notes: text(entry.notes ?? "", "as observações", 500, 0),
              };
            },
          ),
        };
      },
    ),
  };
}

export function trainingRoutes({ db, key, now }) {
  const planRow = (id, userId) => {
    const row = db
      .prepare("SELECT * FROM training_plans WHERE id=? AND user_id=?")
      .get(id, userId);
    if (!row) throw new HttpError(404, "Plano não encontrado.");
    return row;
  };
  const unpackPlan = (row) => ({
    id: row.id,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...decrypt(row.payload, key, `plan:${row.user_id}:${row.id}`),
  });
  const workoutRow = (id, userId) => {
    const row = db
      .prepare("SELECT * FROM workout_logs WHERE id=? AND user_id=?")
      .get(id, userId);
    if (!row) throw new HttpError(404, "Registro não encontrado.");
    return row;
  };
  const unpackWorkout = (row) => ({
    id: row.id,
    planId: row.plan_ref,
    status: row.status,
    version: row.version,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ...decrypt(row.payload, key, `workout:${row.user_id}:${row.id}`),
  });
  const checkVersion = (input, row) => {
    if (input.version !== row.version)
      throw new HttpError(
        409,
        "Este item mudou em outra aba. Reabra a página antes de salvar; suas alterações ainda estão nesta tela.",
      );
  };
  // Insert columns explicitly: never depend on the order of future migrations.
  const insertPlan = (userId, data) => {
    if (
      db
        .prepare("SELECT count(*) AS n FROM training_plans WHERE user_id=?")
        .get(userId).n >= 100
    )
      fail("Limite de 100 planos atingido.");
    const id = randomUUID();
    db.prepare(
      "INSERT INTO training_plans (id,user_id,status,payload,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)",
    ).run(
      id,
      userId,
      "saved",
      encrypt(data, key, `plan:${userId}:${id}`),
      now(),
      now(),
    );
    return unpackPlan(planRow(id, userId));
  };
  return function dispatch(method, url, user, input = {}) {
    const path = url.pathname;
    if (method === "GET" && path === "/api/plan-templates")
      return {
        templates: [
          { id: "livre", name: "Uma sessão livre", sessions: ["Sessão livre"] },
          {
            id: "alternadas",
            name: "Organização A / B",
            sessions: ["Sessão A", "Sessão B"],
          },
          {
            id: "tres-partes",
            name: "Organização A / B / C",
            sessions: ["Sessão A", "Sessão B", "Sessão C"],
          },
          {
            id: "movimentos",
            name: "Separar por movimentos",
            sessions: ["Empurrar", "Puxar", "Pernas e tronco"],
          },
        ],
        notice:
          "Exemplos de organização, sem exercícios, séries, cargas ou frequência prescritos. Defina os campos conforme sua escolha.",
      };
    const vm = path.match(
      /^\/api\/plans\/([0-9a-f-]{36})\/versions(?:\/(\d+))?$/i,
    );
    if (method === "GET" && vm) {
      planRow(vm[1], user.id);
      const rows = db
        .prepare(
          "SELECT * FROM plan_versions WHERE plan_id=? AND user_id=? ORDER BY version DESC",
        )
        .all(vm[1], user.id);
      if (vm[2]) {
        const r = rows.find((r) => r.version === Number(vm[2]));
        if (!r) throw new HttpError(404, "Versão não encontrada.");
        return {
          plan: {
            ...decrypt(r.payload, key, `plan:${user.id}:${vm[1]}`),
            id: vm[1],
            version: r.version,
            status: r.status,
            updatedAt: r.created_at,
          },
        };
      }
      return {
        versions: rows.map((r) => ({
          version: r.version,
          status: r.status,
          updatedAt: r.created_at,
        })),
        retention: 30,
      };
    }
    if (method === "GET" && path === "/api/training-context") {
      const row = db
        .prepare("SELECT payload FROM profiles WHERE user_id=?")
        .get(user.id);
      const data = row ? decrypt(row.payload, key, user.id) : null;
      return {
        profile: data
          ? Object.fromEntries(
              [
                "goal",
                "experience",
                "days",
                "minutes",
                "location",
                "equipment",
                "otherEquipment",
              ].map((k) => [k, data[k]]),
            )
          : null,
      };
    }
    if (method === "GET" && path === "/api/exercises") return { exercises };
    if (method === "GET" && path === "/api/plans")
      return {
        plans: db
          .prepare(
            "SELECT * FROM training_plans WHERE user_id=? ORDER BY updated_at DESC,id",
          )
          .all(user.id)
          .map(unpackPlan),
      };
    if (method === "POST" && path === "/api/plans")
      return { plan: insertPlan(user.id, validatePlan(input)) };
    const planMatch = path.match(
      /^\/api\/plans\/([0-9a-f-]{36})(?:\/(duplicate|archive|restore|activate))?$/i,
    );
    if (planMatch) {
      const [, id, action] = planMatch,
        row = planRow(id, user.id);
      if (method === "GET" && !action) return { plan: unpackPlan(row) };
      checkVersion(input, row);
      if (method === "PUT" && !action) {
        if (row.status === "archived") fail("Reative o plano antes de editar.");
        const data = validatePlan(input);
        db.prepare(
          "UPDATE training_plans SET payload=?,version=version+1,updated_at=? WHERE id=? AND user_id=?",
        ).run(encrypt(data, key, `plan:${user.id}:${id}`), now(), id, user.id);
        return { plan: unpackPlan(planRow(id, user.id)) };
      }
      if (method === "DELETE" && !action) {
        if (input.confirmation !== "EXCLUIR")
          fail("Digite EXCLUIR para confirmar. O histórico será preservado.");
        db.prepare("DELETE FROM training_plans WHERE id=? AND user_id=?").run(
          id,
          user.id,
        );
        return {
          message:
            "Plano excluído. Os registros do histórico foram preservados.",
        };
      }
      if (method === "POST" && action === "duplicate") {
        const data = unpackPlan(row);
        data.name = `${data.name.slice(0, 92)} (cópia)`;
        data.sessions.forEach((s) => {
          s.id = randomUUID();
          s.exercises.forEach((e) => {
            e.id = randomUUID();
          });
        });
        return { plan: insertPlan(user.id, validatePlan(data)) };
      }
      if (
        method === "POST" &&
        ["archive", "restore", "activate"].includes(action)
      ) {
        if (action === "activate" && row.status === "archived")
          fail("Reative o plano antes de defini-lo como ativo.");
        transaction(db, () => {
          if (action === "activate")
            db.prepare(
              "UPDATE training_plans SET status='saved',version=version+1,updated_at=? WHERE user_id=? AND status='active' AND id<>?",
            ).run(now(), user.id, id);
          db.prepare(
            "UPDATE training_plans SET status=?,version=version+1,updated_at=? WHERE id=? AND user_id=?",
          ).run(
            action === "activate"
              ? "active"
              : action === "archive"
                ? "archived"
                : "saved",
            now(),
            id,
            user.id,
          );
        });
        return { plan: unpackPlan(planRow(id, user.id)) };
      }
    }
    if (method === "GET" && path === "/api/workouts") {
      const from = url.searchParams.get("from"),
        to = url.searchParams.get("to"),
        planId = url.searchParams.get("planId");
      const date = (value) => {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value
        )
          fail("Informe uma data válida.");
        return Date.parse(value);
      };
      const instant = (value) => {
        const parsed = Date.parse(value);
        if (
          !Number.isFinite(parsed) ||
          new Date(parsed).toISOString() !== value
        )
          fail("Informe um instante válido para o período.");
        return parsed;
      };
      const start = url.searchParams.has("fromInstant")
        ? instant(url.searchParams.get("fromInstant"))
        : from
          ? date(from)
          : 0;
      const end = url.searchParams.has("untilInstant")
        ? instant(url.searchParams.get("untilInstant"))
        : to
          ? date(to) + 86400000
          : Number.MAX_SAFE_INTEGER;
      if (planId && !uuid(planId)) fail("Filtro de plano inválido.");
      if (start >= end)
        fail("O período final deve ser igual ou posterior ao inicial.");
      const pageSize = Number(url.searchParams.get("limit") || 500);
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500)
        fail("Escolha de 1 a 500 registros por página.");
      let cursor = { t: 0, id: "" };
      const encoded = url.searchParams.get("cursor") || "";
      if (encoded) {
        try {
          cursor = JSON.parse(Buffer.from(encoded, "base64url").toString());
        } catch {
          fail("Página inválida.");
        }
        if (!Number.isSafeInteger(cursor.t) || cursor.t < 0 || !uuid(cursor.id))
          fail("Página inválida.");
      }
      const rows = db
        .prepare(
          "SELECT * FROM workout_logs WHERE user_id=? AND started_at>=? AND started_at<? AND (? IS NULL OR plan_ref=?) AND (?='' OR started_at<? OR (started_at=? AND id>?)) ORDER BY started_at DESC,id LIMIT ?",
        )
        .all(
          user.id,
          start,
          end,
          planId,
          planId,
          encoded,
          cursor.t,
          cursor.t,
          cursor.id,
          pageSize + 1,
        );
      const more = rows.length > pageSize;
      rows.length = Math.min(rows.length, pageSize);
      const last = rows.at(-1);
      return {
        workouts: rows.map(unpackWorkout),
        nextCursor: more
          ? Buffer.from(
              JSON.stringify({ t: last.started_at, id: last.id }),
            ).toString("base64url")
          : null,
      };
    }
    if (method === "POST" && path === "/api/workouts") {
      if (!uuid(input.planId) || !uuid(input.sessionId))
        fail("Selecione um plano e uma sessão válidos.");
      const plan = unpackPlan(planRow(input.planId, user.id));
      if (plan.status === "archived")
        fail("Reative o plano para iniciar uma sessão.");
      const session = plan.sessions.find(
        (session) => session.id === input.sessionId,
      );
      if (!session || !session.exercises.length)
        fail("Adicione exercícios à sessão antes de iniciar.");
      const existing = db
        .prepare(
          "SELECT * FROM workout_logs WHERE user_id=? AND status='in_progress'",
        )
        .get(user.id);
      if (existing)
        throw new HttpError(
          409,
          `Você já tem uma sessão em andamento. Retome-a pelo painel de treinos.`,
        );
      const snapshot = {
        planName: plan.name,
        sessionName: session.name,
        exercises: session.exercises.map((e) => ({
          ...e,
          name: exerciseById.get(e.exerciseId).name,
        })),
      };
      const data = {
        snapshot,
        notes: "",
        records: snapshot.exercises.map((e) => ({
          entryId: e.id,
          notes: "",
          sets: Array.from({ length: e.sets }, () => ({
            completed: false,
            value: null,
            load: null,
          })),
        })),
      };
      const id = randomUUID();
      db.prepare(
        "INSERT INTO workout_logs (id,user_id,plan_id,plan_ref,status,payload,version,started_at) VALUES (?,?,?,?,?,?,1,?)",
      ).run(
        id,
        user.id,
        plan.id,
        plan.id,
        "in_progress",
        encrypt(data, key, `workout:${user.id}:${id}`),
        now(),
      );
      return { workout: unpackWorkout(workoutRow(id, user.id)) };
    }
    const match = path.match(/^\/api\/workouts\/([0-9a-f-]{36})$/i);
    if (match) {
      const row = workoutRow(match[1], user.id);
      if (method === "GET") return { workout: unpackWorkout(row) };
      if (method === "PUT") {
        checkVersion(input, row);
        if (row.status !== "in_progress")
          fail("Esta sessão já foi encerrada e não pode ser alterada.");
        if (!["in_progress", "completed", "partial"].includes(input.status))
          fail("Estado da sessão inválido.");
        const original = unpackWorkout(row);
        const records = list(
          input.records,
          original.snapshot.exercises.length,
          original.snapshot.exercises.length,
          "os exercícios registrados",
        ).map((record, i) => {
          const entry = original.snapshot.exercises[i];
          if (!record || record.entryId !== entry.id)
            fail("Exercícios do registro não correspondem à sessão iniciada.");
          return {
            entryId: entry.id,
            notes: text(
              record.notes ?? "",
              "as observações do exercício",
              500,
              0,
            ),
            sets: list(
              record.sets,
              entry.sets,
              entry.sets,
              "as séries registradas",
            ).map((set) => {
              if (!set || typeof set.completed !== "boolean")
                fail("Informe a conclusão da série.");
              const value =
                set.value === null
                  ? null
                  : integer(
                      set.value,
                      0,
                      entry.mode === "seconds" ? 86400 : 1000,
                      "o valor realizado",
                    );
              const load = set.load;
              if (
                load !== null &&
                (typeof load !== "number" ||
                  !Number.isFinite(load) ||
                  load < 0 ||
                  load > 2000 ||
                  Math.abs(load * 100 - Math.round(load * 100)) > 0.00001)
              )
                fail(
                  "Informe uma carga válida, de 0 a 2000 kg, com até duas casas decimais.",
                );
              if (set.completed && !value)
                fail(
                  "Informe repetições ou duração para marcar a série como concluída.",
                );
              return { completed: set.completed, value, load };
            }),
          };
        });
        const payload = {
          snapshot: original.snapshot,
          notes: text(input.notes ?? "", "as observações da sessão", 1000, 0),
          records,
        };
        db.prepare(
          "UPDATE workout_logs SET payload=?,status=?,version=version+1,finished_at=? WHERE id=? AND user_id=?",
        ).run(
          encrypt(payload, key, `workout:${user.id}:${row.id}`),
          input.status,
          input.status === "in_progress" ? null : now(),
          row.id,
          user.id,
        );
        return { workout: unpackWorkout(workoutRow(row.id, user.id)) };
      }
    }
    throw new HttpError(404, "Recurso de treino não encontrado.");
  };
}
export const isTrainingPath = (path) =>
  /^\/api\/(plans|plan-templates|workouts|exercises|training-context)(\/|$)/.test(
    path,
  );
