import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import type { Module, Project, SourceFile } from "./types.ts";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "__tests__", "test", "tests"]);
const SKIP_FILE = /\.d\.ts$|\.(spec|test)\.tsx?$/;

interface Scan { files: string[]; manifests: Set<string>; tsconfigs: Set<string>; nx: string[] }

function scan(root: string, dir = ".", out: Scan = { files: [], manifests: new Set(), tsconfigs: new Set(), nx: [] }): Scan {
  let entries;
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = dir === "." ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) scan(root, rel, out);
    } else if (e.isFile()) {
      if (/\.tsx?$/.test(e.name) && !SKIP_FILE.test(e.name)) out.files.push(rel);
      else if (e.name === "package.json") out.manifests.add(dir);
      else if (e.name === "tsconfig.json") out.tsconfigs.add(dir);
      else if (e.name === "project.json") out.nx.push(dir);
    }
  }
  return out;
}

function readJson(path: string): any {
  try {
    const { config } = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
    return config && typeof config === "object" ? config : undefined;
  } catch { return undefined; }
}

function readText(path: string) {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

/** Reads the `packages` list of a pnpm-workspace.yaml. */
export function pnpmPackages(text: string): string[] {
  const out: string[] = [];
  let inList = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    if (/^packages\s*:/.test(line)) {
      inList = true;
      const inline = line.match(/\[(.*)\]/);
      if (inline) { out.push(...inline[1]!.split(",").map(unquote).filter(Boolean)); inList = false; }
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) out.push(unquote(item[1]!));
    else if (!/^\s/.test(line)) inList = false;
  }
  return out;
}

const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, "");

