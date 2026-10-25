import { api, showMessage } from "./api.js";
import { node, button, link, field, labels, date } from "./training-ui.js";
import { reports } from "./reports.js";
import { panel, checkbox, select, table } from "./data-ui.js";
const $ = (id) => document.getElementById(id);
const replaceChildren = (target, ...children) =>
  target.replaceChildren(...children.filter((child) => child != null));
const message = () => document.querySelector("[data-message]");
const action = (fn) => async (event) => {
  const b = event?.currentTarget;
  if (b?.tagName === "BUTTON") b.disabled = true;
  try {
    await fn(event);
  } catch (e) {
    showMessage(message(), e.message, true);
  } finally {
    if (b?.tagName === "BUTTON") b.disabled = false;
  }
};
const localDay = (value, timeZone) => {
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
};
const shift = (d, n) =>
  new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const pretty = (d) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const workoutLink = (w) => link("Ver registro", `historico.html?id=${w.id}`);
export async function renderDashboard(container) {
  if (!container) return;
  const data = await api("dashboard");
  container.replaceChildren(
    node(
      "div",
      { class: "metric-grid" },
      panel(
        "Plano ativo",
        node("p", {}, data.activePlan?.name || "Nenhum plano ativo."),
        data.activePlan
          ? link("Abrir plano", `plano.html?id=${data.activePlan.id}`)
          : link("Criar plano", "plano.html"),
      ),
      panel(
        "Próxima sessão planejada",
        node(
          "p",
          {},
          data.nextSession
            ? `${pretty(data.nextSession.date)} · ${data.nextSession.sessionName}`
            : "Nenhuma data planejada.",
        ),
        link("Abrir calendário", "calendario.html"),
      ),
      panel(
        "Sessões concluídas",
        node("p", { class: "big-n" }, data.completed),
        node(
          "p",
          { class: "small" },
          `${data.partial} sessão(ões) parcial(is). Contagem de todos os registros.`,
        ),
        link("Ver evolução", "evolucao.html"),
      ),
    ),
    panel(
      "Esta semana",
      node(
        "p",
        {},
        `${pretty(data.week.from)} a ${pretty(data.week.to)} · ${data.week.completed} concluídas · ${data.week.partial} parciais · ${data.week.daysRecorded} dias com registros`,
      ),
      node(
        "div",
        { class: "training-actions" },
        link("Relatórios", "relatorios.html"),
        link("Assistente", "assistente.html"),
        link("Biblioteca", "exercicios.html"),
        link("Criar plano", "plano.html"),
      ),
    ),
    panel(
      "Próximas datas",
      ...(data.upcoming.length
        ? data.upcoming.map((e) =>
            node(
              "p",
              {},
              `${pretty(e.date)} · ${e.planName} · ${e.sessionName}`,
            ),
          )
        : [node("p", {}, "Planeje uma sessão no calendário para vê-la aqui.")]),
      link("Planejar sessões", "calendario.html"),
    ),
    panel(
      "Últimos treinos",
      data.recent.length
        ? node(
            "ul",
            { class: "session-overview" },
            data.recent.map((w) =>
              node(
                "li",
                {},
                node(
                  "span",
                  {},
                  `${w.snapshot.sessionName} · ${date(w.startedAt)} · ${labels[w.status]}`,
                ),
                workoutLink(w),
              ),
            ),
          )
        : node(
            "p",
            {},
            "Seu histórico aparecerá aqui quando você registrar sessões.",
          ),
    ),
  );
}

