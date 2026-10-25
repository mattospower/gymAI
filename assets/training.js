import { api, showMessage } from "./api.js";
import { renderDashboard } from "./evolution.js";
import {
  node,
  button,
  link,
  field,
  library,
  labels,
  date,
} from "./training-ui.js";
const $ = (id) => document.getElementById(id);
const message = document.querySelector("[data-message]");
const kind = document.querySelector("[data-training]").dataset.training;
const params = new URLSearchParams(location.search);
let dirty = false,
  profile,
  catalog;
const action = (fn) => async () => {
  try {
    await fn();
  } catch (error) {
    showMessage(message, error.message, true);
  }
};
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("gymia:before-logout", (event) => {
  if (
    dirty &&
    !confirm(
      "Há alterações que ainda não foram salvas. Deseja sair e descartá-las?",
    )
  )
    event.preventDefault();
});
function statusBadge(status) {
  return node("span", { class: "tag" }, labels[status]);
}
function empty(text) {
  return node(
    "div",
    { class: "card form-card" },
    node("h2", {}, "Seu espaço está pronto."),
    node("p", {}, text),
    link("Criar meu primeiro plano", "plano.html", true),
  );
}

async function dashboard() {
  await renderDashboard(document.getElementById("dashboard-summary"));
  const [{ plans }, { workouts }] = await Promise.all([
    api("plans"),
    api("workouts"),
  ]);
  $("profile-context").replaceChildren(
    profile
      ? `Seu perfil: ${labels[profile.goal]} · ${labels[profile.experience]} · ${profile.days} dia(s)/semana · ${profile.minutes} min/sessão · ${labels[profile.location]}. Use essas informações para organizar seus próprios planos.`
      : node(
          "span",
          {},
          "Configure suas preferências para consultar sua rotina aqui. ",
          node(
            "a",
            { href: "configurar-perfil.html" },
            "Configurar meu perfil",
          ),
        ),
  );
  const running = workouts.find((w) => w.status === "in_progress");
  $("running-workout").replaceChildren(
    ...(running
      ? [
          node(
            "div",
            { class: "notice" },
            node("strong", {}, "Você tem uma sessão em andamento."),
            node(
              "p",
              {},
              `${running.snapshot.planName} · ${running.snapshot.sessionName}`,
            ),
            link("Retomar sessão", `sessao-treino.html?id=${running.id}`, true),
          ),
        ]
      : []),
  );
  const mutate = (plan, operation) =>
    action(async () => {
      if (operation === "delete") {
        const confirmation = prompt(
          `Excluir o plano “${plan.name}”? O histórico será mantido. Digite EXCLUIR para confirmar.`,
        );
        if (confirmation !== "EXCLUIR") return;
        await api(`plans/${plan.id}`, {
          method: "DELETE",
          body: { version: plan.version, confirmation },
        });
      } else
        await api(`plans/${plan.id}/${operation}`, {
          method: "POST",
          body: { version: plan.version },
        });
      await dashboard();
    });
  function render() {
    const filtered = plans.filter(
      (p) =>
        $("plan-state").value === "all" || p.status === $("plan-state").value,
    );
    $("plan-list").replaceChildren(
      ...filtered.map((plan) =>
        node(
          "article",
          { class: "card form-card plan-card" },
          node(
            "div",
            { class: "section-heading" },
            node("h2", {}, plan.name),
            statusBadge(plan.status),
          ),
          node("p", { class: "small" }, labels[plan.goal]),
          node("p", {}, plan.description),
          node(
            "ul",
            { class: "session-overview" },
            plan.sessions.map((session) =>
              node(
                "li",
                {},
                node(
                  "div",
                  {},
                  node("strong", {}, session.name),
                  node(
                    "p",
                    { class: "small" },
                    `${session.day || "Dia livre"} · ${session.exercises.length} exercício(s)`,
                  ),
                ),
                plan.status !== "archived" && session.exercises.length
                  ? button(
                      `Iniciar ${session.name}`,
                      action(async () => {
                        const { workout } = await api("workouts", {
                          method: "POST",
                          body: { planId: plan.id, sessionId: session.id },
                        });
                        location.assign(`sessao-treino.html?id=${workout.id}`);
                      }),
                    )
                  : null,
              ),
            ),
          ),
          node(
            "div",
            { class: "training-actions" },
            link(
              plan.status === "archived" ? "Ver plano" : "Ver / editar plano",
              `plano.html?id=${plan.id}`,
            ),
            button("Duplicar", mutate(plan, "duplicate")),
            plan.status === "archived"
              ? button("Reativar", mutate(plan, "restore"))
              : button("Arquivar", mutate(plan, "archive")),
            plan.status !== "archived" && plan.status !== "active"
              ? button("Definir como ativo", mutate(plan, "activate"))
              : null,
            button("Excluir plano", mutate(plan, "delete")),
          ),
        ),
      ),
    );
    if (!filtered.length)
      $("plan-list").append(
        empty(
          plans.length
            ? "Nenhum plano neste filtro."
            : "Você ainda não cadastrou planos. Comece organizando uma sessão manualmente.",
        ),
      );
  }
  $("plan-state").onchange = render;
  render();
}

