import { node, field } from "./training-ui.js";
export const panel = (title, ...children) =>
  node(
    "section",
    { class: "card form-card" },
    node("h2", {}, title),
    ...children,
  );
export const select = (label, id, value, options, change = () => {}) =>
  field(label, id, value, change, { options });
export const checkbox = (id, label, checked = false) =>
  node(
    "label",
    { class: "check" },
    node("input", { id, type: "checkbox", checked }),
    node("span", {}, label),
  );
export const table = (caption, headers, rows) =>
  node(
    "div",
    { class: "table-scroll", tabindex: 0, "aria-label": caption },
    node(
      "table",
      {},
      node("caption", {}, caption),
      node(
        "thead",
        {},
        node(
          "tr",
          {},
          headers.map((h) => node("th", { scope: "col" }, h)),
        ),
      ),
      node(
        "tbody",
        {},
        rows.map((row) =>
          node(
            "tr",
            {},
            row.map((v) => node("td", {}, v ?? "Não informado")),
          ),
        ),
      ),
    ),
  );
export function download(data, name, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = node("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
