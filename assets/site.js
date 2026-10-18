import { api, destination, showMessage } from "./api.js";

const menuButton = document.querySelector(".nav-toggle");
const menu = document.getElementById("menu");
menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(open));
  menu.classList.toggle("is-open", open);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu?.classList.contains("is-open")) {
    menu.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.focus();
  }
});

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  const field = document.getElementById(button.dataset.togglePassword);
  button.addEventListener("click", () => {
    const visible = field.type === "password";
    field.type = visible ? "text" : "password";
    button.textContent = visible ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-pressed", String(visible));
    const label = document
      .querySelector(`label[for="${field.id}"]`)
      .textContent.toLowerCase();
    button.setAttribute(
      "aria-label",
      `${visible ? "Ocultar" : "Mostrar"} ${label}`,
    );
  });
});

document.querySelectorAll("[data-logout]").forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api("logout", { method: "POST", body: {} });
      document.querySelector("#profile-form")?.reset();
      location.replace("entrar.html");
    } catch (error) {
      const target = document.querySelector("[data-message]");
      if (target) showMessage(target, error.message, true);
      button.disabled = false;
    }
  });
});

// Revalidate private data if a browser restores a previous page from its history cache.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
api("session")
  .then(({ user }) => {
    if (!user) return;
    document.querySelectorAll("[data-account-link]").forEach((link) => {
      if (link.closest(".actions")) {
        link.hidden = true;
        return;
      }
      link.textContent = "Meu perfil";
      link.href = destination(user);
    });
    document.querySelectorAll("[data-signup-link]").forEach((link) => {
      link.textContent = "Meu perfil";
      link.href = destination(user);
    });
  })
  .catch(() => {});
