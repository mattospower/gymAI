import { api } from "./api.js";
import { node, button, field, labels, date } from "./training-ui.js";
import { panel, select, table } from "./data-ui.js";
const detail = (p, catalog = []) => [
  p.name,
  labels[p.goal] || "Não definido",
  p.description || "Sem descrição",
  ...p.sessions.map(
    (s, i) =>
      `${i + 1}. ${s.name || "Sem nome"} · ${s.day || "Sem dia"}\n` +
      s.exercises
        .map(
          (e) =>
            `${catalog.find((item) => item.id === e.exerciseId)?.name || e.exerciseId} · ${e.sets ?? "—"} série(s) · ${e.target ?? "—"} ${e.mode === "seconds" ? "segundos" : "repetições"} · descanso ${e.rest ?? "—"} s · ${e.notes || ""}`,
        )
        .join("\n"),
  ),
];
export function comparison(before, after, catalog) {
  const a = detail(before, catalog),
    b = detail(after, catalog),
    names = ["Nome", "Objetivo", "Descrição"];
  return table(
    "Comparação dos valores informados",
    ["Campo", "Referência", "Edição atual"],
    Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [
      names[i] || `Sessão ${i - 2}`,
      a[i] || "Ausente",
      b[i] || "Ausente",
    ]),
  );
}
export async function installPlanTools({
  form,
  getPlan,
  applySessions,
  action,
  dirty,
  catalog,
}) {
  const { templates, notice } = await api("plan-templates"),
    plan = getPlan();
  const preview = node("dialog", {
    class: "library-dialog",
    "aria-label": "Pré-visualização do plano",
  });
  document.body.append(preview);
  const previewPlan = () => {
    const p = getPlan();
    preview.replaceChildren(
      node("h2", {}, "Pré-visualização do plano"),
      node(
        "p",
        {},
        "Confira os campos antes de salvar. Campos em branco precisam ser preenchidos por você.",
      ),
      table(
        "Organização informada",
        ["Campo", "Valor"],
        detail(p, catalog).map((v, i) => [
          i < 3 ? ["Nome", "Objetivo", "Descrição"][i] : `Sessão ${i - 2}`,
          v,
        ]),
      ),
      button("Fechar pré-visualização", () => preview.close()),
    );
    preview.showModal();
  };
  const template = select("Modelo de organização", "plan-template", "", [
    ["", "Selecione um exemplo"],
    ...templates.map((t) => [t.id, t.name]),
  ]);
  const tools = panel(
    "Organizar e revisar",
    node("p", { class: "small" }, notice),
    template,
    button("Usar modelo", () => {
      const t = templates.find(
        (t) => t.id === document.getElementById("plan-template").value,
      );
      if (!t) return;
      if (
        !confirm(
          "Substituir as sessões desta edição pelo modelo vazio? Seus dados salvos e o histórico só mudam se você salvar depois.",
        )
      )
        return;
      applySessions(
        t.sessions.map((name) => ({
          id: crypto.randomUUID(),
          name,
          day: "",
          exercises: [],
        })),
      );
    }),
    button("Pré-visualizar plano", previewPlan),
  );
  form.prepend(tools);
  const output = node("div", { id: "plan-comparison" }),
    comparePanel = panel(
      "Comparar antes de decidir",
      node(
        "p",
        { class: "small" },
        "A comparação não substitui dados. As versões guardam até 30 estados a partir desta atualização; o histórico de execução permanece independente.",
      ),
      output,
    );
  if (plan.id) {
    const { versions } = await api(`plans/${plan.id}/versions`);
    comparePanel.insertBefore(
      select(
        "Versão de referência",
        "compare-version",
        versions[0].version,
        versions.map((v) => [
          v.version,
          `Versão ${v.version} · ${date(v.updatedAt)} · ${labels[v.status]}`,
        ]),
      ),
      output,
    );
    comparePanel.insertBefore(
      button(
        "Comparar versão",
        action(async () => {
          const { plan: prior } = await api(
            `plans/${plan.id}/versions/${document.getElementById("compare-version").value}`,
          );
          output.replaceChildren(comparison(prior, getPlan(), catalog));
        }),
      ),
      output,
    );
    comparePanel.append(
      button(
        "Comparar com dados mais recentes",
        action(async () => {
          const { plan: latest } = await api(`plans/${plan.id}`);
          output.replaceChildren(
            node(
              "p",
              {},
              `Servidor: versão ${latest.version}. Esta edição: versão ${getPlan().version}.`,
            ),
            comparison(latest, getPlan(), catalog),
            button("Reabrir versão do servidor", () => {
              if (
                !dirty() ||
                confirm(
                  "Descartar as alterações desta tela e reabrir o plano salvo?",
                )
              )
                location.reload();
            }),
          );
        }),
      ),
    );
  } else {
    const { plans } = await api("plans");
    comparePanel.insertBefore(
      select("Plano de referência", "compare-plan", "", [
        ["", "Selecione"],
        ...plans.map((p) => [p.id, p.name]),
      ]),
      output,
    );
    comparePanel.insertBefore(
      button(
        "Comparar com plano",
        action(async () => {
          const id = document.getElementById("compare-plan").value;
          if (!id) return;
          const { plan: prior } = await api(`plans/${id}`);
          output.replaceChildren(comparison(prior, getPlan(), catalog));
        }),
      ),
      output,
    );
  }
  form.append(comparePanel);
}
