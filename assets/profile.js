import { api, showMessage } from "./api.js";

const form = document.getElementById("profile-form");
const message = document.querySelector("[data-message]");
const panels = [...form.querySelectorAll("[data-step]")];
const wizard = panels.length > 0;
let step = 0;
const labels = {
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
};
const field = (id) => document.getElementById(id);
const checkedEquipment = () =>
  [...form.querySelectorAll('[name="equipment"]:checked')].map(
    (input) => input.value,
  );
const equipmentText = (data) =>
  data.equipment
    .map((value) =>
      value === "outros" ? `Outros: ${data.otherEquipment}` : labels[value],
    )
    .join(", ");
const readProfile = () => ({
  goal: field("goal").value,
  experience: field("experience").value,
  days: Number(field("days").value),
  minutes: Number(field("minutes").value),
  location: field("location").value,
  equipment: checkedEquipment(),
  otherEquipment: field("otherEquipment").value,
  limitations: field("limitations").value,
  sensitiveConsent: field("sensitiveConsent").checked,
});
function conditionalFields() {
  const other = checkedEquipment().includes("outros");
  form.querySelector("[data-other-equipment]").hidden = !other;
  field("otherEquipment").required = other;
  if (!other) field("otherEquipment").value = "";
  const sensitive = Boolean(field("limitations").value.trim());
  form.querySelector("[data-sensitive-consent]").hidden = !sensitive;
  field("sensitiveConsent").required = sensitive;
  if (!sensitive) field("sensitiveConsent").checked = false;
  form
    .querySelector('[name="equipment"]')
    .setCustomValidity(
      checkedEquipment().length
        ? ""
        : "Selecione pelo menos um equipamento disponível.",
    );
}
function fill(data) {
  if (!data) {
    conditionalFields();
    return;
  }
  for (const id of [
    "goal",
    "experience",
    "days",
    "minutes",
    "location",
    "otherEquipment",
    "limitations",
  ])
    field(id).value = data[id];
  form.querySelectorAll('[name="equipment"]').forEach((input) => {
    input.checked = data.equipment.includes(input.value);
  });
  field("sensitiveConsent").checked = data.sensitiveConsent;
  conditionalFields();
}
function showStep(index, focus = true) {
  step = index;
  panels.forEach((panel, i) => {
    panel.hidden = i !== index;
  });
  field("step-label").textContent = `Etapa ${index + 1} de 3`;
  field("profile-progress").value = index + 1;
  document.querySelectorAll(".step-indicator li").forEach((item, i) => {
    if (i === index) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  document.querySelector("[data-previous]").hidden = index === 0;
  document.querySelector("[data-next]").hidden = index === 2;
  document.querySelector("[data-save]").hidden = index !== 2;
  if (index === 2) {
    const data = readProfile();
    document.querySelector("[data-review]").textContent =
      `${labels[data.goal]} · ${labels[data.experience]} · ${data.days} dias por semana · ${data.minutes} min por sessão · ${labels[data.location]}. Equipamentos: ${equipmentText(data)}.`;
  }
  if (focus) {
    const legend = panels[index].querySelector("legend");
    legend.tabIndex = -1;
    legend.focus();
  }
}
function valid(container) {
  conditionalFields();
  const invalid = [...container.querySelectorAll("input,select,textarea")].find(
    (input) => !input.checkValidity(),
  );
  if (invalid) {
    invalid.reportValidity();
    return false;
  }
  return true;
}
function summary(data, updatedAt) {
  const values = {
    goal: labels[data.goal],
    experience: labels[data.experience],
    availability: `${data.days} dias/semana · ${data.minutes} min/sessão`,
    location: labels[data.location],
    equipment: equipmentText(data),
    limitations: data.limitations || "Nenhuma limitação informada.",
  };
  document.querySelectorAll("[data-summary]").forEach((target) => {
    target.textContent = values[target.dataset.summary];
  });
  document.querySelector("[data-updated]").textContent =
    `Última atualização: ${new Date(updatedAt).toLocaleString("pt-BR")}`;
}
form.addEventListener("input", conditionalFields);
form.addEventListener("change", conditionalFields);
document.querySelector("[data-next]")?.addEventListener("click", () => {
  if (valid(panels[step])) showStep(step + 1);
});
document
  .querySelector("[data-previous]")
  ?.addEventListener("click", () => showStep(step - 1));
document
  .querySelector('a[href="#editar"]')
  ?.addEventListener("click", (event) => {
    event.preventDefault();
    const details = field("editar");
    details.open = true;
    details.querySelector("summary").focus();
  });
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (wizard) {
    for (let i = 0; i < panels.length; i++) {
      conditionalFields();
      if (
        [...panels[i].querySelectorAll("input,select,textarea")].some(
          (input) => !input.checkValidity(),
        )
      ) {
        showStep(i);
        valid(panels[i]);
        return;
      }
    }
  } else if (!valid(form)) return;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const result = await api("profile", { method: "PUT", body: readProfile() });
    if (wizard) location.replace("perfil.html");
    else {
      fill(result.profile);
      summary(result.profile, result.updatedAt);
      showMessage(
        message,
        "Preferências atualizadas. Suas alterações foram salvas.",
      );
    }
  } catch (error) {
    if (error.status === 401) location.replace("entrar.html");
    else showMessage(message, error.message, true);
  } finally {
    button.disabled = false;
  }
});
const deleteForm = field("delete-form");
deleteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = deleteForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api("account", {
      method: "DELETE",
      body: {
        password: field("deletePassword").value,
        confirmation: field("confirmation").value,
      },
    });
    form.reset();
    deleteForm.reset();
    location.replace("entrar.html");
  } catch (error) {
    showMessage(
      document.querySelector("[data-delete-message]"),
      error.message,
      true,
    );
  } finally {
    button.disabled = false;
  }
});
try {
  const [{ user }, { profile, updatedAt }] = await Promise.all([
    api("session"),
    api("profile"),
  ]);
  if (!wizard && !profile) location.replace("configurar-perfil.html");
  else {
    fill(profile);
    if (wizard) showStep(0, false);
    else {
      document.querySelector("[data-user-name]").textContent = user.name;
      document.querySelector("[data-user-email]").textContent = user.email;
      document.querySelector("[data-user-created]").textContent = new Date(
        user.createdAt,
      ).toLocaleDateString("pt-BR");
      summary(profile, updatedAt);
    }
    document.querySelector("[data-private-content]").hidden = false;
    document.querySelector("[data-loading]").hidden = true;
  }
} catch (error) {
  if (error.status === 401) location.replace("entrar.html");
  else document.querySelector("[data-loading]").textContent = error.message;
}
