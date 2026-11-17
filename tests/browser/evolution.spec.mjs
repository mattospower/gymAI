import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createTestApp as createApp } from "../helpers/app.mjs";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("Etapa 3: calendário, gráficos, demonstração, revisão, exportação e acessibilidade", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180000);
  const parent = resolve("test-results");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, "browser-evolution-"));
  const origin = "http://localhost:3111";
  const app = await createApp({
    origin,
    databasePath: resolve(directory, "gymia.sqlite"),
    encryptionKey: randomBytes(32).toString("hex"),
  });
  await new Promise((r) => app.server.listen(3111, "127.0.0.1", r));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const headers = { Origin: origin, "X-GymIA-Request": "1" };
  const post = (path, data) =>
    page.request.post(origin + "/api/" + path, { headers, data });
  const put = (path, data) =>
    page.request.put(origin + "/api/" + path, { headers, data });
  const get = async (path) =>
    (await page.request.get(origin + "/api/" + path)).json();
  const go = async (path) => {
    await page.goto(origin + "/" + path);
    await expect(
      page.locator("#evolution-content, #training-content"),
    ).toBeVisible();
  };
  const accessible = async () =>
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  const layout = async () => {
    expect(
      await page.locator("main").evaluate((main) => {
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        let current;
        while ((current = walker.nextNode()))
          if (current.textContent.trim() === "null") return true;
        return false;
      }),
    ).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const boxes = await page.locator(".field:visible").evaluateAll((fields) =>
      fields.map((f) => {
        const control = f.querySelector("input,select,textarea"),
          label = f.querySelector("label");
        return {
          f: f.getBoundingClientRect().toJSON(),
          c: control.getBoundingClientRect().toJSON(),
          l: label.getBoundingClientRect().toJSON(),
        };
      }),
    );
    for (const { f, c, l } of boxes) {
      expect(c.left).toBeGreaterThanOrEqual(f.left - 1);
      expect(c.right).toBeLessThanOrEqual(f.right + 1);
      expect(c.top - l.bottom).toBeGreaterThanOrEqual(7);
    }
    const theme = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return ["--blue", "--cta-bg", "--bg", "--surface", "--ink"].map((p) =>
        s.getPropertyValue(p).trim(),
      );
    });
    expect(theme).toEqual([
      "#1541D6",
      "#1F5BFF",
      "#EFF3F9",
      "#FBFCFE",
      "#050F26",
    ]);
    expect(
      await page
        .locator("body")
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("DM Sans");
    expect(
      await page.locator("h1").evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Archivo");
    expect(
      await page
        .locator(".eyebrow")
        .first()
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("JetBrains Mono");
  };
  try {
    const password = "Uma frase segura para navegador Etapa3!";
    expect(
      (
        await post("register", {
          name: "Conta de demonstração dos testes",
          email: `etapa3-${info.project.name}@example.com`,
          password,
          confirmPassword: password,
          acceptTerms: true,
        })
      ).status(),
    ).toBe(201);
    await put("profile", {
      goal: "forca",
      experience: "iniciante",
      days: 3,
      minutes: 45,
      location: "casa",
      equipment: ["peso-corporal"],
      otherEquipment: "",
      limitations: "",
      sensitiveConsent: false,
    });
    await go("calendario.html");
    await expect(page.getByText("Crie um plano primeiro")).toBeVisible();
    const [year, month] = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    })
      .format(new Date())
      .split("-")
      .map(Number);
    const nextMonthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    await page.getByRole("button", { name: "Próximo", exact: true }).click();
    await expect(page.locator("#calendar-grid button")).toHaveCount(
      nextMonthDays,
    );
    let plan = (
      await (
        await post("plans", {
          name: "Rotina de teste",
          goal: "forca",
          description: "Organização manual",
          sessions: [
            {
              name: "Sessão A",
              day: "Segunda",
              exercises: [
                {
                  exerciseId: "agachamento",
                  sets: 1,
                  mode: "reps",
                  target: 8,
                  rest: 60,
                  notes: "",
                },
              ],
            },
          ],
        })
      ).json()
    ).plan;
    plan = (
      await (
        await post(`plans/${plan.id}/activate`, { version: plan.version })
      ).json()
    ).plan;
    let w = (
      await (
        await post("workouts", {
          planId: plan.id,
          sessionId: plan.sessions[0].id,
        })
      ).json()
    ).workout;
    w.records[0].sets[0] = { completed: true, value: 8, load: 12.5 };
    w = (
      await (await put(`workouts/${w.id}`, { ...w, status: "partial" })).json()
    ).workout;
    await go("calendario.html");
    const today = await page.locator("#schedule-date").inputValue();
    await page
      .getByRole("button", { name: "Salvar data", exact: true })
      .click();
    await expect(page.locator("[data-message]")).toContainText("Data salva");
    await expect(page.locator("#day-events")).toContainText("Planejada");
    await expect(page.locator("#day-events")).toContainText("Parcial");
    await page
      .getByRole("button", { name: "Alterar data", exact: true })
      .click();
    const tomorrow = new Date(Date.parse(today) + 86400000)
      .toISOString()
      .slice(0, 10);
    await page.locator("#schedule-date").fill(tomorrow);
    await page
      .getByRole("button", { name: "Salvar data", exact: true })
      .click();
    await expect(page.locator("#schedule-date")).toHaveValue(tomorrow);
    await page.getByLabel("Visualização", { exact: true }).selectOption("week");
    await expect(page.locator("#calendar-grid button")).toHaveCount(7);
    await page
      .getByLabel("Visualização", { exact: true })
      .selectOption("month");
    await go("evolucao.html");
    await expect(page.locator("#statistics-result")).toContainText(
      "1 parciais",
    );
    await page
      .getByLabel("Exercício", { exact: true })
      .selectOption("agachamento");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(
      page.getByRole("progressbar", { name: /carga máxima 12.5 kg/ }),
    ).toBeVisible();
    await page.getByLabel("Estado das sessões").selectOption("completed");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(page.locator("#statistics-result")).toContainText(
      "Nenhuma sessão encerrada",
    );
    await go("configuracoes.html");
    await page.getByLabel("Autorizo enviar minhas solicitações").check();
    await page.getByLabel("Autorizo usar objetivo").check();
    await page.getByRole("button", { name: "Salvar configurações" }).click();
    await expect(page.locator("[data-message]")).toContainText(
      "Configurações salvas",
    );
    await page.reload();
    await expect(page.getByLabel("Autorizo usar objetivo")).toBeChecked();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar meus dados" }).click();
    const file = await download;
    const json = JSON.parse(readFileSync(await file.path(), "utf8"));
    expect(json.workouts).toHaveLength(1);
    expect(json.calendar).toHaveLength(1);
    expect(json.account.email).toContain("@example.com");
    expect(JSON.stringify(json)).not.toContain("password_hash");
    await go("assistente.html");
    await expect(
      page.getByText("DEMONSTRAÇÃO LOCAL · sem IA generativa"),
    ).toBeVisible();
    await page
      .getByLabel("Mensagem (até 2000 caracteres)")
      .fill("Como registro uma sessão?");
    await page
      .getByRole("button", { name: "Testar demonstração local" })
      .click();
    await expect(page.locator("#assistant-answer")).toContainText(
      "texto é fixo",
    );
    await page.getByLabel("Tipo de solicitação").selectOption("draft");
    await page
      .getByLabel("Usar minhas preferências do perfil nesta solicitação")
      .check();
    await page
      .getByRole("button", { name: "Testar demonstração local" })
      .click();
    await expect(page.locator("#assistant-answer")).toContainText(
      "Demonstração local",
    );
    expect((await get("plans")).plans).toHaveLength(1);
    await page.getByRole("link", { name: "Revisar e editar rascunho" }).click();
    await expect(page.locator("#plan-name")).toHaveValue(
      "Exemplo demonstrativo — revisar",
    );
    await page
      .locator("#plan-name")
      .fill("Rascunho revisado <img src=x onerror=alert(1)>");
    await page
      .getByRole("button", { name: "Duplicar sessão", exact: true })
      .click();
    await expect(page.locator(".planned-session")).toHaveCount(2);
    await page.getByLabel("Revisei os exercícios e valores").check();
    await page
      .getByRole("button", { name: "Salvar plano", exact: true })
      .click();
    await expect(page).toHaveURL(/treinos.html$/);
    const plans = (await get("plans")).plans;
    expect(plans).toHaveLength(2);
    expect(plans.find((p) => p.name.startsWith("Rascunho")).status).toBe(
      "saved",
    );
    expect(plans.find((p) => p.id === plan.id).status).toBe("active");
    await expect(page.locator("#plan-list img")).toHaveCount(0);
    const reviewed = plans.find((p) => p.name.startsWith("Rascunho"));
    expect(
      (
        await put(`plans/${reviewed.id}`, {
          ...reviewed,
          name: "Rascunho revisado",
        })
      ).status(),
    ).toBe(200);
    const pages = [
      "treinos.html",
      "calendario.html",
      "evolucao.html",
      "assistente.html",
      "configuracoes.html",
      "exercicios.html",
    ];
    for (const route of pages) {
      await go(route);
      await accessible();
      for (const width of [1440, 1280, 1024, 901, 900, 768, 560, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await layout();
      }
      await page.setViewportSize({
        width: info.project.name === "desktop" ? 1440 : 390,
        height: 1000,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await page.screenshot({
        path: `test-results/etapa3-${route.replace(".html", "")}-${info.project.name}.png`,
        fullPage: true,
      });
    }
    await go("assistente.html");
    await page.getByLabel("Tipo de solicitação").selectOption("draft");
    await accessible();
    for (const width of [320, 560, 900, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await layout();
    }
    await page.getByLabel("Tipo de solicitação").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#assistant-message")).toBeFocused();
    await go(`historico.html?id=${w.id}`);
    await expect(page.locator("#history-list details")).toHaveAttribute(
      "open",
      "",
    );
    await expect(page.locator("#history-list")).toContainText("12.5 kg");
    await go("calendario.html");
    const event = (await get(`calendar?from=${today}&to=${tomorrow}`))
      .events[0];
    await page.locator(`[data-date="${event.date}"]`).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Cancelar data" }).click();
    await expect(page.locator("#day-events")).not.toContainText("Planejada");
    expect((await get("workouts")).workouts).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await context.clearCookies();
    await app.close();
  }
});
