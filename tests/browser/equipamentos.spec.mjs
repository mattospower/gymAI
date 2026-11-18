import { test, expect } from "@playwright/test";

test("lista da aba permite adicionar, alterar e remover sem navegação", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  const form = page.locator("#equipamento-form");
  let navigations = 0;
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) navigations++;
  });
  await form.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: "Editar Halteres" }).click();
  await page.getByLabel("Equipamento", { exact: true }).selectOption("Banco");
  await form.getByText("Salvar alteração").click();
  await expect(page.getByRole("button", { name: "Editar Banco" })).toBeVisible();
  expect(navigations).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "Remover Banco" }).click();
  expect(navigations).toBe(1);
  await page.reload();
  await expect(page.locator("#lista-equipamentos li")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
