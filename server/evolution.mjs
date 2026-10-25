import { randomUUID } from "node:crypto";
import { HttpError, text, encrypt, decrypt } from "./security.mjs";
import { exerciseById } from "./exercises.mjs";

import { dayMs, validDate, localDay, shiftDate, range } from "./dates.mjs";
import { calendarRoutes } from "./calendar.mjs";
import { reportResult } from "./reports.mjs";
export { validDate, localDay, shiftDate } from "./dates.mjs";
const bad = (message) => {
  throw new HttpError(400, message);
};
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
  const unpackWorkout = (row) => ({
    id: row.id,
    planId: row.plan_ref,
    status: row.status,
    version: row.version,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ...decrypt(row.payload, key, `workout:${row.user_id}:${row.id}`),
  });
  const workouts = (id, from, to, planId = "") =>
    db
      .prepare(
        "SELECT * FROM workout_logs WHERE user_id=? AND started_at>=? AND started_at<? AND (?='' OR plan_ref=?) ORDER BY started_at,id",
      )
      .all(
        id,
        from ? Date.parse(from) - 2 * dayMs : 0,
        to ? Date.parse(to) + 3 * dayMs : Number.MAX_SAFE_INTEGER,
        planId,
        planId,
      )
      .map(unpackWorkout);
  const calendar = calendarRoutes({ db, key, now, training, preferences });
  const events = (id) => calendar.list(id);
  const plan = (id, user) =>
    training("GET", new URL("http://local/api/plans/" + id), user).plan;
  const getRange = (url, prefs) => range(url, prefs, now);
  function aggregate(rows, from, to, prefs, exerciseId, status, planId) {
    const filtered = rows.filter(
      (w) =>
        w.status !== "in_progress" &&
        (!planId || w.planId === planId) &&
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
      const upcoming = calendar
        .list(user.id, localDay(now(), prefs.timeZone))
        .filter((e) => !e.workoutId)
        .slice(0, 5);
      const today = localDay(now(), prefs.timeZone),
        weekFrom = shiftDate(
          today,
          -((new Date(today).getUTCDay() - prefs.weekStart + 7) % 7),
        ),
        weekTo = shiftDate(weekFrom, 6);
      const week = aggregate(
        workouts(user.id, weekFrom, weekTo),
        weekFrom,
        weekTo,
        prefs,
        "",
        "",
      );
      const runningRow = db
        .prepare(
          "SELECT * FROM workout_logs WHERE user_id=? AND status='in_progress'",
        )
        .get(user.id);
      return {
        activePlan: active ? plan(active.id, user) : null,
        nextSession: upcoming[0] || null,
        upcoming,
        week: {
          from: weekFrom,
          to: weekTo,
          total: week.total,
          completed: week.completed,
          partial: week.partial,
          daysRecorded: week.daysRecorded,
        },
        running: runningRow ? unpackWorkout(runningRow) : null,
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
        status = url.searchParams.get("status") || "",
        planId = url.searchParams.get("planId") || "";
      if (planId && !/^[0-9a-f-]{36}$/i.test(planId)) bad("Plano inválido.");
      if (exerciseId && !exerciseById.has(exerciseId))
        bad("Exercício inválido.");
      if (status && !["completed", "partial"].includes(status))
        bad("Estado inválido.");
      const previousFrom = shiftDate(from, -days),
        previousTo = shiftDate(from, -1),
        rows = workouts(user.id, previousFrom, to);
      return {
        from,
        to,
        timeZone: prefs.timeZone,
        previousFrom,
        previousTo,
        current: aggregate(rows, from, to, prefs, exerciseId, status, planId),
        previous: aggregate(
          rows,
          previousFrom,
          previousTo,
          prefs,
          exerciseId,
          status,
          planId,
        ),
      };
    }
    if (path === "/api/reports" && method === "GET") {
      const { from, to, days } = getRange(url, prefs),
        previousFrom = shiftDate(from, -days),
        previousTo = shiftDate(from, -1);
      const planId = url.searchParams.get("planId") || "",
        status = url.searchParams.get("status") || "",
        exerciseId = url.searchParams.get("exerciseId") || "";
      if (planId && !/^[0-9a-f-]{36}$/i.test(planId)) bad("Plano inválido.");
      if (status && !["completed", "partial"].includes(status))
        bad("Estado inválido.");
      if (exerciseId && !exerciseById.has(exerciseId))
        bad("Exercício inválido.");
      const size = db
        .prepare(
          "SELECT count(*) n,coalesce(sum(length(payload)),0) bytes FROM workout_logs WHERE user_id=? AND started_at>=? AND started_at<? AND (?='' OR plan_ref=?)",
        )
        .get(
          user.id,
          Date.parse(previousFrom) - 2 * dayMs,
          Date.parse(to) + 3 * dayMs,
          planId,
          planId,
        );
      if (size.n > 5000 || size.bytes > 32 * 1024 * 1024)
        throw new HttpError(
          413,
          "Este período tem muitos registros. Reduza o intervalo do relatório.",
        );
      const raw = workouts(user.id, previousFrom, to, planId);
      const current = aggregate(
          raw,
          from,
          to,
          prefs,
          exerciseId,
          status,
          planId,
        ),
        previous = aggregate(
          raw,
          previousFrom,
          previousTo,
          prefs,
          exerciseId,
          status,
          planId,
        );
      const rows = raw.filter(
        (w) =>
          w.status !== "in_progress" &&
          localDay(w.startedAt, prefs.timeZone) >= from &&
          localDay(w.startedAt, prefs.timeZone) <= to &&
          (!planId || w.planId === planId) &&
          (!status || w.status === status) &&
          (!exerciseId ||
            w.snapshot.exercises.some((e) => e.exerciseId === exerciseId)),
      );
      return reportResult(
        url,
        {
          from,
          to,
          timeZone: prefs.timeZone,
          previousFrom,
          previousTo,
          current,
          previous,
        },
        rows,
        exerciseId,
      );
    }
    if (path === "/api/calendar" && method === "GET") {
      const { from, to } = getRange(url, prefs),
        planId = url.searchParams.get("planId") || "";
      if (planId && !/^[0-9a-f-]{36}$/i.test(planId)) bad("Plano inválido.");
      return {
        timeZone: prefs.timeZone,
        events: calendar.list(user.id, from, to, planId),
        workouts: workouts(user.id, from, to)
          .filter((w) => {
            const d = localDay(w.startedAt, prefs.timeZone);
            return d >= from && d <= to && (!planId || w.planId === planId);
          })
          .map((w) => ({ ...w, date: localDay(w.startedAt, prefs.timeZone) })),
      };
    }
    if (/^\/api\/(calendar|calendar-series)(\/|$)/.test(path))
      return calendar.dispatch(method, url, user, input);
    if (path === "/api/export" && method === "GET") {
      const p = db
        .prepare("SELECT payload FROM profiles WHERE user_id=?")
        .get(user.id);
      return {
        schemaVersion: 4,
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
        calendarSeries: calendar.seriesList(user),
        planVersions: db
          .prepare(
            "SELECT * FROM plan_versions WHERE user_id=? ORDER BY plan_id,version",
          )
          .all(user.id)
          .map((r) => ({
            planId: r.plan_id,
            version: r.version,
            status: r.status,
            createdAt: r.created_at,
            ...decrypt(r.payload, key, `plan:${user.id}:${r.plan_id}`),
          })),
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
  /^\/api\/(preferences|dashboard|statistics|calendar|calendar-series|reports|export)(\/|$)/.test(
    path,
  );
