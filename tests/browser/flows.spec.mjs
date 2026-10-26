import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createTestApp as createApp } from "../helpers/app.mjs";

const consoleErrors = new WeakMap();
const auditing = new WeakMap();
test.beforeEach(async ({ page }) => {
  consoleErrors.set(page, []);
  page.on("console", (message) => {
    // Axe introspects remote CSS using fetch. The application's CSP correctly
    // blocks that probe; the actual font stylesheet loads through style-src.
    // Exclude only this instrumentation message while an axe scan is running.
    if (auditing.get(page) && message.text().includes("https://fonts.googleapis.com/") && message.text().includes("connect-src 'self'")) return;
    if (
      message.type() === "error" &&
      !message.text().includes("401 (Unauthorized)")
    )
      consoleErrors.get(page).push(message.text());
  });
});
test.afterEach(async ({ page }) => {
  expect(consoleErrors.get(page)).toEqual([]);
});

const password = "Uma frase de senha para testar 2026!";
const pages = [
  "/",
  "/entrar.html",
  "/cadastro.html",
  "/recuperar-senha.html",
  "/redefinir-senha.html",
  "/como-funciona.html",
  "/recursos.html",
  "/recursoso.html",
  "/termos.html",
  "/privacidade.html",
  "/contato.html",
];
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
async function accessible(page) {
  auditing.set(page, true);
  let result;
  try { result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze(); }
  finally { auditing.set(page, false); }
  expect(result.violations).toEqual([]);
}

test("Navegação, tema, formulários e acessibilidade das páginas públicas", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const url of pages) {
    const response = await page.goto(url);
    expect(response.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe("rgb(239, 243, 249)");
    await noOverflow(page);
    await accessible(page);
  }
  await page.goto("/cadastro.html");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  expect(
    await page.locator("#name").evaluate((el) => el.validity.valueMissing),
  ).toBe(true);
  await page.locator("#name").fill("Pessoa de teste");
  await page.locator("#email").fill("invalido");
  expect(
    await page.locator("#email").evaluate((el) => el.validity.typeMismatch),
  ).toBe(true);
  await page.locator("#password").fill(password);
  await page
    .getByRole("button", { name: "Mostrar senha", exact: true })
    .click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await page
    .getByRole("button", { name: "Ocultar senha", exact: true })
    .click();
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
  await page.goto("/cadastro.html");
  await page.screenshot({
    path: `test-results/cadastro-${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/");
  if (info.project.name === "celular") {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.locator("#menu")).toBeVisible();
    await page
      .locator("#menu")
      .getByRole("link", { name: "Recursos", exact: true })
      .click();
    await expect(page).toHaveURL(/recursos.html$/);
  }
  await page.goto("/");
  await page.screenshot({
    path: `test-results/inicio-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Recuperação completa no navegador com entrega capturada apenas no teste", async ({
  page,
  context,
}) => {
  const origin = "http://localhost:3103";
  const inbox = [];
  const app = await createApp({
    origin,
    databasePath: ":memory:",
    encryptionKey: randomBytes(32).toString("hex"),
    sendRecovery: async (mail) => {
      inbox.push(mail);
    },
  });
  await new Promise((resolve) => app.server.listen(3103, "127.0.0.1", resolve));
  try {
    const result = await page.request.post(`${origin}/api/register`, {
      headers: { Origin: origin, "X-GymIA-Request": "1" },
      data: {
        name: "Recuperação Teste",
        email: "recuperacao@example.com",
        password,
        confirmPassword: password,
        acceptTerms: true,
      },
    });
    expect(result.status()).toBe(201);
    await context.clearCookies();
    await page.goto(`${origin}/recuperar-senha.html`);
    await expect(
      page.getByRole("button", { name: "Enviar link de recuperação" }),
    ).toBeEnabled();
    await page.locator("#email").fill("recuperacao@example.com");
    await page
      .getByRole("button", { name: "Enviar link de recuperação" })
      .click();
    await expect(page.locator("[data-message]")).toContainText(
      "Se houver uma conta",
    );
    await expect.poll(() => inbox.length).toBe(1);
    await page.goto(inbox[0].url);
    expect(new URL(page.url()).hash).toBe("");
    await page
      .locator("#password")
      .fill("Uma nova frase de senha válida 2026!");
    await page
      .locator("#confirmPassword")
      .fill("Uma nova frase de senha válida 2026!");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.locator("[data-message]")).toHaveText(
      "Senha atualizada. Entre novamente com a nova senha.",
    );
    await page
      .getByRole("link", { name: "Entrar", exact: true })
      .last()
      .click();
    await page.locator("#email").fill("recuperacao@example.com");
    await page
      .locator("#password")
      .fill("Uma nova frase de senha válida 2026!");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/configurar-perfil.html$/);
  } finally {
    await context.clearCookies();
    await page.goto("about:blank");
    await app.close();
  }
});

test("Sem JavaScript, formulários não enviam senhas na URL", async ({
  browser,
}) => {
  const isolated = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await isolated.newPage();
    await page.goto("http://localhost:3100/cadastro.html");
    await page.locator("#name").fill("Sem JavaScript");
    await page.locator("#email").fill("nojs@example.com");
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.locator("#acceptTerms").check();
    const navigation = page.waitForRequest(
      (request) => request.isNavigationRequest() && request.method() === "POST",
    );
    await page
      .getByRole("button", { name: "Criar conta", exact: true })
      .click();
    const request = await navigation;
    expect(new URL(request.url()).search).toBe("");
    expect(request.method()).toBe("POST");
  } finally {
    await isolated.close();
  }
});

