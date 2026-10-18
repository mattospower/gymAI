export async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "X-GymIA-Request": "1",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "O servidor do gymAI não está disponível. Abra o site pela instalação configurada.",
    );
  }
  if (!response.ok) {
    const error = new Error(
      data.message || "Não foi possível concluir. Tente novamente.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

export function showMessage(element, text, error = false) {
  element.textContent = text;
  element.dataset.error = String(error);
  element.hidden = false;
  element.focus();
}

export function checkPasswords(form) {
  const first = form.querySelector("#password");
  const confirm = form.querySelector("#confirmPassword");
  if (confirm)
    confirm.setCustomValidity(
      first.value === confirm.value ? "" : "As senhas precisam ser iguais.",
    );
  return form.reportValidity();
}

export const destination = (user) =>
  user.hasProfile ? "perfil.html" : "configurar-perfil.html";
