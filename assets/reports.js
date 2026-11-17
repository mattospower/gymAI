import { api, showMessage } from "./api.js";
import { node, button, link, field, labels } from "./training-ui.js";
import { panel, select, table, download } from "./data-ui.js";
const $ = (id) => document.getElementById(id);
const day = (t, z) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: z }).format(t);
export async function reports(root, prefs) {
  const [{ plans }, { exercises }] = await Promise.all([
    api("plans"),
    api("exercises"),
  ]);
  const to = day(Date.now(), prefs.timeZone),
    from = new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
  let page = 1,
    query,
    latest,
    revision = 0;
  const message = document.querySelector("[data-message]");
  const action = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      showMessage(message, e.message, true);
    }
  };
  const output = node("div", { id: "report-output", class: "training-list" });
  const fields = node(
    "div",
    { class: "form-grid" },
    field("De", "report-from", from, () => {}, {
      type: "date",
      required: true,
    }),
    field("Até", "report-to", to, () => {}, { type: "date", required: true }),
    select("Plano", "report-plan", "", [
      ["", "Todos"],
      ...plans.map((p) => [p.id, p.name]),
    ]),
    select("Exercício", "report-exercise", "", [
      ["", "Todos"],
      ...exercises.map((e) => [e.id, e.name]),
    ]),
    select("Estado das sessões", "report-status", "", [
      ["", "Concluídas e parciais"],
      ["completed", "Concluídas"],
      ["partial", "Parciais"],
    ]),
  );
  const form = node(
    "form",
    { class: "card form-card report-controls" },
    fields,
    node(
      "button",
      { type: "submit", class: "btn btn-blue" },
      "Gerar relatório",
    ),
  );
  function filters() {
    return new URLSearchParams({
      from: $("report-from").value,
      to: $("report-to").value,
      planId: $("report-plan").value,
      exerciseId: $("report-exercise").value,
      status: $("report-status").value,
      pageSize: "25",
    });
  }
  async function render() {
    const serial = ++revision;
    const q = new URLSearchParams(query);
    q.set("page", page);
    const d = await api(`reports?${q}`);
    if (serial !== revision) return;
    latest = d;
    output.replaceChildren(
      panel(
        "Resumo do período",
        node(
          "p",
          {},
          `${d.from} a ${d.to} · Fuso: ${d.timeZone}. Sessões encerradas, agrupadas pela data de início. Sem inferências sobre saúde.`,
        ),
        table(
          "Comparação com período anterior de igual duração",
          ["Indicador", "Atual", "Anterior"],
          [
            ["Sessões", d.current.total, d.previous.total],
            ["Concluídas", d.current.completed, d.previous.completed],
            ["Parciais", d.current.partial, d.previous.partial],
            [
              "Dias com registros",
              d.current.daysRecorded,
              d.previous.daysRecorded,
            ],
            [
              "Sessões por semana",
              d.current.sessionsPerWeek.toFixed(2),
              d.previous.sessionsPerWeek.toFixed(2),
            ],
          ],
        ),
        node(
          "p",
          { class: "small" },
          `Anterior: ${d.previousFrom} a ${d.previousTo}. Valores vazios não são tratados como zero.`,
        ),
      ),
      panel(
        "Histórico do período",
        node(
          "p",
          { role: "status" },
          `${d.total} sessões · página ${d.page} de ${d.totalPages}`,
        ),
        ...(d.workouts.length
          ? d.workouts.map((w) =>
              node(
                "article",
                { class: "report-workout" },
                node(
                  "h3",
                  {},
                  `${w.snapshot.sessionName} · ${labels[w.status]}`,
                ),
                node(
                  "p",
                  {},
                  `${day(w.startedAt, prefs.timeZone)} · ${w.snapshot.planName}`,
                ),
                table(
                  "Séries e valores registrados",
                  [
                    "Exercício",
                    "Série",
                    "Marcada concluída",
                    "Medida",
                    "Valor realizado",
                    "Carga (kg)",
                  ],
                  w.snapshot.exercises.flatMap((e, i) =>
                    w.records[i].sets.map((s, j) => [
                      e.name,
                      j + 1,
                      s.completed ? "Sim" : "Não",
                      e.mode === "seconds" ? "Segundos" : "Repetições",
                      s.value,
                      s.load,
                    ]),
                  ),
                ),
                link("Abrir registro", `historico.html?id=${w.id}`),
              ),
            )
          : [node("p", {}, "Nenhuma sessão encerrada neste período.")]),
        node(
          "div",
          { class: "training-actions report-controls" },
          button(
            "Página anterior",
            action(async () => {
              page--;
              await render();
            }),
            { disabled: page === 1 },
          ),
          button(
            "Próxima página",
            action(async () => {
              page++;
              await render();
            }),
            { disabled: page >= d.totalPages },
          ),
        ),
      ),
    );
  }
  const exportReport = (kind) =>
    action(async () => {
      const q = new URLSearchParams(query);
      q.set("format", kind);
      if (kind === "json") {
        const d = await api(`reports?${q}`);
        download(JSON.stringify(d, null, 2), "gymia-relatorio.json");
      } else {
        const r = await fetch(`/api/reports?${q}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "X-GymIA-Request": "1" },
        });
        if (!r.ok) {
          const e = await r.json();
          throw Error(e.message);
        }
        download(
          await r.text(),
          "gymia-relatorio.csv",
          "text/csv;charset=utf-8",
        );
      }
      showMessage(
        message,
        "Exportação completa do período preparada. Guarde o arquivo em local privado.",
      );
    });
  root.replaceChildren(
    form,
    node(
      "div",
      { class: "training-actions report-controls" },
      button("Exportar CSV", exportReport("csv")),
      button("Exportar JSON do período", exportReport("json")),
      button(
        "Imprimir relatório",
        action(async () => {
          const q = new URLSearchParams(query);
          q.set("format", "json");
          const snapshot = await api(`reports?${q}`),
            pages = [snapshot];
          const print = node(
            "div",
            { id: "print-report" },
            node("h1", {}, "GymIA · Relatório de acompanhamento"),
            node(
              "p",
              {},
              `${snapshot.from} a ${snapshot.to} · ${snapshot.timeZone} · ${snapshot.current.completed} concluídas, ${snapshot.current.partial} parciais; ${snapshot.current.sessionsPerWeek.toFixed(2)} sessões/semana.`,
            ),
            table(
              `Comparação com ${snapshot.previousFrom} a ${snapshot.previousTo}`,
              ["Indicador", "Atual", "Anterior"],
              [
                ["Sessões", snapshot.current.total, snapshot.previous.total],
                [
                  "Concluídas",
                  snapshot.current.completed,
                  snapshot.previous.completed,
                ],
                [
                  "Parciais",
                  snapshot.current.partial,
                  snapshot.previous.partial,
                ],
                [
                  "Dias com registros",
                  snapshot.current.daysRecorded,
                  snapshot.previous.daysRecorded,
                ],
                [
                  "Sessões por semana",
                  snapshot.current.sessionsPerWeek.toFixed(2),
                  snapshot.previous.sessionsPerWeek.toFixed(2),
                ],
              ],
            ),
            ...pages.flatMap((p) =>
              p.workouts.map((w) =>
                node(
                  "section",
                  {},
                  node(
                    "h2",
                    {},
                    `${day(w.startedAt, prefs.timeZone)} · ${w.snapshot.sessionName} · ${labels[w.status]}`,
                  ),
                  node("p", {}, w.snapshot.planName),
                  table(
                    "Valores registrados",
                    [
                      "Exercício",
                      "Série",
                      "Concluída",
                      "Medida",
                      "Valor",
                      "kg",
                    ],
                    w.snapshot.exercises.flatMap((e, i) =>
                      w.records[i].sets.map((s, j) => [
                        e.name,
                        j + 1,
                        s.completed ? "Sim" : "Não",
                        e.mode === "seconds" ? "Segundos" : "Repetições",
                        s.value,
                        s.load,
                      ]),
                    ),
                  ),
                ),
              ),
            ),
          );
          document.getElementById("print-report")?.remove();
          document.body.append(print);
          window.print();
        }),
      ),
    ),
    output,
  );
  query = filters();
  form.onsubmit = (e) => {
    e.preventDefault();
    page = 1;
    query = filters();
    action(render)();
  };
  await render();
}