async function settings(root) {
  let { preferences: p } = await api("preferences");
  const form = node(
    "form",
    { method: "post", class: "card form-card" },
    node("h2", {}, "Calendário e consentimento"),
    node(
      "div",
      { class: "form-grid" },
      select("Primeiro dia da semana", "week-start", p.weekStart, [
        [1, "Segunda-feira"],
        [0, "Domingo"],
      ]),
      select("Visualização inicial", "calendar-view", p.calendarView, [
        ["month", "Mensal"],
        ["week", "Semanal"],
      ]),
    ),
    field("Fuso horário", "time-zone", p.timeZone, () => {}, {
      required: true,
      maxlength: 80,
    }),
    node(
      "p",
      { class: "hint" },
      "Exemplos: America/Sao_Paulo, America/Manaus, Europe/Lisbon. Registros e estatísticas usam este fuso.",
    ),
    node(
      "div",
      { class: "notice section-gap" },
      node("strong", {}, "Compartilhamento com IA externa"),
      node(
        "p",
        {},
        "Quando habilitado pelo responsável, o provedor OpenAI recebe a mensagem, a organização solicitada, exercícios da biblioteca e os campos que você selecionar. Nome, e-mail, limitações físicas e observações dos treinos não entram automaticamente no envio. Não escreva dados sensíveis nas mensagens.",
      ),
    ),
    checkbox(
      "ai-consent",
      "Autorizo enviar minhas solicitações ao provedor externo OpenAI.",
      p.aiConsent,
    ),
    checkbox(
      "ai-profile-consent",
      "Autorizo usar objetivo, experiência, dias, minutos e equipamentos do perfil no assistente, quando eu selecionar essa opção.",
      p.aiProfileConsent,
    ),
    node(
      "p",
      { id: "consent-status", class: "small" },
      p.consentAt
        ? `Autorização externa registrada em ${date(p.consentAt)}.`
        : "Sem autorização externa.",
    ),
    node(
      "button",
      { type: "submit", class: "btn btn-blue" },
      "Salvar configurações",
    ),
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    await action(async () => {
      const result = await api("preferences", {
        method: "PUT",
        body: {
          version: p.version,
          weekStart: Number($("week-start").value),
          calendarView: $("calendar-view").value,
          timeZone: $("time-zone").value,
          aiConsent: $("ai-consent").checked,
          aiProfileConsent: $("ai-profile-consent").checked,
        },
      });
      p = result.preferences;
      $("consent-status").textContent = p.consentAt
        ? `Autorização externa registrada em ${date(p.consentAt)}.`
        : "Sem autorização externa.";
      showMessage(
        message(),
        "Configurações salvas. A retirada de consentimento bloqueia novos envios; não recolhe solicitações já recebidas pelo provedor.",
      );
    })();
  };
  root.replaceChildren(
    form,
    panel(
      "Seus dados",
      node(
        "p",
        {},
        "A exportação JSON inclui conta, perfil, preferências, planos, calendário, rascunhos válidos e todo o histórico. Guarde o arquivo em local privado.",
      ),
      button(
        "Exportar meus dados",
        action(async () => {
          const data = await api("export");
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(data, null, 2)], {
              type: "application/json",
            }),
          );
          const a = node("a", { href: url, download: "gymia-dados.json" });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          showMessage(message(), "Exportação preparada para download.");
        }),
      ),
      node(
        "div",
        { class: "training-actions section-gap" },
        link("Editar preferências de treino", "perfil.html#editar"),
        link("Excluir minha conta", "perfil.html#excluir"),
        link("Privacidade", "privacidade.html"),
      ),
    ),
  );
}

