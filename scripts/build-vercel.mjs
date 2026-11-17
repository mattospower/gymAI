import { mkdir, readFile, writeFile, cp, readdir, rm } from "node:fs/promises";
import { resolve, relative, sep, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Build Output API: all requests go through authentication and the static-file
// allowlist. No .env, data directory or private HTML is an unguarded static asset.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, ".vercel/output");
if (relative(root, output) !== `.vercel${sep}output`)
  throw new Error("Diretório de build inválido.");
await rm(output, { recursive: true, force: true });
const fn = resolve(output, "functions/gymia.func");
await mkdir(fn, { recursive: true });
for (const dir of ["server", "assets", "api"])
  await cp(resolve(root, dir), resolve(fn, dir), { recursive: true });
for (const f of await readdir(root))
  if (f.endsWith(".html") || f === "style.css")
    await cp(resolve(root, f), resolve(fn, f));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const copied = new Map();
async function copyDependency(name, requireFrom, optional = false) {
  let entry;
  try {
    entry = requireFrom.resolve(name);
  } catch (error) {
    if (optional && error.code === "MODULE_NOT_FOUND") return;
    throw error;
  }
  let directory = dirname(entry),
    dependency;
  for (;;) {
    try {
      dependency = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
    } catch {
      dependency = null;
    }
    if (dependency?.name === name) break;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Dependência não localizada: " + name);
    directory = parent;
  }
  if (copied.has(name)) {
    if (copied.get(name) !== dependency.version)
      throw new Error("Versões conflitantes no pacote: " + name);
    return;
  }
  copied.set(name, dependency.version);
  await cp(directory, join(fn, "node_modules", name), {
    recursive: true,
    dereference: true,
    filter: (source) => !["node_modules", ".git"].includes(basename(source)),
  });
  const requireDependency = createRequire(join(directory, "package.json"));
  for (const child of Object.keys(dependency.dependencies || {}))
    await copyDependency(child, requireDependency);
  for (const child of Object.keys(dependency.optionalDependencies || {}))
    await copyDependency(child, requireDependency, true);
}
for (const name of Object.keys(pkg.dependencies))
  await copyDependency(name, createRequire(join(root, "package.json")));
await writeFile(
  resolve(fn, "package.json"),
  JSON.stringify({ type: "module", dependencies: pkg.dependencies }),
);
await writeFile(
  resolve(fn, ".vc-config.json"),
  JSON.stringify({
    runtime: "nodejs24.x",
    handler: "api/index.mjs",
    launcherType: "Nodejs",
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    maxDuration: 60,
  }),
);
await writeFile(
  resolve(output, "config.json"),
  JSON.stringify({ version: 3, routes: [{ src: "/.*", dest: "/gymia" }] }),
);
console.log(
  "Build Vercel concluído; nenhuma configuração local ou banco foi incluído.",
);
