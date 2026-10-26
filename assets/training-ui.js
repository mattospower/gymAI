export function node(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
    else if (key === "class") element.className = value;
    else if (value !== false && value != null)
      element.setAttribute(key, value === true ? "" : String(value));
  }
  children.flat(Infinity).forEach((child) => {
    if (child != null)
      element.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  });
  return element;
}
export const labels = {
  hipertrofia: "Hipertrofia",
  forca: "Força",
  resistencia: "Resistência muscular",
  condicionamento: "Condicionamento físico",
  iniciante: "Iniciante",
  intermediario: "Intermediário",
  avancado: "Avançado",
  academia: "Academia",
  casa: "Casa",
  outro: "Outro ambiente",
  halteres: "Halteres",
  barras: "Barras",
  maquinas: "Máquinas",
  elasticos: "Elásticos",
  "peso-corporal": "Peso corporal",
  outros: "Outros",
  active: "Ativo",
  saved: "Salvo",
  archived: "Arquivado",
  in_progress: "Em andamento",
  completed: "Finalizada",
  partial: "Parcial",
};
export const button = (text, action, attrs = {}) =>
  node(
    "button",
    { type: "button", class: "btn btn-line", onclick: action, ...attrs },
    text,
  );
export const link = (text, href, blue = false) =>
  node("a", { class: `btn ${blue ? "btn-blue" : "btn-line"}`, href }, text);
export const date = (value) => new Date(value).toLocaleString("pt-BR");
export function field(
  label,
  id,
  value,
  oninput,
  { type = "text", options, ...attrs } = {},
) {
  const input = options
    ? node(
        "select",
        { id, ...attrs },
        options.map(([value, text]) => node("option", { value }, text)),
      )
    : node(type === "textarea" ? "textarea" : "input", {
        id,
        ...(type === "textarea" ? { rows: 3 } : { type }),
        ...attrs,
      });
  input.value = value ?? "";
  input.addEventListener(options ? "change" : "input", () =>
    oninput(input.value),
  );
  return node(
    "div",
    { class: "field" },
    node("label", { for: id }, label),
    input,
  );
}
export function library(container, catalog, profile, onSelect) {
  const query = node("input", {
    id: `${container.id}-search`,
    type: "search",
    placeholder: "Nome, região ou categoria",
  });
  const equipment = node(
    "select",
    { id: `${container.id}-equipment` },
    node("option", { value: "" }, "Todos os equipamentos"),
    ["peso-corporal", "halteres", "barras", "maquinas", "elasticos"].map((id) =>
      node("option", { value: id }, labels[id]),
    ),
  );
  const category = node(
    "select",
    { id: `${container.id}-category` },
    node("option", { value: "" }, "Todas as categorias"),
    [...new Set(catalog.map((e) => e.category))].map((value) =>
      node("option", { value }, value),
    ),
  );
  const mine = node("input", {
    type: "checkbox",
    id: `${container.id}-mine`,
    disabled: !profile,
  });
  const region = node(
    "select",
    { id: `${container.id}-region` },
    node("option", { value: "" }, "Todas as regiões"),
    [...new Set(catalog.map((e) => e.region))]
      .sort()
      .map((value) => node("option", { value }, value)),
  );
  const count = node("p", { class: "small", role: "status" }),
    list = node("div", { class: "exercise-grid" });
  let visible = 12;
  const group = node(
    "select",
    { id: `${container.id}-group` },
    node("option", { value: "" }, "Todos os tipos"),
    ...[
      "Peso corporal",
      "Máquinas",
      "Pesos livres",
      "Mobilidade",
      "Alongamento",
      "Aeróbico",
    ].map((v) => node("option", { value: v }, v)),
  );
  const more = button("Mostrar mais exercícios", () => {
    visible += 12;
    render();
  });
  const controls = [
    ["Pesquisar exercício", query],
    ["Equipamento", equipment],
    ["Categoria", category],
    ["Região", region],
    ["Tipo de atividade", group],
  ].map(([label, input]) =>
    node(
      "div",
      { class: "field" },
      node("label", { for: input.id }, label),
      input,
    ),
  );
  container.replaceChildren(
    node("div", { class: "library-filters" }, controls),
    node(
      "label",
      { class: "check", for: mine.id },
      mine,
      node(
        "span",
        {},
        "Usar equipamentos do meu perfil (inclui peso corporal)",
      ),
    ),
    count,
    list,
    more,
  );
  function render() {
    const normalize = (value) =>
      value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
    const matches = catalog.filter(
      (e) =>
        (!group.value || e.group === group.value) &&
        normalize(
          `${e.name} ${e.region} ${e.category} ${e.equipmentText} ${e.group}`,
        ).includes(normalize(query.value)) &&
        (!region.value || region.value === e.region) &&
        (!equipment.value || e.equipment.includes(equipment.value)) &&
        (!category.value || category.value === e.category) &&
        (!mine.checked ||
          e.equipment.every(
            (id) => id === "peso-corporal" || profile.equipment.includes(id),
          )),
    );
    count.textContent = `${matches.length} exercício(s) encontrado(s). Os equipamentos complementares estão descritos em cada cartão.`;
    list.replaceChildren(
      ...matches.slice(0, visible).map((e) =>
        node(
          "article",
          { class: "card form-card exercise-card" },
          node("span", { class: "tag" }, e.category),
          node("h3", {}, e.name),
          node("p", { class: "small" }, `${e.region} · ${e.equipmentText}`),
          node("p", {}, e.description),
          node(
            "details",
            {},
            node("summary", {}, "Orientações e fonte"),
            node("p", {}, e.guidance),
            node(
              "a",
              { href: e.source, target: "_blank", rel: "noopener noreferrer" },
              `Referência: ${e.sourceName || "ACE Exercise Library"} (em inglês)`,
            ),
          ),
          onSelect
            ? button(`Adicionar ${e.name}`, () => onSelect(e), {
                "aria-label": `Adicionar ${e.name}`,
              })
            : null,
        ),
      ),
    );
    more.hidden = matches.length <= visible;
    if (!matches.length)
      list.append(
        node(
          "p",
          { class: "notice" },
          "Nenhum exercício corresponde à pesquisa. Ajuste os filtros.",
        ),
      );
  }
  [query, equipment, category, region, mine, group].forEach((input) =>
    input.addEventListener(input === query ? "input" : "change", () => {
      visible = 12;
      render();
    }),
  );
  render();
}