test("Cadastro, etapas, persistência, edição, login, privacidade e exclusão", async ({
  page,
  context,
  browser,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = `fluxo-${info.project.name}@example.com`;
  await page.goto("/perfil.html");
  await expect(page).toHaveURL(/entrar.html$/);
  await page
    .getByRole("link", { name: "Criar conta", exact: true })
    .last()
    .click();
  await page.locator("#name").fill("Pessoa de Teste");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#confirmPassword").fill("Diferente e comprida 123");
  await page.locator("#acceptTerms").check();
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  expect(
    await page
      .locator("#confirmPassword")
      .evaluate((el) => el.validity.customError),
  ).toBe(true);
  await page.locator("#confirmPassword").fill(password);
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(page).toHaveURL(/configurar-perfil.html$/);
  await expect(page.locator("[data-private-content]")).toBeVisible();
  await accessible(page);
  await noOverflow(page);
  await page.getByRole("button", { name: "Avançar" }).click();
  await expect(page.locator("#step-label")).toHaveText("Etapa 1 de 3");
  await page.locator("#goal").selectOption("hipertrofia");
  await page.locator("#experience").selectOption("iniciante");
  await page.getByRole("button", { name: "Avançar" }).click();
  await page.locator("#days").selectOption("3");
  await page.locator("#minutes").selectOption("45");
  await page.locator("#location").selectOption("casa");
  await page.getByRole("button", { name: "Avançar" }).click();
  await expect(page.locator("#step-label")).toHaveText("Etapa 2 de 3");
  await page.getByRole("checkbox", { name: "Halteres", exact: true }).check();
  await page.getByRole("checkbox", { name: "Outros", exact: true }).check();
  await page.getByRole("button", { name: "Avançar" }).click();
  await expect(page.locator("#step-label")).toHaveText("Etapa 2 de 3");
  await page.locator("#otherEquipment").fill("Banco ajustável");
  await page.getByRole("button", { name: "Avançar" }).click();
  await page.locator("#limitations").fill("Restrição privada de teste");
  await page.getByRole("button", { name: "Salvar meu perfil" }).click();
  await expect(page.locator("#step-label")).toHaveText("Etapa 3 de 3");
  await page.locator("#sensitiveConsent").check();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(page.locator("#days")).toHaveValue("3");
  await page.getByRole("button", { name: "Avançar" }).click();
  await page.getByRole("button", { name: "Salvar meu perfil" }).click();
  await expect(page).toHaveURL(/perfil.html$/);
  await expect(page.locator('[data-summary="goal"]')).toHaveText("Hipertrofia");
  await accessible(page);
  await noOverflow(page);
  await page.screenshot({
    path: `test-results/perfil-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "gymia_session",
  );
  const cookie = (await context.cookies()).find(
    (item) => item.name === "gymia_session",
  );
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Strict");
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto("http://localhost:3100/perfil.html");
  await expect(guestPage).toHaveURL(/entrar.html$/);
  await guest.close();
  await page
    .getByRole("link", { name: "Editar preferências", exact: true })
    .click();
  await page.locator("#goal").selectOption("forca");
  await page.locator("#days").selectOption("4");
  await page.locator("#limitations").fill("");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.locator("[data-message]")).toContainText(
    "Preferências atualizadas",
  );
  await page.reload();
  await expect(page.locator('[data-summary="goal"]')).toHaveText("Força");
  await expect(page.locator('[data-summary="availability"]')).toContainText(
    "4 dias",
  );
  await page.locator(".sensitive-details summary").click();
  await expect(page.locator('[data-summary="limitations"]')).toHaveText(
    "Nenhuma limitação informada.",
  );
  await page
    .getByRole("button", { name: "Sair da conta", exact: true })
    .click();
  await expect(page).toHaveURL(/entrar.html$/);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("Senha errada");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("[data-message]")).toHaveText(
    "E-mail ou senha incorretos.",
  );
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/perfil.html$/);
  await page.locator(".delete-card summary").click();
  await page.locator("#deletePassword").fill("Senha errada");
  await page.locator("#confirmation").fill("EXCLUIR");
  await page.getByRole("button", { name: "Excluir conta e dados" }).click();
  await expect(page.locator("[data-delete-message]")).toContainText(
    "Senha incorreta",
  );
  await page.locator("#deletePassword").fill(password);
  await page.getByRole("button", { name: "Excluir conta e dados" }).click();
  await expect(page).toHaveURL(/entrar.html$/);
  expect(errors).toEqual([]);
});

test("Recuperação indisponível é explícita; link inválido não envia formulário", async ({
  page,
}) => {
  await page.goto("/recuperar-senha.html");
  await expect(page.locator("[data-recovery-note]")).toContainText(
    "ainda não foi configurado",
  );
  await expect(
    page.getByRole("button", { name: "Enviar link de recuperação" }),
  ).toBeDisabled();
  await page.goto("/redefinir-senha.html#token=invalido");
  await expect(page.locator("[data-message]")).toContainText("Link inválido");
  await expect(
    page.getByRole("button", { name: "Salvar nova senha" }),
  ).toBeDisabled();
  expect(new URL(page.url()).hash).toBe("");
});

test("Todos os links locais, arquivos e âncoras existem; largura mínima de 320px", async ({
  page,
}) => {
  for (const file of (await readdir(".")).filter((name) =>
    name.endsWith(".html"),
  )) {
    const html = await readFile(file, "utf8");
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = match[1];
      if (target.startsWith("http")) continue;
      const [path, anchor] = target.split("#");
      const destination = path || file;
      const content = await readFile(resolve(destination), "utf8");
      if (anchor)
        expect(content.includes(`id="${anchor}"`), `${file} -> ${target}`).toBe(
          true,
        );
    }
  }
  await page.setViewportSize({ width: 320, height: 780 });
  for (const url of pages) {
    await page.goto(url);
    await noOverflow(page);
  }
});
