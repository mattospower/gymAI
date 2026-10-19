import { api, showMessage, checkPasswords, destination } from "./api.js";

const form = document.querySelector("[data-auth]");
const kind = form.dataset.auth;
const message = document.querySelector("[data-message]");
const submit = form.querySelector('[type="submit"]');
let resetToken = "";
if (kind === "reset") {
  resetToken = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  history.replaceState(null, "", location.pathname);
  if (!/^[a-f0-9]{64}$/.test(resetToken)) {
    showMessage(
      message,
      "Link inválido ou ausente. Solicite um novo link de recuperação.",
      true,
    );
    submit.disabled = true;
  }
}
if (kind === "recover") {
  const note = document.querySelector("[data-recovery-note]");
  api("config")
    .then((config) => {
      submit.disabled = !config.passwordRecoveryAvailable;
      note.textContent = config.passwordRecoveryAvailable
        ? "O link é válido por 30 minutos. Por segurança, a resposta não confirma a existência de uma conta."
        : "O envio de e-mail ainda não foi configurado pelo responsável desta instalação. A recuperação está indisponível.";
    })
    .catch((error) => {
      note.textContent = error.message;
    });
}
if (["register", "login"].includes(kind)) {
  api("session")
    .then(({ user }) => {
      if (user) location.replace(destination(user));
    })
    .catch(() => {});
}
form.querySelectorAll("input").forEach((input) =>
  input.addEventListener("input", () => {
    form.querySelector("#confirmPassword")?.setCustomValidity("");
  }),
);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!checkPasswords(form)) return;
  submit.disabled = true;
  message.hidden = true;
  const fields = Object.fromEntries(new FormData(form));
  const payload =
    kind === "register"
      ? {
          ...fields,
          acceptTerms: document.getElementById("acceptTerms").checked,
        }
      : kind === "reset"
        ? { ...fields, token: resetToken }
        : fields;
  try {
    const result = await api(kind, { method: "POST", body: payload });
    form.reset();
    if (result.user) location.replace(destination(result.user));
    else {
      showMessage(message, result.message);
      if (kind === "reset") {
        resetToken = "";
        form.hidden = true;
      }
    }
  } catch (error) {
    showMessage(message, error.message, true);
  } finally {
    submit.disabled = false;
  }
});
