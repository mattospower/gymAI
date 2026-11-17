import { HttpError } from "./security.mjs";
export const dayMs = 86400000;
export function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value ||
    value < "1900-01-01" ||
    value > "9998-12-31"
  )
    throw new HttpError(400, "Informe uma data válida entre 1900 e 9998.");
  return value;
}
export const shiftDate = (value, days) =>
  new Date(Date.parse(value) + days * dayMs).toISOString().slice(0, 10);
export function localDay(value, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function range(url, prefs, now) {
  const to = validDate(
    url.searchParams.get("to") || localDay(now(), prefs.timeZone),
  );
  const from = validDate(url.searchParams.get("from") || shiftDate(to, -29));
  const days = (Date.parse(to) - Date.parse(from)) / dayMs + 1;
  if (days < 1 || days > 366)
    throw new HttpError(400, "Escolha um período de 1 a 366 dias.");
  return { from, to, days };
}
