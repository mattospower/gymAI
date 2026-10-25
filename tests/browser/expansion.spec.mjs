import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createApp } from "../../server/app.mjs";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("Etapa 4: modelos, conflitos, recorrência, vínculos, relatórios e impressão", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180000);
  const parent = resolve("test-results");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, "browser-expansion-"));
  const origin = "http://localhost:3113",
    app = createApp({
      origin,
      databasePath: resolve(directory, "db.sqlite"),
      encryptionKey: randomBytes(32).toString("hex"),
    });
  await new Promise((r) => app.server.listen(3113, "127.0.0.1", r));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const headers = {
    Origin: origin,
    "X-GymIA-Request": "1",
    Connection: "close",
  };
  const post = (path, data) =>
    page.request.post(origin + "/api/" + path, { headers, data });
  const get = async (path) =>
    (await page.request.get(origin + "/api/" + path, { headers })).json();
  const go = async (route) => {
    await page.goto(origin + "/" + route);
    await expect(
      page.locator("#training-content,#evolution-content"),
    ).toBeVisible();
  };
  const axe = async () =>
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  async function layout() {
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    );
    if (!fits) {
      const overflow = await page.evaluate(() => ({
        url: location.pathname,
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll("main *")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.right > innerWidth + 1 || r.left < 0;
          })
          .slice(0, 12)
          .map((e) => ({
            tag: e.tagName,
            id: e.id,
            class: e.className,
            text: e.textContent.slice(0, 100),
          })),
      }));
      expect(fits, JSON.stringify(overflow)).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const fields = await page.locator(".field:visible").evaluateAll((fields) =>
      fields.map((f) => {
        const c = f.querySelector("input,select,textarea"),
          l = f.querySelector("label");
        return {
          f: f.getBoundingClientRect().toJSON(),
          c: c.getBoundingClientRect().toJSON(),
          l: l.getBoundingClientRect().toJSON(),
        };
      }),
    );
    for (const { f, c, l } of fields) {
      expect(c.left).toBeGreaterThanOrEqual(f.left - 1);
      expect(c.right).toBeLessThanOrEqual(f.right + 1);
      expect(c.top - l.bottom).toBeGreaterThanOrEqual(7);
    }
    expect(
      await page.evaluate(() =>
        ["--blue", "--cta-bg", "--bg", "--surface", "--ink"].map((k) =>
          getComputedStyle(document.documentElement).getPropertyValue(k).trim(),
        ),
      ),
    ).toEqual(["#1541D6", "#1F5BFF", "#EFF3F9", "#FBFCFE", "#050F26"]);
  }
  async function capture(name) {
    await page.setViewportSize({
      width: info.project.name === "desktop" ? 1440 : 390,
      height: 1000,
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.screenshot({
      path: `test-results/etapa4-${name}-${info.project.name}.png`,
      fullPage: true,
    });
  }
  try {
    const password = "Uma frase segura para navegador Etapa4!";
    expect(
      (
        await post("register", {
          name: "Conta fictícia da Etapa 4",
          email: `expansion-${info.project.name}@example.com`,
          password,
          confirmPassword: password,
          acceptTerms: true,
        })
      ).status(),
    ).toBe(201);
    await go("relatorios.html");
    await expect(page.locator("#report-output")).toContainText(
      "Nenhuma sessão encerrada",
    );
    await axe();
    await go("plano.html");
    await page
      .getByLabel("Nome do plano", { exact: true })
      .fill("Organização editável");
    await page.getByLabel("Objetivo do plano").selectOption("forca");
    await page.getByLabel("Modelo de organização").selectOption("alternadas");
    await page
      .getByRole("button", { name: "Usar modelo", exact: true })
      .click();
    await expect(page.locator(".planned-session")).toHaveCount(2);
    await page
      .getByLabel("Posição da sessão")
      .first()
      .selectOption({ value: "1" });
    expect(errors).toEqual([]);
    await expect(
      page.getByLabel("Nome da sessão", { exact: true }).first(),
    ).toHaveValue("Sessão B");
    await page
      .getByRole("button", { name: "Duplicar sessão", exact: true })
      .first()
      .click();
    await expect(page.locator(".planned-session")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Adicionar exercício", exact: true })
      .first()
      .click();
    await page
      .getByLabel("Pesquisar exercício", { exact: true })
      .fill("caminhada");
    await page
      .getByRole("button", { name: "Adicionar Caminhada", exact: true })
      .click();
    await page.getByLabel("Número de séries", { exact: true }).fill("1");
    await page.getByLabel("Medida", { exact: true }).selectOption("seconds");
    await page
      .getByLabel("Duração por série (segundos)", { exact: true })
      .fill("60");
    await page.getByLabel("Descanso (segundos)", { exact: true }).fill("30");
    await page
      .getByRole("button", { name: "Pré-visualizar plano", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Caminhada");
    await axe();
    await capture("previa");
    await page.getByRole("button", { name: "Fechar pré-visualização" }).click();
    await page
      .getByRole("button", { name: "Salvar plano", exact: true })
      .click();
    await expect(page).toHaveURL(/treinos.html$/);
    let plan = (await get("plans")).plans[0];
    await post(`plans/${plan.id}/activate`, { version: plan.version });
    plan = (await get(`plans/${plan.id}`)).plan;
    await go(`plano.html?id=${plan.id}`);
    await page
      .getByLabel("Nome do plano", { exact: true })
      .fill("Edição local preservada");
    expect(
      (
        await page.request.put(origin + `/api/plans/${plan.id}`, {
          headers,
          data: { ...plan, name: "Nome salvo em outra aba" },
        })
      ).status(),
    ).toBe(200);
    await page
      .getByRole("button", { name: "Salvar plano", exact: true })
      .click();
    await expect(page.locator("#plan-save-state")).toContainText(
      "mudou em outra aba",
    );
    await expect(page.getByLabel("Nome do plano", { exact: true })).toHaveValue(
      "Edição local preservada",
    );
    await page
      .getByRole("button", { name: "Comparar com dados mais recentes" })
      .click();
    await expect(page.locator("#plan-comparison")).toContainText(
      "Nome salvo em outra aba",
    );
    await capture("conflito");
    await page
      .getByRole("button", { name: "Reabrir versão do servidor" })
      .click();
    await expect(page.getByLabel("Nome do plano", { exact: true })).toHaveValue(
      "Nome salvo em outra aba",
    );
    await page
      .getByLabel("Nome do plano", { exact: true })
      .fill("Organização da semana");
    await page
      .getByRole("button", { name: "Salvar plano", exact: true })
      .click();
    await expect(page).toHaveURL(/treinos.html$/);
    plan = (await get(`plans/${plan.id}`)).plan;
    await go("calendario.html");
    await expect(page.getByLabel("Plano", { exact: true })).toHaveValue(
      plan.id,
    );
    const today = await page.getByLabel("Data planejada").inputValue(),
      until = new Date(Date.parse(today) + 21 * 86400000)
        .toISOString()
        .slice(0, 10);
    await page.getByLabel("Repetição", { exact: true }).selectOption("weekly");
    await page.getByLabel("Repetir até").fill(until);
    await page
      .getByRole("button", { name: "Salvar data", exact: true })
      .click();
    await expect(page.locator("[data-message]")).toContainText("Data salva");
    expect(
      (await get(`calendar?from=${today}&to=${until}`)).events,
    ).toHaveLength(4);
    await page
      .getByRole("button", { name: "Alterar data", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Salvar data", exact: true })
      .click();
    await expect(page.locator("[data-message]")).toContainText("Data salva");
    await page
      .getByRole("button", { name: "Editar série", exact: true })
      .click();
    await page.getByLabel("Intervalo em semanas").fill("2");
    await page
      .getByRole("button", { name: "Salvar data", exact: true })
      .click();
    await expect(page.locator("[data-message]")).toContainText("Data salva");
    await page.getByLabel("Filtrar por plano").selectOption(plan.id);
    await expect(page.locator("#day-events")).toContainText("Recorrência");
    await page
      .getByRole("button", { name: "Iniciar pelo agendamento" })
      .click();
    await expect(page).toHaveURL(/sessao-treino.html\?id=/);
    await page.getByLabel("Duração realizada (s)", { exact: true }).fill("42");
    await page.getByLabel("Carga (kg, opcional)", { exact: true }).fill("0");
    await page
      .getByRole("button", { name: "Interromper e salvar parcial" })
      .click();
    await expect(page).toHaveURL(/historico.html$/);
    await go("calendario.html");
    await expect(page.locator("#day-events")).toContainText(
      "Parcial · vinculada",
    );
    await expect(
      page.getByRole("button", { name: "Iniciar pelo agendamento" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Associar registro", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Associar registro");
    await axe();
    await page.getByRole("button", { name: "Fechar associação" }).click();
    await go("relatorios.html");
    await expect(page.locator("#report-output")).toContainText("42");
    await expect(page.locator("#report-output")).toContainText("Parcial");
    const csvDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Exportar CSV", exact: true })
      .click();
    const csv = readFileSync(await (await csvDownload).path(), "utf8");
    expect(csv).toContain('"seconds","42","0"');
    const jsonDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Exportar JSON do período" })
      .click();
    const json = JSON.parse(
      readFileSync(await (await jsonDownload).path(), "utf8"),
    );
    expect(json.workouts).toHaveLength(1);
    expect(json.current.partial).toBe(1);
    await page.evaluate(() => {
      window.print = () => {
        window.__printInvoked = true;
      };
    });
    await page.getByRole("button", { name: "Imprimir relatório" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__printInvoked))
      .toBe(true);
    await page.emulateMedia({ media: "print" });
    expect(await page.locator("#print-report").isVisible()).toBe(true);
    expect(await page.locator("header").isVisible()).toBe(false);
    await capture("impressao");
    await page.emulateMedia({ media: "screen" });
    await page.getByLabel("Estado das sessões").selectOption("completed");
    await page.getByRole("button", { name: "Gerar relatório" }).click();
    await expect(page.locator("#report-output")).toContainText(
      "Nenhuma sessão encerrada",
    );
    await go("assistente.html");
    await page
      .getByRole("button", {
        name: "Qual a diferença entre séries e repetições?",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Mensagem (até 2000 caracteres)")).toHaveValue(
      "Qual a diferença entre séries e repetições?",
    );
    await page.getByLabel("Tipo de solicitação").selectOption("draft");
    await page
      .getByRole("button", { name: "Testar demonstração local" })
      .click();
    await page.getByRole("link", { name: "Revisar e editar rascunho" }).click();
    await expect(page.locator("#draft-reviewed")).not.toBeChecked();
    await page.getByLabel("Plano de referência").selectOption(plan.id);
    await page
      .getByRole("button", { name: "Comparar com plano", exact: true })
      .click();
    await expect(page.locator("#plan-comparison")).toContainText(
      "Organização da semana",
    );
    await capture("rascunho");
    for (const route of [
      "calendario.html",
      "relatorios.html",
      "plano.html?id=" + plan.id,
      "assistente.html",
      "treinos.html",
      "exercicios.html",
      "historico.html",
    ]) {
      await go(route);
      await axe();
      for (const width of [320, 390, 560, 768, 900, 901, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await layout();
      }
      await capture(route.split(".")[0]);
    }
    await go("calendario.html");
    await page.getByLabel("Repetição").selectOption("weekly");
    await axe();
    for (const width of [320, 560, 900, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await layout();
    }
    await page.getByLabel("Intervalo em semanas").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Repetir até")).toBeFocused();
    await capture("recorrencia");
    await page
      .getByRole("button", { name: "Cancelar série", exact: true })
      .click();
    await expect(page.locator("#day-events")).toContainText("série cancelada");
    await expect(page.locator("#day-events")).toContainText(
      "Parcial · vinculada",
    );
    await go("exercicios.html");
    await page.getByLabel("Tipo de atividade").selectOption("Aeróbico");
    await expect(page.locator(".exercise-card")).toHaveCount(4);
    await page.getByLabel("Tipo de atividade").selectOption("");
    await page.getByRole("button", { name: "Mostrar mais exercícios" }).click();
    await expect(page.locator(".exercise-card")).toHaveCount(24);
    for (let i = 0; i < 26; i++) {
      const w = (
        await (
          await post("workouts", {
            planId: plan.id,
            sessionId: plan.sessions[0].id,
          })
        ).json()
      ).workout;
      expect(
        (
          await page.request.put(origin + "/api/workouts/" + w.id, {
            headers,
            data: { ...w, status: "completed" },
          })
        ).status(),
      ).toBe(200);
    }
    await go("historico.html");
    await expect(page.locator("#history-list article")).toHaveCount(25);
    await page.getByRole("button", { name: "Carregar mais registros" }).click();
    await expect(page.locator("#history-list article")).toHaveCount(27);
    await expect(
      page.getByRole("button", { name: "Carregar mais registros" }),
    ).toBeHidden();
    await go("relatorios.html");
    await expect(page.locator("#report-output")).toContainText("27 sessões");
    await page
      .getByRole("button", { name: "Próxima página", exact: true })
      .click();
    await expect(page.locator("#report-output")).toContainText("página 2 de 2");
    await expect(page.locator(".report-workout")).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await context.clearCookies();
    await app.close();
  }
});