async function calendar(root, prefs) {
  const { plans } = await api("plans");
  const available = plans.filter((p) => p.status !== "archived");
  let view = prefs.calendarView,
    anchor = localDay(Date.now(), prefs.timeZone),
    selected = anchor,
    editing = null;
  const planSelect = select(
    "Plano",
    "schedule-plan",
    available.find((p) => p.status === "active")?.id || available[0]?.id || "",
    available.map((p) => [p.id, p.name]),
    () => updateSessions(),
  );
  const sessionField = select("Sessão", "schedule-session", "", []);
  const form = node(
    "form",
    { method: "post", class: "card form-card" },
    node("h2", { id: "schedule-title" }, "Planejar sessão"),
    node("p", {}, "Agendar não inicia nem conclui um treino."),
    node("div", { class: "form-grid" }, planSelect, sessionField),
    field("Data planejada", "schedule-date", selected, () => {}, {
      type: "date",
      required: true,
    }),
    select("Repetição", "schedule-repeat", "none", [
      ["none", "Apenas esta data"],
      ["weekly", "Recorrência semanal"],
    ]),
    node(
      "fieldset",
      { id: "recurrence-fields", hidden: true },
      node("legend", {}, "Dias e término da série"),
      node(
        "p",
        { class: "small" },
        "Semana inicia na segunda-feira. Máximo de 200 ocorrências; datas são locais, sem horário.",
      ),
      node(
        "div",
        { class: "choice-grid" },
        ...[
          "Domingo",
          "Segunda",
          "Terça",
          "Quarta",
          "Quinta",
          "Sexta",
          "Sábado",
        ].map((d, i) =>
          checkbox("repeat-day-" + i, d, i === new Date(selected).getUTCDay()),
        ),
      ),
      field("Intervalo em semanas", "repeat-interval", 1, () => {}, {
        type: "number",
        min: 1,
        max: 12,
        required: true,
      }),
      field("Repetir até", "repeat-until", shift(selected, 28), () => {}, {
        type: "date",
        required: true,
      }),
    ),
    node(
      "div",
      { class: "training-actions" },
      node(
        "button",
        { type: "submit", class: "btn btn-blue", disabled: !available.length },
        "Salvar data",
      ),
      button("Limpar edição", () => reset()),
    ),
  );
  const grid = node("div", { class: "calendar-grid", id: "calendar-grid" }),
    details = panel("Sessões do dia", node("div", { id: "day-events" })),
    caption = node("h2", { id: "calendar-period", "aria-live": "polite" });
  function updateSessions(value) {
    const p = available.find((p) => p.id === $("schedule-plan").value);
    $("schedule-session").replaceChildren(
      ...(p?.sessions || []).map((s) =>
        node("option", { value: s.id }, s.name),
      ),
    );
    if (value) $("schedule-session").value = value;
  }
  function reset() {
    editing = null;
    if ($("schedule-title"))
      $("schedule-title").textContent = "Planejar sessão";
    if ($("schedule-date")) $("schedule-date").value = selected;
    if ($("schedule-repeat")) {
      $("schedule-repeat").value = "none";
      $("recurrence-fields").hidden = true;
      $("schedule-repeat").disabled = false;
    }
  }
  let data = { events: [], workouts: [] },
    requestVersion = 0;
  function renderDay() {
    const ev = data.events.filter((e) => e.date === selected),
      ws = data.workouts.filter((w) => w.date === selected);
    replaceChildren(
      $("day-events"),
      node("h3", {}, pretty(selected)),
      ...ev.map((e) =>
        node(
          "article",
          { class: "calendar-entry" },
          node(
            "span",
            { class: "tag" },
            e.workoutStatus
              ? labels[e.workoutStatus] + " · vinculada"
              : "Planejada",
          ),
          e.seriesId
            ? node(
                "p",
                { class: "small" },
                "Recorrência semanal" +
                  (e.seriesCancelled ? " · série cancelada" : "") +
                  (e.exception ? " · ocorrência com alteração individual" : ""),
              )
            : null,
          node("p", {}, `${e.planName} · ${e.sessionName}`),
          node(
            "div",
            { class: "training-actions" },
            link("Ver plano", `plano.html?id=${e.planId}`),
            button("Alterar data", () => {
              editing = e;
              $("schedule-repeat").disabled = true;
              $("schedule-repeat").value = "none";
              $("recurrence-fields").hidden = true;
              $("schedule-title").textContent = "Alterar agendamento";
              $("schedule-plan").value = e.planId;
              updateSessions(e.sessionId);
              $("schedule-date").value = e.date;
              $("schedule-date").focus();
            }),
            e.seriesId && !e.seriesCancelled
              ? button(
                  "Editar série",
                  action(async () => {
                    const { series: s } = await api(
                      "calendar-series/" + e.seriesId,
                    );
                    editing = { ...e, series: s };
                    $("schedule-title").textContent =
                      "Editar série: futuras sem exceções ou registros";
                    $("schedule-plan").value = s.planId;
                    updateSessions(s.sessionId);
                    $("schedule-date").value =
                      s.startDate < localDay(Date.now(), prefs.timeZone)
                        ? localDay(Date.now(), prefs.timeZone)
                        : s.startDate;
                    $("schedule-repeat").disabled = true;
                    $("schedule-repeat").value = "weekly";
                    $("recurrence-fields").hidden = false;
                    $("repeat-until").value = s.until;
                    $("repeat-interval").value = s.intervalWeeks;
                    for (let i = 0; i < 7; i++)
                      $("repeat-day-" + i).checked = s.weekdays.includes(i);
                    $("schedule-date").focus();
                  }),
                )
              : null,
            e.seriesId && !e.seriesCancelled
              ? button(
                  "Cancelar série",
                  action(async () => {
                    if (
                      !confirm(
                        "Cancelar as datas futuras desta série? Datas passadas e registros vinculados serão preservados.",
                      )
                    )
                      return;
                    await api("calendar-series/" + e.seriesId, {
                      method: "DELETE",
                      body: {
                        version: e.seriesVersion,
                        confirmation: "CANCELAR",
                      },
                    });
                    reset();
                    await render();
                  }),
                )
              : null,
            !e.workoutId
              ? button(
                  "Iniciar pelo agendamento",
                  action(async () => {
                    const result = await api("calendar/" + e.id + "/start", {
                      method: "POST",
                      body: { version: e.version },
                    });
                    location.assign(
                      "sessao-treino.html?id=" + result.workout.id,
                    );
                  }),
                )
              : null,
            e.workoutId
              ? link(
                  "Abrir registro vinculado",
                  e.workoutStatus === "in_progress"
                    ? "sessao-treino.html?id=" + e.workoutId
                    : "historico.html?id=" + e.workoutId,
                )
              : null,
            button(
              "Associar registro",
              action(async () => {
                const firstPage = await api(
                  "workouts?planId=" + e.planId + "&limit=100",
                );
                const workouts = firstPage.workouts;
                let nextCursor = firstPage.nextCursor;
                if (e.workoutId && !workouts.some((w) => w.id === e.workoutId))
                  workouts.unshift(
                    (await api("workouts/" + e.workoutId)).workout,
                  );
                const more = button(
                  "Carregar registros anteriores",
                  action(async () => {
                    const result = await api(
                      "workouts?planId=" +
                        e.planId +
                        "&limit=100&cursor=" +
                        nextCursor,
                    );
                    $("link-workout").append(
                      ...result.workouts
                        .filter((w) => !workouts.some((x) => x.id === w.id))
                        .map((w) =>
                          node(
                            "option",
                            { value: w.id },
                            date(w.startedAt) +
                              " · " +
                              w.snapshot.sessionName +
                              " · " +
                              labels[w.status],
                          ),
                        ),
                    );
                    workouts.push(...result.workouts);
                    nextCursor = result.nextCursor;
                    more.hidden = !nextCursor;
                  }),
                  { hidden: !nextCursor },
                );
                const dialog = node(
                  "dialog",
                  {
                    class: "library-dialog",
                    "aria-label": "Associar registro realizado",
                  },
                  node("h2", {}, "Associar registro realizado"),
                  node(
                    "p",
                    {},
                    "Registros deste plano, em páginas de 100. O vínculo não altera data, valores ou estado do treino.",
                  ),
                  select(
                    "Registro do mesmo plano",
                    "link-workout",
                    e.workoutId || "",
                    [
                      ["", "Sem vínculo"],
                      ...workouts.map((w) => [
                        w.id,
                        date(w.startedAt) +
                          " · " +
                          w.snapshot.sessionName +
                          " · " +
                          labels[w.status],
                      ]),
                    ],
                  ),
                  more,
                  button(
                    "Salvar vínculo",
                    action(async () => {
                      const id = $("link-workout").value;
                      if (
                        e.workoutId &&
                        !confirm("Substituir ou remover o vínculo atual?")
                      )
                        return;
                      await api("calendar/" + e.id + "/link", {
                        method: "POST",
                        body: {
                          version: e.version,
                          workoutId: id || null,
                          confirmation: "SUBSTITUIR",
                        },
                      });
                      dialog.close();
                      dialog.remove();
                      await render();
                    }),
                  ),
                  button("Fechar associação", () => {
                    dialog.close();
                    dialog.remove();
                  }),
                );
                document.body.append(dialog);
                dialog.showModal();
              }),
            ),
            button(
              "Cancelar data",
              action(async () => {
                if (
                  !confirm(
                    "Cancelar apenas este agendamento? O histórico será preservado.",
                  )
                )
                  return;
                await api(`calendar/${e.id}`, {
                  method: "DELETE",
                  body: { version: e.version, confirmation: "CANCELAR" },
                });
                reset();
                await render();
              }),
            ),
          ),
        ),
      ),
      ...ws.map((w) =>
        node(
          "article",
          { class: "calendar-entry" },
          node("span", { class: "tag" }, labels[w.status]),
          node("p", {}, w.snapshot.sessionName),
          w.status === "in_progress"
            ? link("Retomar sessão", `sessao-treino.html?id=${w.id}`)
            : workoutLink(w),
        ),
      ),
      !ev.length && !ws.length
        ? node("p", {}, "Sem agendamentos ou registros neste dia.")
        : null,
    );
  }
  async function render() {
    const revision = ++requestVersion;
    let from, to;
    if (view === "month") {
      from = anchor.slice(0, 7) + "-01";
      const d = new Date(`${from}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      to = shift(d.toISOString().slice(0, 10), -1);
    } else {
      from = shift(
        anchor,
        -(
          (new Date(`${anchor}T12:00:00Z`).getUTCDay() - prefs.weekStart + 7) %
          7
        ),
      );
      to = shift(from, 6);
    }
    const result = await api(
      `calendar?from=${from}&to=${to}&planId=${$("calendar-plan-filter").value}`,
    );
    if (revision !== requestVersion) return;
    data = result;
    caption.textContent =
      view === "month"
        ? new Date(`${from}T12:00:00Z`).toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })
        : `${pretty(from)} a ${pretty(to)}`;
    const days = [];
    for (let d = from; d <= to; d = shift(d, 1)) {
      const linked = data.events.filter((e) => e.date === d && e.workoutId);
      const planned = data.events.filter(
          (e) => e.date === d && !e.workoutId,
        ).length,
        done = data.workouts.filter(
          (w) => w.date === d && w.status === "completed",
        ).length,
        partial = data.workouts.filter(
          (w) => w.date === d && w.status === "partial",
        ).length,
        running = data.workouts.filter(
          (w) => w.date === d && w.status === "in_progress",
        ).length;
      days.push(
        button(
          "",
          () => {
            selected = d;
            reset();
            renderDay();
            grid
              .querySelectorAll("button")
              .forEach((b) =>
                b.setAttribute("aria-pressed", String(b.dataset.date === d)),
              );
          },
          {
            class: "calendar-day",
            "data-date": d,
            "aria-pressed": String(d === selected),
            "aria-label": `${pretty(d)}: ${planned} planejadas, ${done} concluídas, ${partial} parciais, ${running} em andamento`,
          },
        ),
      );
      days.at(-1).append(
        node(
          "strong",
          {},
          new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", {
            day: "numeric",
            weekday: "short",
            timeZone: "UTC",
          }),
        ),
        node(
          "span",
          {},
          planned
            ? `${planned} planejada(s)`
            : linked.length
              ? "Agenda vinculada"
              : "Sem planejamento",
        ),
        node(
          "span",
          {},
          linked
            .map((e) => labels[e.workoutStatus] + " · vinculada")
            .join(", "),
        ),
        node("span", {}, done ? `${done} concluída(s)` : ""),
        node("span", {}, partial ? `${partial} parcial(is)` : ""),
        node("span", {}, running ? `${running} em andamento` : ""),
      );
    }
    const offset =
      view === "month"
        ? (new Date(`${from}T12:00:00Z`).getUTCDay() - prefs.weekStart + 7) % 7
        : 0;
    grid.replaceChildren(
      ...Array.from({ length: offset }, () =>
        node("div", { class: "calendar-spacer", "aria-hidden": true }),
      ),
      ...days,
    );
    renderDay();
  }
  const move = (delta) =>
    action(async () => {
      if (view === "month") {
        const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + delta);
        anchor = d.toISOString().slice(0, 10);
      } else anchor = shift(anchor, delta * 7);
      selected = anchor;
      reset();
      await render();
    });
  root.replaceChildren(
    node(
      "div",
      { class: "notice" },
      `Fuso: ${prefs.timeZone}. Planejada é uma intenção; concluída ou parcial é um registro feito por você. Agendamentos permanecem separados do histórico.`,
    ),
    node(
      "section",
      { class: "card form-card" },
      node(
        "div",
        { class: "section-heading" },
        caption,
        node(
          "div",
          { class: "training-actions" },
          button("Anterior", move(-1)),
          button(
            "Hoje",
            action(async () => {
              anchor = localDay(Date.now(), prefs.timeZone);
              selected = anchor;
              reset();
              await render();
            }),
          ),
          button("Próximo", move(1)),
        ),
      ),
      select(
        "Visualização",
        "view",
        view,
        [
          ["month", "Mensal"],
          ["week", "Semanal"],
        ],
        (value) => {
          view = value;
          action(render)();
        },
      ),
      select(
        "Filtrar por plano",
        "calendar-plan-filter",
        "",
        [["", "Todos os planos"], ...plans.map((p) => [p.id, p.name])],
        () => action(render)(),
      ),
      grid,
    ),
    details,
    available.length
      ? form
      : panel("Crie um plano primeiro", link("Criar plano", "plano.html")),
  );
  if (available.length) {
    updateSessions();
    $("schedule-repeat").onchange = () => {
      $("recurrence-fields").hidden = $("schedule-repeat").value !== "weekly";
    };
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const recurring = $("schedule-repeat").value === "weekly";
      if (
        editing?.series &&
        !confirm(
          "Substituir as ocorrências futuras sem alterações individuais nem registros vinculados?",
        )
      )
        return;
      await api(
        recurring
          ? editing?.series
            ? "calendar-series/" + editing.series.id
            : "calendar-series"
          : editing
            ? `calendar/${editing.id}`
            : "calendar",
        {
          method: editing ? "PUT" : "POST",
          body: {
            version: editing?.series?.version || editing?.version,
            startDate: $("schedule-date").value,
            until: $("repeat-until").value,
            intervalWeeks: Number($("repeat-interval").value),
            weekdays: [0, 1, 2, 3, 4, 5, 6].filter(
              (i) => $("repeat-day-" + i).checked,
            ),
            confirmation: "SUBSTITUIR",
            date: $("schedule-date").value,
            planId: $("schedule-plan").value,
            sessionId: $("schedule-session").value,
          },
        },
      );
      anchor = $("schedule-date").value;
      selected = anchor;
      reset();
      await render();
      showMessage(
        message(),
        "Data salva. Nenhum treino foi marcado como concluído.",
      );
    })();
  };
  await render();
}

function bars(title, rows) {
  const max = Math.max(1, ...rows.map((r) => r.completed + r.partial));
  return panel(
    title,
    node(
      "p",
      { class: "small" },
      "Valores por período. As semanas e meses nas bordas incluem somente os dias do filtro.",
    ),
    node(
      "div",
      { class: "data-bars" },
      rows.map((r) =>
        node(
          "div",
          { class: "data-bar" },
          node("strong", {}, r.date),
          node("progress", {
            max,
            value: r.completed,
            "aria-label": `${r.date}: ${r.completed} concluídas`,
          }),
          node("progress", {
            max,
            value: r.partial,
            class: "partial-bar",
            "aria-label": `${r.date}: ${r.partial} parciais`,
          }),
          node("span", {}, `${r.completed} concluídas · ${r.partial} parciais`),
        ),
      ),
    ),
  );
}
async function statistics(root, prefs) {
  const { exercises } = await api("exercises"),
    today = localDay(Date.now(), prefs.timeZone);
  const form = node(
    "form",
    { method: "post", class: "card form-card" },
    node(
      "div",
      { class: "form-grid" },
      field("De", "stats-from", shift(today, -29), () => {}, {
        type: "date",
        required: true,
      }),
      field("Até", "stats-to", today, () => {}, {
        type: "date",
        required: true,
      }),
      select("Exercício", "stats-exercise", "", [
        ["", "Todos"],
        ...exercises.map((e) => [e.id, e.name]),
      ]),
      select("Estado das sessões", "stats-status", "", [
        ["", "Concluídas e parciais"],
        ["completed", "Concluídas"],
        ["partial", "Parciais"],
      ]),
    ),
    node(
      "button",
      { type: "submit", class: "btn btn-blue" },
      "Aplicar filtros",
    ),
  );
  const output = node("div", {
    id: "statistics-result",
    class: "training-list",
    "aria-live": "polite",
  });
  root.replaceChildren(
    node(
      "p",
      { class: "notice" },
      "As estatísticas descrevem registros, sem avaliar seu corpo. Séries com valor informado entram nos totais mesmo sem a marca de conclusão. Sessões em andamento ficam fora destes indicadores.",
    ),
    form,
    output,
  );
  let requestVersion = 0;
  async function render() {
    const revision = ++requestVersion;
    const query = new URLSearchParams({
      from: $("stats-from").value,
      to: $("stats-to").value,
      exerciseId: $("stats-exercise").value,
      status: $("stats-status").value,
    });
    const data = await api(`statistics?${query}`);
    if (revision !== requestVersion) return;
    const c = data.current,
      p = data.previous;
    replaceChildren(
      output,
      node(
        "p",
        { class: "small" },
        `Fuso: ${data.timeZone}. Comparação com ${pretty(data.previousFrom)} a ${pretty(data.previousTo)}, de igual duração.`,
      ),
      node(
        "div",
        { class: "metric-grid" },
        panel(
          "Sessões registradas",
          node("p", { class: "big-n" }, c.total),
          node("p", {}, `${c.completed} concluídas · ${c.partial} parciais`),
        ),
        panel(
          "Frequência de registros",
          node("p", { class: "big-n" }, c.daysRecorded),
          node(
            "p",
            {},
            `dia(s) com registros · ${c.sessionsPerWeek.toFixed(1)} sessão(ões) por semana no período`,
          ),
        ),
        panel(
          "Intervalo médio",
          node(
            "p",
            { class: "big-n" },
            c.averageGapDays === null ? "—" : c.averageGapDays.toFixed(1),
          ),
          node(
            "p",
            {},
            c.averageGapDays === null
              ? "Registre pelo menos duas sessões para calcular."
              : "dia(s) entre os inícios das sessões filtradas",
          ),
        ),
      ),
      panel(
        "Comparação de períodos",
        table(
          "Contagens no período e no anterior",
          ["Indicador", "Atual", "Anterior"],
          [
            ["Sessões", c.total, p.total],
            ["Concluídas", c.completed, p.completed],
            ["Parciais", c.partial, p.partial],
            ["Dias registrados", c.daysRecorded, p.daysRecorded],
          ],
        ),
      ),
      c.total
        ? null
        : node(
            "p",
            { class: "notice" },
            "Nenhuma sessão encerrada neste período e filtro.",
          ),
      bars("Sessões por semana", c.weeks),
      bars("Sessões por mês", c.months),
      panel(
        "Exercícios mais registrados",
        c.popular.length
          ? table(
              "Sessões com pelo menos um valor informado",
              ["Exercício", "Sessões"],
              c.popular.map((e) => [e.name, e.count]),
            )
          : node("p", {}, "Ainda não há valores de exercícios neste filtro."),
      ),
      panel(
        "Cargas, repetições e duração",
        node(
          "p",
          {},
          "Selecione um exercício para ver seus registros ao longo do tempo. Carga é o maior valor informado por sessão e exercício; repetições e duração são somadas separadamente.",
        ),
        $("stats-exercise").value && c.timeline.length
          ? loadChart(c.timeline)
          : null,
        c.timeline.length
          ? table(
              "Valores registrados, sem estimativas para campos vazios",
              [
                "Data / exercício",
                "Estado",
                "Carga máxima (kg)",
                "Repetições / duração",
              ],
              c.timeline.map((r) => [
                `${pretty(r.date)} · ${r.name}`,
                labels[r.status],
                r.maxLoad,
                `${r.values} ${r.mode === "seconds" ? "s" : "repetições"}`,
              ]),
            )
          : node("p", {}, "Sem valores registrados."),
      ),
    );
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    action(render)();
  };
  await render();
}
function loadChart(rows) {
  const maxLoad = Math.max(1, ...rows.map((r) => r.maxLoad || 0));
  const maxValues = Object.fromEntries(
    ["reps", "seconds"].map((mode) => [
      mode,
      Math.max(1, ...rows.filter((r) => r.mode === mode).map((r) => r.values)),
    ]),
  );
  return node(
    "div",
    { class: "data-bars" },
    rows.map((r) =>
      node(
        "div",
        { class: "data-bar" },
        node("strong", {}, pretty(r.date)),
        r.maxLoad === null
          ? node("span", {}, "Carga não informada")
          : node("progress", {
              max: maxLoad,
              value: r.maxLoad,
              "aria-label": `${pretty(r.date)} carga máxima ${r.maxLoad} kg`,
            }),
        node("progress", {
          max: maxValues[r.mode],
          value: r.values,
          "aria-label": `${pretty(r.date)} ${r.values} ${r.mode === "seconds" ? "segundos" : "repetições"}`,
        }),
        node(
          "span",
          {},
          `${r.maxLoad ?? "—"} kg · ${r.values} ${r.mode === "seconds" ? "s" : "repetições"}`,
        ),
      ),
    ),
  );
}

async function assistant(root, prefs) {
  const [config, { exercises }, { plans }] = await Promise.all([
    api("ai/config"),
    api("exercises"),
    api("plans"),
  ]);
  const external = config.external;
  const output = node("div", {
    id: "assistant-answer",
    class: "training-list",
    "aria-live": "polite",
  });
  const draftsPanel = panel(
    "Rascunhos para revisar",
    node("div", { id: "draft-list" }),
  );
  async function renderDrafts() {
    const { drafts } = await api("ai/drafts");
    const cards = drafts.map((d) => {
      const discard = button(
        "Descartar rascunho",
        action(async () => {
          if (!confirm("Descartar este rascunho?")) return;
          await api(`ai/drafts/${d.id}`, {
            method: "DELETE",
            body: { confirmation: "DESCARTAR" },
          });
          await renderDrafts();
        }),
      );
      return node(
        "article",
        { class: "calendar-entry" },
        node("h3", {}, d.plan.name),
        node(
          "p",
          { class: "small" },
          `${d.provider === "demo" ? "Demonstração local" : "Assistente"} · disponível até ${date(d.expiresAt)}`,
        ),
        node(
          "div",
          { class: "training-actions" },
          link("Continuar revisão", `plano.html?draft=${d.id}`),
          discard,
        ),
      );
    });
    $("draft-list").replaceChildren(
      ...(cards.length
        ? cards
        : [
            node(
              "p",
              {},
              "Nenhum rascunho pendente. Os rascunhos ficam disponíveis por sete dias.",
            ),
          ]),
    );
  }
  const equipment = node(
    "fieldset",
    { class: "equipment" },
    node("legend", {}, "Equipamentos para o rascunho"),
    node(
      "div",
      { class: "choice-grid" },
      ["peso-corporal", "halteres", "barras", "maquinas", "elasticos"].map(
        (id) =>
          checkbox(`draft-equipment-${id}`, labels[id], id === "peso-corporal"),
      ),
    ),
  );
  const draftFields = node(
    "fieldset",
    { id: "draft-fields" },
    node("legend", {}, "Preferências do rascunho"),
    node(
      "div",
      { class: "form-grid" },
      select(
        "Objetivo",
        "draft-goal",
        "forca",
        ["hipertrofia", "forca", "resistencia", "condicionamento"].map((v) => [
          v,
          labels[v],
        ]),
      ),
      select(
        "Experiência",
        "draft-experience",
        "iniciante",
        ["iniciante", "intermediario", "avancado"].map((v) => [v, labels[v]]),
      ),
      select(
        "Dias disponíveis por semana",
        "draft-days",
        3,
        [1, 2, 3, 4, 5, 6, 7].map((v) => [v, String(v)]),
      ),
      select(
        "Minutos disponíveis por sessão",
        "draft-minutes",
        45,
        [15, 30, 45, 60, 90, 120, 150, 180].map((v) => [v, String(v)]),
      ),
    ),
    equipment,
    field(
      "Preferência de organização (opcional)",
      "draft-organization",
      "",
      () => {},
      { maxlength: 200, placeholder: "Ex.: alternar sessões A e B" },
    ),
  );
  const form = node(
    "form",
    { method: "post", class: "card form-card" },
    node("h2", {}, "Sua solicitação"),
    select(
      "Tipo de solicitação",
      "assistant-kind",
      "chat",
      [
        ["chat", "Perguntar / revisar organização"],
        ["draft", "Solicitar rascunho"],
      ],
      (kind) => {
        draftFields.hidden = kind !== "draft";
        $("assistant-message").required = kind === "chat";
      },
    ),
    field("Mensagem (até 2000 caracteres)", "assistant-message", "", () => {}, {
      type: "textarea",
      maxlength: 2000,
      required: true,
    }),
    node(
      "div",
      { class: "form-grid" },
      select("Exercício para explicar (opcional)", "assistant-exercise", "", [
        ["", "Nenhum"],
        ...exercises.map((e) => [e.id, e.name]),
      ]),
      select("Plano para revisar (opcional)", "assistant-plan", "", [
        ["", "Nenhum"],
        ...plans.map((p) => [p.id, p.name]),
      ]),
    ),
    checkbox(
      "use-profile",
      "Usar minhas preferências do perfil nesta solicitação",
    ),
    node(
      "p",
      { class: "hint" },
      "Requer autorização nas configurações. Envia somente objetivo, experiência, dias, minutos e equipamentos. Se marcar, esses campos do perfil substituem os campos do rascunho abaixo.",
    ),
    draftFields,
    checkbox(
      "external-send",
      external
        ? "Confirmo enviar esta mensagem, organização e os contextos selecionados para OpenAI."
        : "Demonstração local: nenhum dado será enviado a um provedor.",
    ),
    node(
      "button",
      { type: "submit", class: "btn btn-blue", disabled: !config.available },
      external ? "Enviar solicitação" : "Testar demonstração local",
    ),
    node("p", { id: "assistant-state", role: "status", class: "small" }),
  );
  root.replaceChildren(
    node(
      "div",
      { class: "notice" },
      node(
        "strong",
        {},
        external
          ? `Provedor: OpenAI · ${config.available ? "configurado" : "indisponível"}`
          : "DEMONSTRAÇÃO LOCAL · sem IA generativa",
      ),
      node(
        "p",
        {},
        external
          ? "Mensagens são enviadas somente após seu consentimento. Respostas podem conter erros."
          : "Textos editoriais e estrutura fixa de exemplo. Este modo não interpreta mensagens nem gera orientação personalizada.",
      ),
      node("p", {}, config.safetyNote),
      link("Gerenciar consentimento", "configuracoes.html"),
    ),
    panel(
      "Escolha um assunto",
      node(
        "p",
        {},
        "Use um ponto de partida e edite sua pergunta antes de enviar.",
      ),
      node(
        "div",
        { class: "training-actions" },
        ...[
          "Como organizar sessões A e B no GymIA?",
          "Qual a diferença entre séries e repetições?",
          "Como registrar uma sessão parcial?",
          "Explique o exercício que selecionei na biblioteca.",
        ].map((text) =>
          button(text, () => {
            $("assistant-kind").value = "chat";
            draftFields.hidden = true;
            $("assistant-message").required = true;
            $("assistant-message").value = text;
            $("assistant-message").focus();
          }),
        ),
      ),
    ),
    form,
    output,
    draftsPanel,
  );
  await renderDrafts();
  draftFields.hidden = true;
  $("external-send").required = external;
  $("external-send").closest("label").hidden = !external;
  $("use-profile").disabled = !prefs.aiProfileConsent;
  form.onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      $("assistant-state").textContent = "Aguardando resposta…";
      try {
        const kind = $("assistant-kind").value;
        const result = await api(kind === "draft" ? "ai/drafts" : "ai/chat", {
          method: "POST",
          body: {
            message: $("assistant-message").value,
            organization: $("draft-organization").value,
            useProfile: $("use-profile").checked,
            externalConsent: $("external-send").checked,
            exerciseId: $("assistant-exercise").value,
            planId: $("assistant-plan").value,
            preferences: {
              goal: $("draft-goal").value,
              experience: $("draft-experience").value,
              days: Number($("draft-days").value),
              minutes: Number($("draft-minutes").value),
              equipment: [
                "peso-corporal",
                "halteres",
                "barras",
                "maquinas",
                "elasticos",
              ].filter((id) => $(`draft-equipment-${id}`).checked),
            },
          },
        });
        output.replaceChildren(
          panel(
            result.provider === "demo"
              ? "Conteúdo de demonstração"
              : "Resposta do assistente",
            node("p", { class: "assistant-text" }, result.answer),
            node("p", { class: "small" }, result.safetyNote),
            result.draft
              ? link(
                  "Revisar e editar rascunho",
                  `plano.html?draft=${result.draft.id}`,
                  true,
                )
              : null,
          ),
        );
        $("assistant-state").textContent = result.draft
          ? "Rascunho criado para revisão. Nenhum plano foi salvo ou ativado."
          : "Resposta recebida. Nenhum plano foi alterado.";
        await renderDrafts();
      } catch (error) {
        $("assistant-state").textContent = "Solicitação não concluída.";
        throw error;
      } finally {
        submit.disabled = false;
      }
    })();
  };
}
const root = document.querySelector("[data-evolution]");
if (root) {
  try {
    const { preferences } = await api("preferences");
    const content = $("evolution-content");
    await { calendar, statistics, assistant, settings, reports }[
      root.dataset.evolution
    ](content, preferences);
    content.hidden = false;
    document.querySelector("[data-loading]").hidden = true;
  } catch (error) {
    if (error.status === 401) location.replace("entrar.html");
    else {
      document.querySelector("[data-loading]").hidden = true;
      showMessage(message(), error.message, true);
    }
  }
}
