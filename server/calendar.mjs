import { randomUUID } from "node:crypto";
import { HttpError, text, encrypt, decrypt } from "./security.mjs";
import { asyncTransaction as transaction } from "./database.mjs";
import { validDate, localDay, shiftDate, dayMs } from "./dates.mjs";
const bad = (m) => {
  throw new HttpError(400, m);
};
export function calendarRoutes({ db, key, now, training, preferences }) {
  const joined = `SELECT e.*,o.series_id,o.date occurrence_date,o.exception,s.version series_version,s.cancelled series_cancelled,l.workout_id,w.status workout_status
    FROM calendar_events e LEFT JOIN calendar_occurrences o ON o.event_id=e.id
    LEFT JOIN calendar_series s ON s.id=o.series_id LEFT JOIN calendar_links l ON l.event_id=e.id
    LEFT JOIN workout_logs w ON w.id=l.workout_id`;
  const unpack = (r) => ({
    id: r.id,
    date: r.date,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...decrypt(r.payload, key, `calendar:${r.user_id}:${r.id}`),
    seriesId: r.series_id || null,
    seriesVersion: r.series_version || null,
    seriesCancelled: Boolean(r.series_cancelled),
    occurrenceDate: r.occurrence_date || null,
    exception: Boolean(r.exception),
    workoutId: r.workout_id || null,
    workoutStatus: r.workout_status || null,
  });
  const get = async (id, user) => {
    const r = await db
      .prepare(joined + " WHERE e.id=? AND e.user_id=?")
      .get(id, user.id);
    if (!r) throw new HttpError(404, "Agendamento não encontrado.");
    return unpack(r);
  };
  const list = async (
    userId,
    from = "1900-01-01",
    to = "9998-12-31",
    planId = "",
  ) =>
    (
      await db
        .prepare(
          joined +
            " WHERE e.user_id=? AND e.date>=? AND e.date<=? ORDER BY e.date,e.id",
        )
        .all(userId, from, to)
    )
      .map(unpack)
      .filter((e) => !planId || e.planId === planId);
  const check = (version, current) => {
    if (version !== current)
      throw new HttpError(
        409,
        "O agendamento ou a série mudou. Recarregue para comparar antes de salvar.",
      );
  };
  const today = async (user) =>
    localDay(now(), (await preferences(user.id)).timeZone);
  const dateCheck = async (d, user) => {
    validDate(d);
    if (d < (await today(user)) || d > shiftDate(await today(user), 730))
      bad("Agende entre hoje e os próximos dois anos.");
    return d;
  };
  const selection = async (input, user) => {
    const p = (
      await training(
        "GET",
        new URL(`http://local/api/plans/${text(input.planId, "o plano", 36)}`),
        user,
      )
    ).plan;
    const s = p.sessions.find((s) => s.id === input.sessionId);
    if (p.status === "archived" || !s)
      bad("Escolha uma sessão de um plano disponível.");
    return {
      planId: p.id,
      sessionId: s.id,
      planName: p.name,
      sessionName: s.name,
    };
  };
  const capacity = async (user, n) => {
    if (
      (
        await db
          .prepare("SELECT count(*) n FROM calendar_events WHERE user_id=?")
          .get(user.id)
      ).n +
        n >
      1000
    )
      bad("Limite de 1000 agendamentos atingido.");
  };
  const insert = async (date, data, user) => {
    const id = randomUUID();
    await db
      .prepare(
        "INSERT INTO calendar_events(id,user_id,date,payload,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)",
      )
      .run(
        id,
        user.id,
        date,
        encrypt(data, key, `calendar:${user.id}:${id}`),
        now(),
        now(),
      );
    return id;
  };
  const seriesGet = async (id, user) => {
    const r = await db
      .prepare("SELECT * FROM calendar_series WHERE id=? AND user_id=?")
      .get(id, user.id);
    if (!r) throw new HttpError(404, "Série não encontrada.");
    return {
      id: r.id,
      version: r.version,
      cancelled: Boolean(r.cancelled),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ...decrypt(r.payload, key, `series:${user.id}:${r.id}`),
    };
  };
  const seriesList = async (user) =>
    await Promise.all(
      (
        await db
          .prepare(
            "SELECT id FROM calendar_series WHERE user_id=? ORDER BY created_at,id",
          )
          .all(user.id)
      ).map(async (r) => await seriesGet(r.id, user)),
    );
  const exception = async (e) => {
    if (e.seriesId) {
      await db
        .prepare("UPDATE calendar_occurrences SET exception=1 WHERE event_id=?")
        .run(e.id);
      await db
        .prepare(
          "UPDATE calendar_series SET version=version+1,updated_at=? WHERE id=?",
        )
        .run(now(), e.seriesId);
    }
  };
  async function rule(input, user) {
    const startDate = await dateCheck(input.startDate, user),
      until = await dateCheck(input.until, user);
    if (until < startDate)
      bad("O fim da repetição deve ser posterior ao início.");
    if (
      !Number.isInteger(input.intervalWeeks) ||
      input.intervalWeeks < 1 ||
      input.intervalWeeks > 12
    )
      bad("Escolha um intervalo de 1 a 12 semanas.");
    if (
      !Array.isArray(input.weekdays) ||
      !input.weekdays.length ||
      input.weekdays.length > 7 ||
      new Set(input.weekdays).size !== input.weekdays.length ||
      input.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    )
      bad("Selecione dias da semana válidos.");
    return {
      ...(await selection(input, user)),
      startDate,
      until,
      intervalWeeks: input.intervalWeeks,
      weekdays: [...input.weekdays].sort(),
      timeZone: (await preferences(user.id)).timeZone,
    };
  }
  function dates(rule) {
    const days = [];
    const startMonday = shiftDate(
      rule.startDate,
      -((new Date(rule.startDate).getUTCDay() + 6) % 7),
    );
    for (let d = rule.startDate; d <= rule.until; d = shiftDate(d, 1))
      if (
        rule.weekdays.includes(new Date(d).getUTCDay()) &&
        Math.floor((Date.parse(d) - Date.parse(startMonday)) / (7 * dayMs)) %
          rule.intervalWeeks ===
          0
      )
        days.push(d);
    if (!days.length || days.length > 200)
      bad(
        "A série deve gerar de 1 a 200 ocorrências. Reduza o período ou os dias.",
      );
    return days;
  }
  async function materialize(sid, data, user, excluded = new Set()) {
    const ds = dates(data).filter((d) => !excluded.has(d));
    await capacity(user, ds.length);
    for (const d of ds) {
      const id = await insert(d, data, user);
      await db
        .prepare(
          "INSERT INTO calendar_occurrences(series_id,date,event_id) VALUES(?,?,?)",
        )
        .run(sid, d, id);
    }
    return ds.length;
  }
  async function dispatch(method, url, user, input = {}) {
    const path = url.pathname,
      sm = path.match(/^\/api\/calendar-series\/([0-9a-f-]{36})$/i);
    if (path === "/api/calendar-series" && method === "GET")
      return {
        series: await seriesList(user),
      };
    if ((path === "/api/calendar-series" && method === "POST") || sm) {
      const old = sm ? await seriesGet(sm[1], user) : null;
      if (method === "GET")
        return {
          series: old,
        };
      if (old) check(input.version, old.version);
      if (old?.cancelled)
        bad("Esta série já foi cancelada. Crie uma nova série.");
      if (method === "DELETE") {
        if (input.confirmation !== "CANCELAR")
          bad("Confirme o cancelamento da série.");
        return await transaction(db, async () => {
          const eligible = (await list(user.id, await today(user))).filter(
            (e) => e.seriesId === old.id && !e.workoutId,
          );
          for (const e of eligible) {
            await db
              .prepare(
                "UPDATE calendar_occurrences SET exception=1 WHERE event_id=?",
              )
              .run(e.id);
            await db
              .prepare("DELETE FROM calendar_events WHERE id=?")
              .run(e.id);
          }
          await db
            .prepare(
              "UPDATE calendar_series SET cancelled=1,version=version+1,updated_at=? WHERE id=?",
            )
            .run(now(), old.id);
          return {
            series: await seriesGet(old.id, user),
            removed: eligible.length,
            message:
              "Série cancelada. Datas passadas e vínculos com registros foram preservados.",
          };
        });
      }
      if (!["POST", "PUT"].includes(method))
        throw new HttpError(405, "Método não permitido.");
      const data = await rule(input, user);
      dates(data);
      if (
        !old &&
        (
          await db
            .prepare("SELECT count(*) n FROM calendar_series WHERE user_id=?")
            .get(user.id)
        ).n >= 200
      )
        bad("Limite de 200 séries por conta atingido.");
      if (old && input.confirmation !== "SUBSTITUIR")
        bad(
          "Confirme a substituição das ocorrências futuras sem alterações individuais ou registros.",
        );
      return await transaction(db, async () => {
        const id = old?.id || randomUUID(),
          excluded = new Set();
        if (old) {
          for (const o of await db
            .prepare(
              "SELECT o.*,e.date actual_date,l.workout_id FROM calendar_occurrences o LEFT JOIN calendar_events e ON e.id=o.event_id LEFT JOIN calendar_links l ON l.event_id=e.id WHERE o.series_id=?",
            )
            .all(id)) {
            if (
              o.exception ||
              !o.event_id ||
              o.date < (await today(user)) ||
              o.actual_date < (await today(user)) ||
              o.workout_id
            ) {
              excluded.add(o.date);
              if (o.actual_date) excluded.add(o.actual_date);
              continue;
            }
            await db
              .prepare(
                "DELETE FROM calendar_occurrences WHERE series_id=? AND date=?",
              )
              .run(id, o.date);
            await db
              .prepare("DELETE FROM calendar_events WHERE id=?")
              .run(o.event_id);
          }
          await db
            .prepare(
              "UPDATE calendar_series SET payload=?,version=version+1,updated_at=? WHERE id=?",
            )
            .run(encrypt(data, key, `series:${user.id}:${id}`), now(), id);
        } else
          await db
            .prepare(
              "INSERT INTO calendar_series(id,user_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)",
            )
            .run(
              id,
              user.id,
              encrypt(data, key, `series:${user.id}:${id}`),
              now(),
              now(),
            );
        const created = await materialize(id, data, user, excluded);
        return {
          series: await seriesGet(id, user),
          created,
          message:
            "Recorrência salva. Exceções, datas passadas e registros vinculados foram preservados.",
        };
      });
    }
    const em = path.match(
      /^\/api\/calendar\/([0-9a-f-]{36})(?:\/(link|start))?$/i,
    );
    if (path === "/api/calendar" && method === "POST") {
      const d = await dateCheck(input.date, user),
        data = await selection(input, user);
      await capacity(user, 1);
      return {
        event: await get(await insert(d, data, user), user),
      };
    }
    if (em) {
      const e = await get(em[1], user),
        action = em[2];
      if (method === "GET" && !action)
        return {
          event: e,
        };
      check(input.version, e.version);
      if (method === "POST" && ["link", "start"].includes(action))
        return await transaction(db, async () => {
          let w = null;
          if (action === "start") {
            if (e.workoutId)
              bad("Este agendamento já tem um registro associado.");
            w = (
              await training(
                "POST",
                new URL("http://local/api/workouts"),
                user,
                {
                  planId: e.planId,
                  sessionId: e.sessionId,
                },
              )
            ).workout;
          } else if (input.workoutId !== null) {
            w = (
              await training(
                "GET",
                new URL(
                  `http://local/api/workouts/${text(input.workoutId, "o registro", 36)}`,
                ),
                user,
              )
            ).workout;
            if (w.planId !== e.planId)
              bad("Escolha um registro do mesmo plano.");
          }
          if (
            w &&
            (await db
              .prepare(
                "SELECT event_id FROM calendar_links WHERE workout_id=? AND event_id<>?",
              )
              .get(w.id, e.id))
          )
            bad("Este registro já está associado a outro agendamento.");
          if (e.workoutId && input.confirmation !== "SUBSTITUIR")
            bad("Confirme a alteração do vínculo existente.");
          await db
            .prepare("DELETE FROM calendar_links WHERE event_id=?")
            .run(e.id);
          if (w)
            await db
              .prepare("INSERT INTO calendar_links VALUES(?,?,?)")
              .run(e.id, w.id, user.id);
          await exception(e);
          await db
            .prepare(
              "UPDATE calendar_events SET version=version+1,updated_at=? WHERE id=?",
            )
            .run(now(), e.id);
          return {
            event: await get(e.id, user),
            workout: w,
          };
        });
      if (method === "DELETE" && !action) {
        if (input.confirmation !== "CANCELAR") bad("Confirme o cancelamento.");
        return await transaction(db, async () => {
          await exception(e);
          await db
            .prepare("DELETE FROM calendar_events WHERE id=? AND user_id=?")
            .run(e.id, user.id);
          return {
            message: "Agendamento cancelado. O histórico foi preservado.",
          };
        });
      }
      if (method === "PUT" && !action) {
        const d = await dateCheck(input.date, user),
          data = await selection(input, user);
        if (e.workoutId && data.planId !== e.planId)
          bad("Remova o vínculo antes de mudar o plano.");
        return await transaction(db, async () => {
          await exception(e);
          await db
            .prepare(
              "UPDATE calendar_events SET date=?,payload=?,version=version+1,updated_at=? WHERE id=? AND user_id=?",
            )
            .run(
              d,
              encrypt(data, key, `calendar:${user.id}:${e.id}`),
              now(),
              e.id,
              user.id,
            );
          return {
            event: await get(e.id, user),
          };
        });
      }
    }
    throw new HttpError(404, "Operação de calendário não encontrada.");
  }
  return {
    dispatch,
    list,
    seriesList,
  };
}