async function editor() {
  const draftId = params.get("draft");
  const draft = draftId ? (await api(`ai/drafts/${draftId}`)).draft : null;
  let plan = params.get("id")
    ? (await api(`plans/${params.get("id")}`)).plan
    : {
        name: "",
        goal: profile?.goal || "",
        description: "",
        sessions: [
          { id: crypto.randomUUID(), name: "", day: "", exercises: [] },
        ],
      };
  if (draft) {
    plan = draft.plan;
    const notice = node(
      "div",
      { class: "notice" },
      node(
        "strong",
        {},
        `Rascunho ${draft.provider === "demo" ? "de demonstração local" : "do assistente"} — revise antes de salvar`,
      ),
      node(
        "p",
        {},
        "Nenhum plano foi criado ou ativado. Revise cada exercício e valor. As sugestões não são avaliação profissional nem garantem resultados.",
      ),
    );
    $("plan-form").prepend(notice);
    $("plan-form").append(
      node(
        "label",
        { class: "check" },
        node("input", {
          type: "checkbox",
          id: "draft-reviewed",
          required: true,
        }),
        node(
          "span",
          {},
          "Revisei os exercícios e valores e confirmo salvar como plano inativo.",
        ),
      ),
    );
    dirty = true;
  }
  const archived = plan.status === "archived";
  if (archived) {
    $("plan-form").replaceChildren(
      node(
        "p",
        { class: "notice" },
        "Este plano está arquivado. Reative-o no painel para editar.",
      ),
      node("h2", {}, plan.name),
      node("p", {}, plan.description),
      ...plan.sessions.map((s) =>
        node(
          "p",
          {},
          `${s.name} · ${s.day} · ${s.exercises.length} exercício(s)`,
        ),
      ),
      link("Voltar aos treinos", "treinos.html"),
    );
    return;
  }
  const changed = () => {
    dirty = true;
    $("plan-save-state").textContent = "Alterações ainda não salvas.";
  };
  for (const [id, key] of [
    ["plan-name", "name"],
    ["plan-goal", "goal"],
    ["plan-description", "description"],
  ]) {
    $(id).value = plan[key];
    $(id).addEventListener("input", () => {
      plan[key] = $(id).value;
      changed();
    });
  }
  const picker = $("exercise-picker");
  let targetSession;
  library($("picker-library"), catalog, profile, (exercise) => {
    if (targetSession.exercises.length >= 30) {
      picker.close();
      showMessage(message, "Limite de 30 exercícios por sessão.", true);
      return;
    }
    const entry = {
      id: crypto.randomUUID(),
      exerciseId: exercise.id,
      sets: null,
      mode: "reps",
      target: null,
      rest: null,
      notes: "",
    };
    targetSession.exercises.push(entry);
    changed();
    picker.close();
    render();
    $(`${entry.id}-sets`).focus();
  });
  $("close-picker").onclick = () => picker.close();
  function render() {
    $("planned-sessions").replaceChildren(
      ...plan.sessions.map((session, index) => {
        const entries = session.exercises.map((entry, i) => {
          const exercise = catalog.find((e) => e.id === entry.exerciseId);
          const numeric = (label, key, min, max) =>
            field(
              label,
              `${entry.id}-${key}`,
              entry[key],
              (value) => {
                entry[key] = value === "" ? null : Number(value);
                changed();
              },
              { type: "number", min, max, step: 1, required: true },
            );
          const move = (direction) => () => {
            const to = i + direction;
            [session.exercises[i], session.exercises[to]] = [
              session.exercises[to],
              session.exercises[i],
            ];
            changed();
            render();
            document.getElementById(`${entry.id}-title`).focus();
          };
          return node(
            "section",
            { class: "planned-exercise" },
            node(
              "div",
              { class: "section-heading" },
              node(
                "h3",
                { id: `${entry.id}-title`, tabindex: "-1" },
                `${i + 1}. ${exercise.name}`,
              ),
              node(
                "div",
                { class: "training-actions" },
                button("Subir", move(-1), {
                  disabled: i === 0,
                  "aria-label": `Subir ${exercise.name}`,
                }),
                button("Descer", move(1), {
                  disabled: i === session.exercises.length - 1,
                  "aria-label": `Descer ${exercise.name}`,
                }),
                button(
                  "Remover",
                  () => {
                    if (confirm(`Remover ${exercise.name} desta sessão?`)) {
                      session.exercises.splice(i, 1);
                      changed();
                      render();
                    }
                  },
                  { "aria-label": `Remover ${exercise.name}` },
                ),
              ),
            ),
            node(
              "p",
              { class: "small" },
              `${exercise.region} · ${exercise.equipmentText}`,
            ),
            node(
              "div",
              { class: "form-grid" },
              numeric("Número de séries", "sets", 1, 20),
              field(
                "Medida",
                `${entry.id}-mode`,
                entry.mode,
                (value) => {
                  entry.mode = value;
                  entry.target = null;
                  changed();
                  render();
                  $(`${entry.id}-target`).focus();
                },
                {
                  options: [
                    ["reps", "Repetições"],
                    ["seconds", "Duração em segundos"],
                  ],
                },
              ),
              numeric(
                entry.mode === "seconds"
                  ? "Duração por série (segundos)"
                  : "Repetições por série",
                "target",
                1,
                entry.mode === "seconds" ? 3600 : 1000,
              ),
              numeric("Descanso (segundos)", "rest", 0, 3600),
            ),
            field(
              "Observações do exercício (opcional)",
              `${entry.id}-notes`,
              entry.notes,
              (value) => {
                entry.notes = value;
                changed();
              },
              { type: "textarea", maxlength: 500 },
            ),
          );
        });
        return node(
          "section",
          { class: "card form-card planned-session" },
          node(
            "div",
            { class: "section-heading" },
            node("h2", {}, `Sessão ${index + 1}`),
            button("Duplicar sessão", () => {
              if (plan.sessions.length >= 7)
                return showMessage(
                  message,
                  "Limite de 7 sessões por plano.",
                  true,
                );
              const copy = structuredClone(session);
              copy.id = crypto.randomUUID();
              copy.name = `${copy.name.slice(0, 70)} (cópia)`;
              copy.exercises.forEach((e) => (e.id = crypto.randomUUID()));
              plan.sessions.splice(index + 1, 0, copy);
              changed();
              render();
              $(`${copy.id}-name`).focus();
            }),
            button("Remover sessão", () => {
              if (plan.sessions.length === 1) {
                showMessage(
                  message,
                  "Mantenha pelo menos uma sessão no plano.",
                  true,
                );
                return;
              }
              if (confirm("Remover esta sessão e seus exercícios?")) {
                plan.sessions.splice(index, 1);
                changed();
                render();
              }
            }),
          ),
          node(
            "div",
            { class: "form-grid" },
            field(
              "Nome da sessão",
              `${session.id}-name`,
              session.name,
              (value) => {
                session.name = value;
                changed();
              },
              { required: true, maxlength: 80 },
            ),
            field(
              "Dia ou organização (opcional)",
              `${session.id}-day`,
              session.day,
              (value) => {
                session.day = value;
                changed();
              },
              { maxlength: 40, placeholder: "Ex.: segunda-feira ou Sessão A" },
            ),
          ),
          ...entries,
          !entries.length
            ? node(
                "p",
                { class: "muted" },
                "Nenhum exercício adicionado. Você pode salvar esta sessão e organizá-la depois.",
              )
            : null,
          button("Adicionar exercício", () => {
            targetSession = session;
            picker.showModal();
            picker.querySelector("input").focus();
          }),
        );
      }),
    );
  }
  $("add-session").onclick = () => {
    if (plan.sessions.length >= 7) {
      showMessage(message, "Limite de 7 sessões por plano.", true);
      return;
    }
    const session = {
      id: crypto.randomUUID(),
      name: "",
      day: "",
      exercises: [],
    };
    plan.sessions.push(session);
    changed();
    render();
    $(`${session.id}-name`).focus();
  };
  $("plan-form").onsubmit = async (event) => {
    event.preventDefault();
    if (!$("plan-form").reportValidity()) return;
    const submit = $("plan-form").querySelector("[type=submit]");
    submit.disabled = true;
    try {
      $("plan-save-state").textContent = "Salvando no servidor…";
      const result = draft
        ? await api(`ai/drafts/${draftId}/save`, {
            method: "POST",
            body: { plan, reviewed: $("draft-reviewed").checked },
          })
        : await api(plan.id ? `plans/${plan.id}` : "plans", {
            method: plan.id ? "PUT" : "POST",
            body: plan,
          });
      plan = result.plan;
      dirty = false;
      location.assign("treinos.html");
    } catch (error) {
      showMessage(message, error.message, true);
    } finally {
      submit.disabled = false;
    }
  };
  render();
}

