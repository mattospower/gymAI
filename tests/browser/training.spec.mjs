import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createApp } from "../../server/app.mjs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";

test("Planos manuais, execução parcial, histórico e layouts da Etapa 2", async ({
  page,
  context,
}, info) => {
  test.setTimeout(120000);
  const origin = "http://localhost:3106",
    parent = resolve("test-results");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, "browser-training-"));
  const app = createApp({
    origin,
    databasePath: resolve(directory, "gymia.sqlite"),
    encryptionKey: randomBytes(32).toString("hex"),
  });
  await new Promise((resolve) => app.server.listen(3106, "127.0.0.1", resolve));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const headers = { Origin: origin, "X-GymIA-Request": "1" };
  const post = (path, data) =>
    page.request.post(origin + path, { headers, data });
  const put = (path, data) =>
    page.request.put(origin + path, { headers, data });
  const go = async (path) => {
    await page.goto(origin + "/" + path);
    await expect(page.locator("#training-content")).toBeVisible();
  };
  const accept = () => page.once("dialog", (dialog) => dialog.accept());
  const card = (name) =>
    page
      .locator(".plan-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  const exercise = (name) =>
    page
      .locator(".planned-exercise")
      .filter({ has: page.getByRole("heading", { name: new RegExp(name) }) });
  async function add(name) {
    await page
      .getByRole("button", { name: "Adicionar exercício", exact: true })
      .first()
      .click();
    await page.locator("#picker-library-search").fill(name);
    await page
      .getByRole("button", { name: `Adicionar ${name}`, exact: true })
      .click();
  }
  async function values(name, sets, target, seconds = false) {
    const item = exercise(name);
    await item
      .getByLabel("Número de séries", { exact: true })
      .fill(String(sets));
    if (seconds)
      await item.getByLabel("Medida", { exact: true }).selectOption("seconds");
    await item
      .getByLabel(
        seconds ? "Duração por série (segundos)" : "Repetições por série",
        { exact: true },
      )
      .fill(String(target));
    await item.getByLabel("Descanso (segundos)", { exact: true }).fill("60");
  }
  async function layout() {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const fields = await page.locator(".field:visible").evaluateAll((fields) =>
      fields
        .map((f) => {
          const c = f.querySelector("input,select,textarea");
          return c
            ? {
                field: f.getBoundingClientRect().toJSON(),
                control: c.getBoundingClientRect().toJSON(),
              }
            : null;
        })
        .filter(Boolean),
    );
    for (const { field, control } of fields) {
      expect(control.left).toBeGreaterThanOrEqual(field.left - 1);
      expect(control.right).toBeLessThanOrEqual(field.right + 1);
    }
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe("rgb(239, 243, 249)");
  }
  async function accessible() {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  }
  try {
    const password = "Uma frase longa de teste da Etapa 2!";
    expect(
      (
        await post("/api/register", {
          name: "Treinos de teste",
          email: `treinos-${info.project.name}@example.com`,
          password,
          confirmPassword: password,
          acceptTerms: true,
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await put("/api/profile", {
          goal: "forca",
          experience: "iniciante",
          days: 3,
          minutes: 45,
          location: "casa",
          equipment: ["peso-corporal", "halteres"],
          otherEquipment: "",
          limitations: "",
          sensitiveConsent: false,
        })
      ).status(),
    ).toBe(200);
    await go("treinos.html");
    await expect(page.locator("#plan-list")).toContainText(
      "Você ainda não cadastrou planos",
    );
    await expect(page.locator("#profile-context")).toContainText("Força");
    await page
      .getByRole("link", { name: "Criar novo plano", exact: true })
      .click();
    await expect(page.locator("#plan-goal")).toHaveValue("forca");
    const name = `Plano manual ${info.project.name}`;
    await page.locator("#plan-name").fill(name);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page
      .locator(".training-tabs")
      .getByRole("link", { name: "Meus treinos", exact: true })
      .click();
    await expect(page).toHaveURL(/plano.html$/);
    await expect(page.locator("#plan-name")).toHaveValue(name);
    await page.getByLabel("Nome da sessão", { exact: true }).fill("Treino A");
    await page
      .getByLabel("Dia ou organização (opcional)")
      .fill("Segunda-feira");
    await add("Agachamento com peso corporal");
    await expect(
      exercise("Agachamento").getByLabel("Número de séries"),
    ).toHaveValue("");
    await values("Agachamento", 2, 8);
    await add("Prancha frontal");
    await values("Prancha", 2, 30, true);
    await page
      .getByRole("button", { name: "Subir Prancha frontal", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".planned-exercise").first()).toContainText(
      "Prancha frontal",
    );
    await add("Flexão de braços");
    await values("Flexão", 1, 8);
    accept();
    await page
      .getByRole("button", { name: "Remover Flexão de braços", exact: true })
      .click();
    await expect(page.locator(".planned-exercise")).toHaveCount(2);
    await accessible();
    await layout();
    await page
      .getByRole("button", { name: "Salvar plano", exact: true })
      .click();
    await expect(page).toHaveURL(/treinos.html$/);
    await expect(card(name)).toContainText("2 exercício(s)");
    await card(name).getByRole("link", { name: "Ver / editar plano" }).click();
    await page.locator("#plan-description").fill("Plano definido manualmente");
    await page
      .getByRole("button", { name: "Salvar plano", exact: true })
      .click();
    await expect(card(name)).toContainText("Plano definido manualmente");
    await card(name)
      .getByRole("button", { name: "Duplicar", exact: true })
      .click();
    const copied = name + " (cópia)";
    await expect(card(copied)).toBeVisible();
    await card(copied)
      .getByRole("button", { name: "Arquivar", exact: true })
      .click();
    await expect(card(copied).locator(".tag")).toHaveText("Arquivado");
    await card(copied)
      .getByRole("button", { name: "Reativar", exact: true })
      .click();
    await expect(card(copied).locator(".tag")).toHaveText("Salvo");
    await card(name)
      .getByRole("button", { name: "Definir como ativo", exact: true })
      .click();
    await expect(card(name).locator(".tag")).toHaveText("Ativo");
    await card(copied)
      .getByRole("button", { name: "Definir como ativo", exact: true })
      .click();
    await expect(card(name).locator(".tag")).toHaveText("Salvo");
    await card(name)
      .getByRole("button", { name: "Iniciar Treino A", exact: true })
      .click();
    await expect(page).toHaveURL(/sessao-treino.html\?id=/);
    await page
      .getByLabel("Duração realizada (s)", { exact: true })
      .first()
      .fill("22");
    await page.getByLabel("Concluída", { exact: true }).first().check();
    await page
      .locator("#workout-notes")
      .fill("Registro real <img src=x onerror=alert(1)>");
    await expect(page.locator("#workout-save-state")).toHaveText(
      "Registro salvo no servidor.",
    );
    await page.reload();
    await expect(
      page.getByLabel("Duração realizada (s)", { exact: true }).first(),
    ).toHaveValue("22");
    await expect(
      page.getByLabel("Concluída", { exact: true }).first(),
    ).toBeChecked();
    await accessible();
    accept();
    await page
      .getByRole("button", {
        name: "Interromper e salvar parcial",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/historico.html$/);
    await expect(page.locator("#history-list .tag")).toHaveText("Parcial");
    await page.getByText("Ver exercícios e registros", { exact: true }).click();
    await expect(page.locator("#history-list")).toContainText("22 s");
    await expect(page.locator("#history-list img")).toHaveCount(0);
    await page.locator("#history-from").fill("2099-01-01");
    await page
      .getByRole("button", { name: "Filtrar histórico", exact: true })
      .click();
    await expect(page.locator("#history-list")).toContainText(
      "Nenhum registro",
    );
    await page.locator("#history-from").fill("");
    await page
      .getByRole("button", { name: "Filtrar histórico", exact: true })
      .click();
    await expect(page.locator("#history-list article")).toHaveCount(1);
    await go("treinos.html");
    await card(name)
      .getByRole("button", { name: "Iniciar Treino A", exact: true })
      .click();
    await page
      .getByLabel("Repetições realizadas", { exact: true })
      .first()
      .fill("6");
    await page
      .getByLabel("Carga (kg, opcional)", { exact: true })
      .nth(2)
      .fill("12.5");
    accept();
    await page
      .getByRole("button", { name: "Finalizar sessão", exact: true })
      .click();
    await expect(page).toHaveURL(/historico.html$/);
    await expect(page.locator("#history-list article")).toHaveCount(2);
    await go("treinos.html");
    page.once("dialog", (dialog) => dialog.accept("EXCLUIR"));
    await card(name)
      .getByRole("button", { name: "Excluir plano", exact: true })
      .click();
    await expect(card(name)).toHaveCount(0);
    await go("historico.html");
    await page.locator("#history-plan").selectOption({ label: name });
    await page
      .getByRole("button", { name: "Filtrar histórico", exact: true })
      .click();
    await expect(page.locator("#history-list article")).toHaveCount(2);
    await go("exercicios.html");
    await page
      .getByLabel("Equipamento", { exact: true })
      .selectOption("elasticos");
    await expect(page.locator(".exercise-card")).toHaveCount(2);
    await page.getByLabel("Equipamento", { exact: true }).selectOption("");
    await page.getByLabel("Categoria", { exact: true }).selectOption("Agachar");
    await expect(page.locator(".exercise-card")).toHaveCount(2);
    await page.getByLabel("Categoria", { exact: true }).selectOption("");
    await page
      .getByLabel("Usar equipamentos do meu perfil (inclui peso corporal)", {
        exact: true,
      })
      .check();
    await expect(page.locator(".exercise-card")).toHaveCount(9);
    const plans = (await (await page.request.get(origin + "/api/plans")).json())
      .plans;
    const remaining = plans.find((p) => p.name === copied);
    const running = (
      await (
        await post("/api/workouts", {
          planId: remaining.id,
          sessionId: remaining.sessions[0].id,
        })
      ).json()
    ).workout;
    const routes = [
      "treinos.html",
      `plano.html?id=${remaining.id}`,
      "exercicios.html",
      "historico.html",
      `sessao-treino.html?id=${running.id}`,
    ];
    for (const route of routes) {
      await go(route);
      await accessible();
      for (const width of [1440, 1024, 901, 768, 560, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await layout();
      }
    }
    await go(`plano.html?id=${remaining.id}`);
    await page
      .getByRole("button", { name: "Adicionar exercício", exact: true })
      .click();
    await layout();
    await accessible();
    await page
      .getByRole("button", { name: "Fechar biblioteca", exact: true })
      .click();
    await page.setViewportSize({
      width: info.project.name === "desktop" ? 1440 : 390,
      height: 1000,
    });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: `test-results/etapa2-plano-${info.project.name}.png`,
      fullPage: true,
    });
    await go("treinos.html");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: `test-results/etapa2-treinos-${info.project.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await context.clearCookies();
    await app.close();
  }
});
