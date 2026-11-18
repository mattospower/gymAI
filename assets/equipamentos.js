const form = document.querySelector("#equipamento-form");
const select = document.querySelector("#equipamento");
const list = document.querySelector("#lista-equipamentos");
const status = document.querySelector("#estado-equipamentos");
const submit = document.querySelector("#gravar-equipamento");
const cancel = document.querySelector("#cancelar-edicao");
const key = "gymia.equipamentos.v1";
const allowed = Array.from(select.options, option => option.value);
let items = [];
let editing = -1;
try {
  const saved = JSON.parse(sessionStorage.getItem(key));
  if (Array.isArray(saved)) items = [...new Set(saved.filter(item => allowed.includes(item)))];
} catch {
  status.textContent = "Não foi possível recuperar a lista desta aba.";
}

function resetEditor() {
  editing = -1;
  cancel.hidden = true;
  submit.textContent = "Adicionar";
  select.focus();
}

function persist(next, message) {
  try {
    sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    status.textContent = "O navegador bloqueou o salvamento. Permita armazenamento nesta aba.";
    return;
  }
  items = next;
  resetEditor();
  render();
  status.textContent = message;
}

function render() {
  list.replaceChildren();
  items.forEach((item, index) => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = item;
    row.append(label);
    for (const action of ["Editar", "Remover"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button";
      button.textContent = action;
      button.setAttribute("aria-label", action + " " + item);
      button.onclick = () => {
        if (action === "Remover") {
          persist(items.filter((_, i) => i !== index), item + " removido.");
          return;
        }
        editing = index;
        select.value = item;
        submit.textContent = "Salvar alteração";
        cancel.hidden = false;
        select.focus();
        status.textContent = "Editando " + item + ".";
      };
      row.append(button);
    }
    list.append(row);
  });
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const value = select.value;
  if (items.some((item, i) => item === value && i !== editing)) {
    status.textContent = "Esse equipamento já está na lista.";
    return;
  }
  const next = [...items];
  next[editing < 0 ? next.length : editing] = value;
  persist(next, value + " salvo.");
});
cancel.onclick = () => {
  resetEditor();
  status.textContent = "Edição cancelada.";
};
render();
