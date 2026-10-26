import { HttpError } from "./security.mjs";
import { localDay } from "./dates.mjs";
const csvCell = (value) => {
  let s = value == null ? "" : String(value);
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function reportResult(url, summary, workouts, exerciseId) {
  const page = Number(url.searchParams.get("page") || 1),
    pageSize = Number(url.searchParams.get("pageSize") || 25),
    format = url.searchParams.get("format") || "";
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !["", "json", "csv"].includes(format)
  )
    throw new HttpError(400, "Opções de relatório inválidas.");
  const selected = workouts.map((w) => ({
    ...w,
    snapshot: {
      ...w.snapshot,
      exercises: w.snapshot.exercises.filter(
        (e) => !exerciseId || e.exerciseId === exerciseId,
      ),
    },
    records: w.records.filter(
      (r, i) =>
        !exerciseId || w.snapshot.exercises[i].exerciseId === exerciseId,
    ),
  }));
  if (format === "csv") {
    const rows = [
      [
        "Data no fuso",
        "Fuso",
        "Início ISO",
        "Plano",
        "Sessão",
        "Estado",
        "Exercício",
        "Série",
        "Série marcada concluída",
        "Medida",
        "Valor realizado",
        "Carga kg",
      ],
    ];
    for (const w of selected) {
      let has = false;
      w.snapshot.exercises.forEach((e, i) =>
        w.records[i].sets.forEach((s, j) => {
          has = true;
          rows.push([
            localDay(w.startedAt, summary.timeZone),
            summary.timeZone,
            new Date(w.startedAt).toISOString(),
            w.snapshot.planName,
            w.snapshot.sessionName,
            w.status,
            e.name,
            j + 1,
            s.completed ? "sim" : "não",
            e.mode,
            s.value,
            s.load,
          ]);
        }),
      );
      if (!has)
        rows.push([
          localDay(w.startedAt, summary.timeZone),
          summary.timeZone,
          new Date(w.startedAt).toISOString(),
          w.snapshot.planName,
          w.snapshot.sessionName,
          w.status,
        ]);
    }
    return {
      csv: rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n",
    };
  }
  return {
    schemaVersion: 4,
    ...summary,
    page,
    pageSize,
    total: selected.length,
    totalPages: Math.max(1, Math.ceil(selected.length / pageSize)),
    workouts:
      format === "json"
        ? selected
        : selected.slice((page - 1) * pageSize, page * pageSize),
  };
}