async function workout() {
  const { workout } = await api(`workouts/${params.get("id") || ""}`);
  $("workout-heading").replaceChildren(
    node("h2", {}, workout.snapshot.sessionName),
    node(
      "p",
      {},
      `${workout.snapshot.planName} · Iniciada em ${date(workout.startedAt)}`,
    ),
  );
  if (workout.status !== "in_progress") {
    $("workout-form").replaceChildren(
      node("p", { class: "notice" }, "Esta sessão já foi encerrada."),
      link("Consultar histórico", "historico.html"),
    );
    return;
  }
  let timer,
    serial = 0,
    queue = Promise.resolve();
  function save(status = "in_progress") {
    queue = queue
      .catch(() => {})
      .then(async () => {
        const captured = serial;
        $("workout-save-state").textContent = "Salvando no servidor…";
        const result = await api(`workouts/${workout.id}`, {
          method: "PUT",
          body: {
            version: workout.version,
            status,
            notes: workout.notes,
            records: structuredClone(workout.records),
          },
        });
        workout.version = result.workout.version;
        if (serial === captured) dirty = false;
        $("workout-save-state").textContent = dirty
          ? "Há novas alterações aguardando salvamento."
          : "Registro salvo no servidor.";
        return result;
      });
    queue.catch((error) => {
      $("workout-save-state").textContent =
        "Não foi possível salvar. Seus valores continuam nesta tela. Use Salvar agora para tentar novamente.";
      showMessage(message, error.message, true);
    });
    return queue;
  }
  const changed = () => {
    dirty = true;
    serial++;
    clearTimeout(timer);
    $("workout-save-state").textContent = "Alterações aguardando salvamento…";
    timer = setTimeout(() => save(), 600);
  };
  $("workout-exercises").replaceChildren(
    ...workout.snapshot.exercises.map((exercise, index) => {
      const record = workout.records[index];
      const rows = record.sets.map((set, i) => {
        const prefix = `${exercise.id}-${i}`;
        const done = node("input", {
          type: "checkbox",
          id: `${prefix}-done`,
          checked: set.completed,
          onchange: (event) => {
            set.completed = event.target.checked;
            changed();
          },
        });
        return node(
          "div",
          { class: "set-record" },
          node("span", { class: "mono" }, `Série ${i + 1}`),
          field(
            exercise.mode === "seconds"
              ? "Duração realizada (s)"
              : "Repetições realizadas",
            `${prefix}-value`,
            set.value,
            (value) => {
              set.value = value === "" ? null : Number(value);
              changed();
            },
            {
              type: "number",
              min: 0,
              max: exercise.mode === "seconds" ? 86400 : 1000,
              step: 1,
            },
          ),
          field(
            "Carga (kg, opcional)",
            `${prefix}-load`,
            set.load,
            (value) => {
              set.load = value === "" ? null : Number(value);
              changed();
            },
            { type: "number", min: 0, max: 2000, step: 0.01 },
          ),
          node(
            "label",
            { class: "check", for: done.id },
            done,
            node("span", {}, "Concluída"),
          ),
        );
      });
      return node(
        "section",
        { class: "card form-card" },
        node("h2", {}, exercise.name),
        node(
          "p",
          { class: "small" },
          `Planejado por você: ${exercise.sets} série(s) · ${exercise.target} ${exercise.mode === "seconds" ? "s" : "repetições"} · descanso ${exercise.rest} s`,
        ),
        exercise.notes ? node("p", {}, exercise.notes) : null,
        ...rows,
        field(
          "Observações do exercício (opcional)",
          `${exercise.id}-notes`,
          record.notes,
          (value) => {
            record.notes = value;
            changed();
          },
          { type: "textarea", maxlength: 500 },
        ),
      );
    }),
  );
  $("workout-notes").value = workout.notes;
  $("workout-notes").oninput = () => {
    workout.notes = $("workout-notes").value;
    changed();
  };
  $("workout-form").onsubmit = (event) => event.preventDefault();
  $("save-workout").onclick = action(() => {
    clearTimeout(timer);
    if ($("workout-form").reportValidity()) return save();
  });
  const finish = (status) =>
    action(async () => {
      if (!$("workout-form").reportValidity()) return;
      if (
        !confirm(
          status === "partial"
            ? "Interromper e salvar o que foi registrado?"
            : "Finalizar com os valores registrados, mesmo sem concluir todas as séries?",
        )
      )
        return;
      clearTimeout(timer);
      $("workout-fields").disabled = true;
      document.querySelectorAll("#workout-form button").forEach((b) => {
        b.disabled = true;
      });
      try {
        await save(status);
        dirty = false;
        location.assign("historico.html");
      } catch {
        $("workout-fields").disabled = false;
        document.querySelectorAll("#workout-form button").forEach((b) => {
          b.disabled = false;
        });
      }
    });
  $("partial-workout").onclick = finish("partial");
  $("finish-workout").onclick = finish("completed");
  $("workout-save-state").textContent =
    "Registro recuperado do servidor. Os campos são salvos após alterações.";
}

