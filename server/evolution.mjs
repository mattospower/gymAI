import { randomUUID } from "node:crypto";
import { HttpError, text, encrypt, decrypt } from "./security.mjs";
import { exerciseById } from "./exercises.mjs";

const dayMs = 86400000;
const bad = (message) => {
  throw new HttpError(400, message);
};
export function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    bad("Informe uma data válida.");
  return value;
}
export const shiftDate = (value, days) =>
  new Date(Date.parse(value) + days * dayMs).toISOString().slice(0, 10);
export function localDay(value, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function evolutionRoutes({ db, key, now, training }) {
  const preferences = (id) => {
    const row = db
      .prepare("SELECT * FROM user_preferences WHERE user_id=?")
      .get(id);
    return row
      ? {
          ...decrypt(row.payload, key, `preferences:${id}`),
          version: row.version,
        }
      : {
          weekStart: 1,
          calendarView: "month",
          timeZone: "America/Sao_Paulo",
          aiConsent: false,
          aiProfileConsent: false,
          consentAt: null,
          version: 0,
        };
  };
  const unpackEvent = (row) => ({
    id: row.id,
    date: row.date,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...decrypt(row.payload, key, `calendar:${row.user_id}:${row.id}`),
  });
  const unpackWorkout = (row) => ({
    id: row.id,
    planId: row.plan_ref,
    status: row.status,
    version: row.version,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ...decrypt(row.payload, key, `workout:${row.user_id}:${row.id}`),
  });
  const workouts = (id) =>
    db
      .prepare(
        "SELECT * FROM workout_logs WHERE user_id=? ORDER BY started_at,id",
      )
      .all(id)
      .map(unpackWorkout);
  const events = (id) =>
    db
      .prepare("SELECT * FROM calendar_events WHERE user_id=? ORDER BY date,id")
      .all(id)
      .map(unpackEvent);
  const plan = (id, user) =>
    training("GET", new URL(`http://local/api/plans/${id}`), user).plan;
  const getRange = (url, prefs, maximum = 366) => {
    const to = validDate(
      url.searchParams.get("to") || localDay(now(), prefs.timeZone),
    );
    const from = validDate(url.searchParams.get("from") || shiftDate(to, -29));
    const days = (Date.parse(to) - Date.parse(from)) / dayMs + 1;
    if (days < 1 || days > maximum)
      bad(`Escolha um período de 1 a ${maximum} dias.`);
    return { from, to, days };
  };
  function aggregate(rows, from, to, prefs, exerciseId, status) {
    const filtered = rows.filter(
      (w) =>
        w.status !== "in_progress" &&
        (!status || w.status === status) &&
        (!exerciseId ||
          w.snapshot.exercises.some((e) => e.exerciseId === exerciseId)) &&
        localDay(w.startedAt, prefs.timeZone) >= from &&
        localDay(w.startedAt, prefs.timeZone) <= to,
    );
    const weeks = new Map(),
      months = new Map(),
      popular = new Map(),
      timeline = [];
    // Include zero buckets so an absent record never becomes an invented trend.
    const weekKey = (d) => {
      const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
      return shiftDate(d, -((weekday - prefs.weekStart + 7) % 7));
    };
    for (let d = from; d <= to; d = shiftDate(d, 1)) {
      weeks.set(weekKey(d), { completed: 0, partial: 0 });
      months.set(d.slice(0, 7), { completed: 0, partial: 0 });
    }
    for (const w of filtered) {
      const date = localDay(w.startedAt, prefs.timeZone);
      weeks.get(weekKey(date))[w.status]++;
      months.get(date.slice(0, 7))[w.status]++;
      const recorded = new Set();
      w.snapshot.exercises.forEach((e, i) => {
        if (exerciseId && exerciseId !== e.exerciseId) return;
        const sets = w.records[i].sets.filter((s) => s.value !== null);
        if (!sets.length) return;
        if (!recorded.has(e.exerciseId)) {
          popular.set(e.exerciseId, (popular.get(e.exerciseId) || 0) + 1);
          recorded.add(e.exerciseId);
        }
        const loads = sets.filter((s) => s.load !== null).map((s) => s.load);
        const previous = timeline.find(
          (r) =>
            r.workoutId === w.id &&
            r.exerciseId === e.exerciseId &&
            r.mode === e.mode,
        );
        const values = sets.reduce((n, s) => n + s.value, 0),
          maxLoad = loads.length ? Math.max(...loads) : null;
        if (previous) {
          previous.values += values;
          if (maxLoad !== null)
            previous.maxLoad = Math.max(previous.maxLoad ?? 0, maxLoad);
        } else
          timeline.push({
            date,
            workoutId: w.id,
            exerciseId: e.exerciseId,
            name: e.name,
            status: w.status,
            mode: e.mode,
            values,
            maxLoad,
          });
      });
    }
    const days = new Set(
      filtered.map((w) => localDay(w.startedAt, prefs.timeZone)),
    ).size;
    const gaps = filtered
      .slice(1)
      .map((w, i) => (w.startedAt - filtered[i].startedAt) / dayMs);
    return {
      total: filtered.length,
      completed: filtered.filter((w) => w.status === "completed").length,
      partial: filtered.filter((w) => w.status === "partial").length,
      daysRecorded: days,
      sessionsPerWeek:
        (filtered.length / ((Date.parse(to) - Date.parse(from)) / dayMs + 1)) *
        7,
      averageGapDays: gaps.length
        ? gaps.reduce((a, b) => a + b, 0) / gaps.length
        : null,
      weeks: [...weeks].map(([date, counts]) => ({ date, ...counts })),
      months: [...months].map(([date, counts]) => ({ date, ...counts })),
      popular: [...popular]
        .map(([id, count]) => ({
          id,
          name: exerciseById.get(id)?.name || id,
          count,
        }))
        .sort((a, b) => b.count - a.count),
      timeline,
    };
  }
  function dispatch(method, url, user, input = {}) {
    const path = url.pathname,
      prefs = preferences(user.id);
    if (path === "/api/preferences") {
      if (method === "GET") return { preferences: prefs };
      if (method === "PUT") {
        if (input.version !== prefs.version)
          throw new HttpError(
            409,
            "As configurações mudaram em outra aba. Recarregue antes de salvar.",
          );
        if (
          ![0, 1].includes(input.weekStart) ||
          !["month", "week"].includes(input.calendarView) ||
          typeof input.aiConsent !== "boolean" ||
          typeof input.aiProfileConsent !== "boolean"
        )
          bad("Configurações inválidas.");
        if (typeof input.timeZone !== "string" || input.timeZone.length > 80)
          bad("Fuso horário inválido.");
        try {
          new Intl.DateTimeFormat("pt-BR", {
            timeZone: input.timeZone,
          }).format();
        } catch {
          bad("Fuso horário inválido.");
        }
        if (input.aiProfileConsent && !input.aiConsent)
          bad(
            "Autorize o assistente externo antes de compartilhar preferências.",
          );
        const data = {
          weekStart: input.weekStart,
          calendarView: input.calendarView,
          timeZone: input.timeZone,
          aiConsent: input.aiConsent,
          aiProfileConsent: input.aiProfileConsent,
          consentAt: input.aiConsent
            ? prefs.aiConsent
              ? prefs.consentAt
              : new Date(now()).toISOString()
            : null,
        };
        db.prepare(
          "INSERT INTO user_preferences VALUES (?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,version=version+1,updated_at=excluded.updated_at",
        ).run(user.id, encrypt(data, key, `preferences:${user.id}`), now());
        return { preferences: preferences(user.id) };
      }
    }
    if (path === "/api/dashboard" && method === "GET") {
      const active = db
        .prepare(
          "SELECT id FROM training_plans WHERE user_id=? AND status='active'",
        )
        .get(user.id);
      const counts = Object.fromEntries(
        db
          .prepare(
            "SELECT status,count(*) n FROM workout_logs WHERE user_id=? GROUP BY status",
          )
          .all(user.id)
          .map((r) => [r.status, r.n]),
      );
      const next = db
        .prepare(
          "SELECT * FROM calendar_events WHERE user_id=? AND date>=? ORDER BY date,id LIMIT 1",
        )
        .get(user.id, localDay(now(), prefs.timeZone));
      return {
        activePlan: active ? plan(active.id, user) : null,
        nextSession: next ? unpackEvent(next) : null,
        completed: counts.completed || 0,
        partial: counts.partial || 0,
        recent: db
          .prepare(
            "SELECT * FROM workout_logs WHERE user_id=? AND status<>'in_progress' ORDER BY started_at DESC,id LIMIT 5",
          )
          .all(user.id)
          .map(unpackWorkout),
      };
    }
    if (path === "/api/statistics" && method === "GET") {
      const { from, to, days } = getRange(url, prefs),
        exerciseId = url.searchParams.get("exerciseId") || "",
        status = url.searchParams.get("status") || "";
      if (exerciseId && !exerciseById.has(exerciseId))
        bad("Exercício inválido.");
      if (status && !["completed", "partial"].includes(status))
        bad("Estado inválido.");
      const rows = workouts(user.id),
        previousFrom = shiftDate(from, -days),
        previousTo = shiftDate(from, -1);
      return {
        from,
        to,
        timeZone: prefs.timeZone,
        previousFrom,
        previousTo,
        current: aggregate(rows, from, to, prefs, exerciseId, status),
        previous: aggregate(
          rows,
          previousFrom,
          previousTo,
          prefs,
          exerciseId,
          status,
        ),
      };
    }
    if (path === "/api/calendar" && method === "GET") {
      const { from, to } = getRange(url, prefs);
      return {
        timeZone: prefs.timeZone,
        events: events(user.id).filter((e) => e.date >= from && e.date <= to),
        workouts: workouts(user.id)
          .filter((w) => {
            const d = localDay(w.startedAt, prefs.timeZone);
            return d >= from && d <= to;
          })
          .map((w) => ({ ...w, date: localDay(w.startedAt, prefs.timeZone) })),
      };
    }
    const eventMatch = path.match(/^\/api\/calendar\/([0-9a-f-]{36})$/i);
    if ((path === "/api/calendar" && method === "POST") || eventMatch) {
      const row = eventMatch
        ? db
            .prepare("SELECT * FROM calendar_events WHERE id=? AND user_id=?")
            .get(eventMatch[1], user.id)
        : null;
      if (eventMatch && !row)
        throw new HttpError(404, "Agendamento não encontrado.");
      if (row && input.version !== row.version)
        throw new HttpError(
          409,
          "O agendamento mudou. Recarregue o calendário.",
        );
      if (method === "DELETE") {
        if (input.confirmation !== "CANCELAR") bad("Confirme o cancelamento.");
        db.prepare("DELETE FROM calendar_events WHERE id=? AND user_id=?").run(
          row.id,
          user.id,
        );
        return {
          message:
            "Agendamento cancelado. Os registros realizados foram preservados.",
        };
      }
      if (["POST", "PUT"].includes(method)) {
        const date = validDate(input.date),
          today = localDay(now(), prefs.timeZone);
        if (date < today || date > shiftDate(today, 730))
          bad("Agende entre hoje e os próximos dois anos.");
        const p = plan(text(input.planId, "o plano", 36), user),
          s = p.sessions.find((s) => s.id === input.sessionId);
        if (p.status === "archived" || !s)
          bad("Escolha uma sessão de um plano disponível.");
        if (
          !row &&
          db
            .prepare("SELECT count(*) n FROM calendar_events WHERE user_id=?")
            .get(user.id).n >= 1000
        )
          bad("Limite de 1000 agendamentos atingido.");
        const id = row?.id || randomUUID(),
          payload = encrypt(
            {
              planId: p.id,
              sessionId: s.id,
              planName: p.name,
              sessionName: s.name,
            },
            key,
            `calendar:${user.id}:${id}`,
          );
        if (row)
          db.prepare(
            "UPDATE calendar_events SET date=?,payload=?,version=version+1,updated_at=? WHERE id=? AND user_id=?",
          ).run(date, payload, now(), id, user.id);
        else
          db.prepare("INSERT INTO calendar_events VALUES (?,?,?,?,1,?,?)").run(
            id,
            user.id,
            date,
            payload,
            now(),
            now(),
          );
        return {
          event: unpackEvent(
            db
              .prepare("SELECT * FROM calendar_events WHERE id=? AND user_id=?")
              .get(id, user.id),
          ),
        };
      }
    }
    if (path === "/api/export" && method === "GET") {
      const p = db
        .prepare("SELECT payload FROM profiles WHERE user_id=?")
        .get(user.id);
      return {
        schemaVersion: 3,
        exportedAt: new Date(now()).toISOString(),
        account: {
          id: user.id,
          name: user.name,
          email: user.email,
          createdAt: user.created_at,
          termsVersion: user.terms_version,
          acceptedAt: user.accepted_at,
        },
        profile: p ? decrypt(p.payload, key, user.id) : null,
        preferences: prefs,
        plans: training("GET", new URL("http://local/api/plans"), user).plans,
        workouts: workouts(user.id),
        calendar: events(user.id),
        drafts: db
          .prepare("SELECT * FROM ai_drafts WHERE user_id=? AND expires_at>?")
          .all(user.id, now())
          .map((r) => ({
            id: r.id,
            createdAt: r.created_at,
            expiresAt: r.expires_at,
            ...decrypt(r.payload, key, `draft:${user.id}:${r.id}`),
          })),
      };
    }
    throw new HttpError(404, "Recurso não encontrado.");
  }
  return { dispatch, preferences };
}
export const isEvolutionPath = (path) =>
  /^\/api\/(preferences|dashboard|statistics|calendar|export)(\/|$)/.test(path);