function globRegex(glob: string) {
  const g = glob.replace(/^\.\//, "").replace(/\/+$/, "");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === "*" && g[i + 1] === "*") { i++; if (g[i + 1] === "/") { re += "(?:.*/)?"; i++; } else re += ".*"; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function expandGlobs(globs: string[], dirs: Iterable<string>): string[] {
  const inc = globs.filter((g) => !g.startsWith("!")).map(globRegex);
  const exc = globs.filter((g) => g.startsWith("!")).map((g) => globRegex(g.slice(1)));
  return [...dirs].filter((d) => d !== "." && inc.some((r) => r.test(d)) && !exc.some((r) => r.test(d)));
}

const contains = (dir: string, rel: string) => dir === "." || rel.startsWith(dir + "/");

interface TsPaths { baseUrl?: string; pathsBase?: string; paths?: Record<string, string[]> }

export function loadProject(root: string): Project {
  const s = scan(root);
  const rootPkg = readJson(join(root, "package.json"));
  const pkgOf = (dir: string) => (s.manifests.has(dir) ? readJson(join(root, dir, "package.json")) : undefined);

  const globs: string[] = [];
  const ws = rootPkg?.workspaces;
  if (Array.isArray(ws)) globs.push(...ws);
  else if (Array.isArray(ws?.packages)) globs.push(...ws.packages);
  const pnpm = readText(join(root, "pnpm-workspace.yaml")) ?? readText(join(root, "pnpm-workspace.yml"));
  if (pnpm) globs.push(...pnpmPackages(pnpm));
  const lerna = readJson(join(root, "lerna.json"));
  if (Array.isArray(lerna?.packages)) globs.push(...lerna.packages);

  const found: Module[] = [];
  const nameOf = (dir: string) => {
    const pkg = pkgOf(dir);
    if (typeof pkg?.name === "string") return pkg.name;
    const nx = s.nx.includes(dir) ? readJson(join(root, dir, "project.json")) : undefined;
    return typeof nx?.name === "string" ? nx.name : dir;
  };
  if (globs.length) {
    for (const dir of expandGlobs(globs, s.manifests)) found.push({ name: nameOf(dir), dir, source: "workspace" });
  }
  if (!found.length) for (const dir of s.nx.filter((d) => d !== ".")) found.push({ name: nameOf(dir), dir, source: "nx" });
  if (!found.length) {
    const dirs = new Set([...s.manifests, ...s.tsconfigs]);
    dirs.delete(".");
    for (const dir of [...dirs].sort()) {
      if (s.files.some((f) => contains(dir, f))) found.push({ name: nameOf(dir), dir, source: "manifest" });
    }
  }
  const modules: Module[] = [...found.sort((a, b) => a.dir.localeCompare(b.dir)), { name: typeof rootPkg?.name === "string" ? rootPkg.name : ".", dir: ".", source: "root" }];

  const moduleOf = (rel: string) => {
    let best = modules[modules.length - 1]!;
    for (const m of modules) if (contains(m.dir, rel) && (best.dir === "." || m.dir.length > best.dir.length)) best = m;
    return best;
  };

  const files: SourceFile[] = [];
  const byRel = new Map<string, SourceFile>();
  for (const rel of s.files) {
    const text = readText(join(root, rel));
    if (text === undefined) continue;
    const kind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
    const f = { rel, module: moduleOf(rel).name, sf };
    files.push(f);
    byRel.set(rel, f);
  }

  const tryFile = (p: string): string | undefined => {
    const rel = posix.normalize(p).replace(/^\.\//, "").replace(/\/$/, "");
    if (rel.startsWith("..")) return undefined;
    const base = rel.replace(/\.(m|c)?jsx?$/, "");
    for (const c of [rel, `${base}.ts`, `${base}.tsx`, `${rel}.ts`, `${rel}.tsx`, `${rel}/index.ts`, `${rel}/index.tsx`]) {
      if (byRel.has(c)) return c;
    }
    return undefined;
  };

  const configCache = new Map<string, TsPaths>();
  const loadConfig = (relPath: string, seen = new Set<string>()): TsPaths => {
    if (configCache.has(relPath)) return configCache.get(relPath)!;
    if (seen.has(relPath)) return {};
    seen.add(relPath);
    const json = readJson(join(root, relPath));
    const dir = posix.dirname(relPath);
    let out: TsPaths = {};
    const ext = json?.extends;
    for (const e of (Array.isArray(ext) ? ext : ext ? [ext] : []) as string[]) {
      if (typeof e !== "string" || !e.startsWith(".")) continue;
      let p = posix.normalize(posix.join(dir, e));
      if (!p.endsWith(".json")) p += ".json";
      if (p.startsWith("..")) continue;
      out = { ...out, ...loadConfig(p, seen) };
    }
    const co = json?.compilerOptions ?? {};
    if (typeof co.baseUrl === "string") out.baseUrl = posix.normalize(posix.join(dir, co.baseUrl));
    if (co.paths && typeof co.paths === "object") { out.paths = co.paths; out.pathsBase = dir; }
    const res = { ...out, pathsBase: out.baseUrl ?? out.pathsBase };
    configCache.set(relPath, res);
    return res;
  };
  const configFor = (fromRel: string): TsPaths => {
    let dir = posix.dirname(fromRel);
    for (;;) {
      if (s.tsconfigs.has(dir)) return loadConfig(dir === "." ? "tsconfig.json" : `${dir}/tsconfig.json`);
      if (dir === ".") return {};
      dir = posix.dirname(dir);
    }
  };

  const viaPaths = (cfg: TsPaths, spec: string) => {
    if (!cfg.paths) return undefined;
    let best: { star: string; targets: string[]; len: number } | undefined;
    for (const [key, targets] of Object.entries(cfg.paths)) {
      if (!Array.isArray(targets)) continue;
      const i = key.indexOf("*");
      if (i < 0) { if (key === spec) return pick(cfg, targets, ""); continue; }
      const pre = key.slice(0, i), post = key.slice(i + 1);
      if (spec.length >= pre.length + post.length && spec.startsWith(pre) && spec.endsWith(post) && (!best || pre.length > best.len)) {
        best = { star: spec.slice(pre.length, spec.length - post.length), targets, len: pre.length };
      }
    }
    return best && pick(cfg, best.targets, best.star);
  };
  const pick = (cfg: TsPaths, targets: string[], star: string) => {
    for (const t of targets) {
      const hit = tryFile(posix.join(cfg.pathsBase ?? ".", t.replace("*", star)));
      if (hit) return hit;
    }
    return undefined;
  };

  const packages = modules.filter((m) => m.dir !== ".");
  const viaPackage = (spec: string) => {
    const m = packages.find((p) => spec === p.name || spec.startsWith(p.name + "/"));
    if (!m) return undefined;
    const sub = spec.slice(m.name.length + 1);
    if (sub) return tryFile(`${m.dir}/src/${sub}`) ?? tryFile(`${m.dir}/${sub}`);
    const pkg = pkgOf(m.dir) ?? {};
    for (const field of [pkg.main, pkg.types, pkg.typings, pkg.module]) {
      if (typeof field !== "string") continue;
      const hit = tryFile(`${m.dir}/${field}`) ?? tryFile(`${m.dir}/${field.replace(/^(\.\/)?(dist|build|lib|out)\//, "$1src/").replace(/\.d\.ts$/, ".ts")}`);
      if (hit) return hit;
    }
    return tryFile(`${m.dir}/src/index`) ?? tryFile(`${m.dir}/index`);
  };

  const resolveImport = (fromRel: string, spec: string): string | undefined => {
    if (spec.startsWith(".")) return tryFile(posix.join(posix.dirname(fromRel), spec));
    if (spec.startsWith("/")) return undefined;
    const cfg = configFor(fromRel);
    return viaPaths(cfg, spec)
      ?? (cfg.baseUrl !== undefined ? tryFile(posix.join(cfg.baseUrl, spec)) : undefined)
      ?? viaPackage(spec)
      ?? (spec.includes("/") ? tryFile(posix.join(moduleOf(fromRel).dir, spec)) : undefined);
  };

  return { root, modules, files, file: (rel) => byRel.get(rel), resolveImport };
}