async function history() {
  const initial = (await api("workouts")).workouts;
  const names = new Map(initial.map((w) => [w.planId, w.snapshot.planName]));
  $("history-plan").append(
    ...[...names].map(([id, name]) => node("option", { value: id }, name)),
  );
  async function render() {
    const query = new URLSearchParams();
    if ($("history-plan").value) query.set("planId", $("history-plan").value);
    if ($("history-from").value)
      query.set(
        "fromInstant",
        new Date(`${$("history-from").value}T00:00:00`).toISOString(),
      );
    if ($("history-to").value) {
      const end = new Date(`${$("history-to").value}T00:00:00`);
      end.setDate(end.getDate() + 1);
      query.set("untilInstant", end.toISOString());
    }
    const workouts = params.has("id")
      ? [(await api(`workouts/${params.get("id")}`)).workout]
      : (await api(`workouts?${query}`)).workouts;
    $("history-list").replaceChildren(
      ...workouts.map((w) =>
        node(
          "article",
          { class: "card form-card", id: `workout-${w.id}` },
          node(
            "div",
            { class: "section-heading" },
            node("h2", {}, w.snapshot.sessionName),
            statusBadge(w.status),
          ),
          node("p", {}, `${w.snapshot.planName} · ${date(w.startedAt)}`),
          w.finishedAt
            ? node(
                "p",
                { class: "small" },
                `Encerrada em ${date(w.finishedAt)}`,
              )
            : link("Retomar sessão", `sessao-treino.html?id=${w.id}`),
          node(
            "details",
            {},
            node("summary", {}, "Ver exercícios e registros"),
            w.snapshot.exercises.map((exercise, index) =>
              node(
                "section",
                { class: "history-exercise" },
                node("h3", {}, exercise.name),
                node(
                  "ul",
                  {},
                  w.records[index].sets.map((set, i) =>
                    node(
                      "li",
                      {},
                      `Série ${i + 1}: ${set.completed ? "concluída" : "não marcada como concluída"} · ${set.value === null ? "sem valor informado" : `${set.value} ${exercise.mode === "seconds" ? "s" : "repetições"}`} · ${set.load === null ? "sem carga informada" : `${set.load} kg`}`,
                    ),
                  ),
                ),
                w.records[index].notes
                  ? node("p", {}, w.records[index].notes)
                  : null,
              ),
            ),
            w.notes
              ? node("p", {}, `Observações da sessão: ${w.notes}`)
              : node("p", { class: "small" }, "Sem observações da sessão."),
          ),
        ),
      ),
    );
    if (params.has("id"))
      $("history-list").querySelector("details")?.setAttribute("open", "");
    if (!workouts.length)
      $("history-list").append(
        node(
          "p",
          { class: "notice" },
          "Nenhum registro encontrado neste período. Seu histórico será preenchido com as sessões que você registrar.",
        ),
      );
  }
  $("history-filter").onsubmit = (event) => {
    event.preventDefault();
    params.delete("id");
    window.history.replaceState(null, "", "historico.html");
    action(render)();
  };
  await render();
}

try {
  const user = (await api("session")).user;
  if (!user) {
    location.replace("entrar.html");
  } else {
    const [context, libraryData] = await Promise.all([
      api("training-context"),
      api("exercises"),
    ]);
    profile = context.profile;
    catalog = libraryData.exercises;
    if (kind === "dashboard") await dashboard();
    else if (kind === "editor") await editor();
    else if (kind === "library")
      library($("exercise-library"), catalog, profile);
    else if (kind === "workout") await workout();
    else if (kind === "history") await history();
    $("training-content").hidden = false;
    document.querySelector("[data-loading]").hidden = true;
  }
} catch (error) {
  if (error.status === 401) location.replace("entrar.html");
  else {
    document.querySelector("[data-loading]").hidden = true;
    showMessage(message, error.message, true);
  }
}
