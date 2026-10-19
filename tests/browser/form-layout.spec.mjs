import { test, expect } from "@playwright/test";

const password = "Uma frase para testar os formulários 2026!";

async function checkFormLayout(page) {
  const geometry = await page.locator("form .field:visible").evaluateAll(fields => fields.map(field => {
    const rect = element => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const control = field.querySelector("input, select, textarea");
    return { id: control.id, field: rect(field), label: rect(field.querySelector("label")), control: rect(control) };
  }));
  expect(geometry.length).toBeGreaterThan(0);
  for (const { id, field, label, control } of geometry) {
    expect(control.left, `${id}: left boundary`).toBeGreaterThanOrEqual(field.left - 1);
    expect(control.right, `${id}: right boundary`).toBeLessThanOrEqual(field.right + 1);
    expect(control.top - label.bottom, `${id}: space below its label`).toBeGreaterThanOrEqual(7);
  }
  const grids = await page.locator(".form-grid:visible").evaluateAll(grids => grids.map(grid => {
    const controls = [...grid.querySelectorAll("input, select, textarea")].map(control => {
      const { left, right, top, bottom } = control.getBoundingClientRect();
      return { left, right, top, bottom };
    });
    return { controls, columnGap: parseFloat(getComputedStyle(grid).columnGap) };
  }));
  for (const { controls, columnGap } of grids) {
    for (let i = 1; i < controls.length; i++) {
      const previous = controls[i - 1], current = controls[i];
      if (current.left > previous.left + 1) {
        expect(current.left - previous.right, "horizontal space between controls").toBeGreaterThanOrEqual(columnGap - 1);
        expect(Math.abs(current.bottom - previous.bottom), "controls stay aligned when labels wrap").toBeLessThanOrEqual(1);
      } else {
        expect(current.top - previous.bottom, "vertical space between stacked fields").toBeGreaterThanOrEqual(20);
      }
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("Campos cabem nas colunas e preservam o espaçamento nos formulários", async ({ page }, info) => {
  test.setTimeout(90000);
  const widths = info.project.name === "desktop"
    ? [1440, 1280, 1100, 1024, 960, 920, 901, 900, 768, 600, 561, 560]
    : [430, 390, 375, 360, 320];

  // Check the same field rules on the public forms before authenticating.
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ["cadastro.html", "entrar.html", "recuperar-senha.html", "redefinir-senha.html"]) {
      await page.goto(`/${route}`);
      await checkFormLayout(page);
    }
  }

  const headers = { Origin: "http://localhost:3100", "X-GymIA-Request": "1" };
  const registration = await page.request.post("/api/register", { headers, data: {
    name: "Teste de espaçamento", email: `layout-${info.project.name}@example.com`,
    password, confirmPassword: password, acceptTerms: true,
  } });
  expect(registration.status()).toBe(201);
  await page.goto("/configurar-perfil.html");
  await expect(page.locator("[data-private-content]")).toBeVisible();
  await page.locator("#goal").selectOption("condicionamento");
  await page.locator("#experience").selectOption("intermediario");
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await checkFormLayout(page);
  }
  await page.getByRole("button", { name: "Avançar", exact: true }).click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await checkFormLayout(page);
  }
  await page.locator("#days").selectOption("7");
  await page.locator("#minutes").selectOption("180");
  await page.locator("#location").selectOption("academia");
  await page.getByRole("checkbox", { name: "Outros", exact: true }).check();
  await page.locator("#otherEquipment").fill("Banco ajustável");
  await checkFormLayout(page);
  await page.getByRole("button", { name: "Avançar", exact: true }).click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await checkFormLayout(page);
  }
  await page.getByRole("button", { name: "Salvar meu perfil", exact: true }).click();
  await expect(page).toHaveURL(/perfil.html$/);
  await expect(page.locator("[data-private-content]")).toBeVisible();
  await page.getByRole("link", { name: "Editar preferências", exact: true }).click();
  await page.locator(".delete-card summary").click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await checkFormLayout(page);
  }
  // Include the expanded editor in visual QA, not just the dashboard summary.
  await page.setViewportSize({ width: info.project.name === "desktop" ? 1440 : 390, height: 1000 });
  await page.locator(".delete-card summary").click();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.screenshot({ path: `test-results/preferencias-${info.project.name}.png`, fullPage: true });
});
