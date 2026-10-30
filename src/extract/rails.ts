import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DataMap, DmNode, Edge, Endpoint, External } from "../datamap.ts";
import { parseRoutes, routeKey, type Route } from "./routes.ts";
import { declaredNames, methodBodies, methodWithHelpers, stripRuby } from "./ruby.ts";

type Kind = "controller" | "service" | "model" | "worker" | "adapter";

interface ClassInfo {
  name: string;
  kind: Kind;
  file: string;
  code: string;
  raw: string;
  queue?: string;
  activeRecord: boolean;
}

const SOURCES: [string, Kind][] = [
  ["app/controllers", "controller"],
  ["app/services", "service"],
  ["app/models", "model"],
  ["app/workers", "worker"],
  ["app/lib", "adapter"],
];

const EXTERNALS = {
  postgres: { id: "postgresql", name: "PostgreSQL" },
  redis: { id: "redis", name: "Redis" },
  http: { id: "remote-http", name: "Remote servers (HTTP)" },
  webpush: { id: "web-push", name: "Web Push gateways" },
};

/** Text patterns that mark a chip as touching a system outside the service. */
const IO_RULES: { ext: keyof typeof EXTERNALS; rule: string; re: RegExp }[] = [
  { ext: "redis", rule: "redis-call", re: /\bredis\b|\bRedis\.|\bwith_redis\b|\bRails\.cache\b/ },
  { ext: "http", rule: "http-client", re: /\bHTTP\.|\bFaraday\b|\bNet::HTTP\b/ },
  { ext: "webpush", rule: "webpush-call", re: /\bWebpush\b|\bWebPush\b/ },
];

const ENQUEUE = /((?:::)?[A-Z][\w]*(?:::[A-Z]\w*)*)\s*\.\s*(?:set\([^)]*\)\s*\.\s*)?(?:perform_async|perform_in|perform_at|push_bulk)\b/g;
const CONSTANT = /(?<![\w:.])((?:::)?[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)/g;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "concerns") walk(p, out); }
    else if (name.endsWith(".rb")) out.push(p);
  }
  return out;
}

function camelize(s: string) {
  return s.split("/").map((p) => p.replace(/(?:^|_)(\w)/g, (_, c: string) => c.toUpperCase())).join("::");
}

export interface ExtractOptions {
  /** Keep only routes matching these, each written "METHOD /path". Param names are ignored. */
  include?: string[];
  /** Date text recorded in the data map. */
  captured?: string;
}

export function extractRails(root: string, opts: ExtractOptions = {}): DataMap {
  // ---- index every class the extractor may follow ----
  const index = new Map<string, ClassInfo>();
  const byFile = new Map<string, ClassInfo>();
  for (const [dir, kind] of SOURCES) {
    for (const file of walk(join(root, dir))) {
      const raw = readFileSync(file, "utf8");
      const code = stripRuby(raw);
      const names = declaredNames(code);
      if (!names.length) continue;
      const rel = relative(root, file);
      const wanted = camelize(relative(join(root, dir), file).replace(/\.rb$/, "")).toLowerCase();
      const name = names.find((n) => n.replace(/::/g, "").toLowerCase() === wanted.replace(/::/g, "")) ?? names[0];
      const queue = stripRuby(raw, true).match(/sidekiq_options[^\n]*?\bqueue:\s*(?::|['"])([\w-]+)/)?.[1];
      const info: ClassInfo = {
        name, kind, file: rel, code, raw,
        queue: kind === "worker" ? queue ?? "default" : undefined,
        activeRecord: /class\s+[\w:]+\s*<\s*(?:ApplicationRecord|ActiveRecord::Base)\b/.test(code) && !/abstract_class\s*=\s*true/.test(code),
      };
      index.set(name, info);
      byFile.set(rel, info);
    }
  }

  const resolve = (ref: string, scope: string): ClassInfo | undefined => {
    const parts = ref.replace(/^::/, "").split("::");
    const scopes = scope.split("::");
    for (let take = parts.length; take > 0; take--) {
      const want = parts.slice(0, take).join("::");
      for (let s = scopes.length; s >= 0; s--) {
        const hit = index.get([...scopes.slice(0, s), want].join("::"));
        if (hit) return hit;
      }
    }
    return undefined;
  };

  // ---- endpoints ----
  const wanted = opts.include?.map((x) => {
    const [m, ...p] = x.trim().split(/\s+/);
    return routeKey(m, p.join(" "));
  });
  const routes = parseRoutes(root).filter((r) => !wanted || wanted.includes(routeKey(r.method, r.path)));

  const nodes = new Map<string, DmNode>();
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  const externals = new Map<string, External>();
  const endpoints: Endpoint[] = [];
  const addEdge = (e: Edge) => {
    const k = `${e.from}|${e.to}|${e.kind}|${e.queue ?? ""}`;
    if (!edgeKeys.has(k)) { edgeKeys.add(k); edges.push(e); }
  };
  const external = (key: keyof typeof EXTERNALS) => {
    const x = EXTERNALS[key];
    if (!externals.has(x.id)) externals.set(x.id, { id: x.id, name: x.name });
    return x.id;
  };
  const work: { id: string; info: ClassInfo; action?: string }[] = [];
  const seenNode = new Set<string>();
  const addNode = (info: ClassInfo, action?: string): string => {
    const id = action ? `${info.name}#${action}` : info.name;
    if (!seenNode.has(id)) {
      seenNode.add(id);
      nodes.set(id, { id, name: id, kind: info.kind, file: info.file, ...(info.queue ? { queue: info.queue } : {}) });
      work.push({ id, info, action });
    }
    return id;
  };

  const seenEndpoint = new Set<string>();
  for (const r of routes as Route[]) {
    const file = `app/controllers/${r.controller}_controller.rb`;
    const info = byFile.get(file);
    if (!info || !methodBodies(info.code).has(r.action)) continue;
    const eid = `${r.method} ${r.path}`;
    if (seenEndpoint.has(eid)) continue;
    seenEndpoint.add(eid);
    endpoints.push({ id: eid, method: r.method, path: r.path, entry: addNode(info, r.action), rule: "rails-routes" });
  }

  // ---- follow references from each chip ----
  const RULE: Record<string, string> = {};
  while (work.length) {
    const { id, info, action } = work.shift()!;
    const code = action ? methodWithHelpers(info.code, action)! : info.code;
    const raw = action ? methodWithHelpers(stripRuby(info.raw, true), action) ?? "" : stripRuby(info.raw, true);

    // a model follows only adapters and queue hops; adapters follow nothing
    const follows = (kind: Kind) => info.kind !== "adapter" && (info.kind !== "model" || kind === "adapter");
    const enqueued = new Set<string>();
    for (const m of code.matchAll(ENQUEUE)) {
      const target = resolve(m[1], info.name);
      if (!target || target.kind !== "worker" || target.name === info.name) continue;
      enqueued.add(target.name);
      addEdge({ from: id, to: addNode(target), kind: "async", queue: target.queue!, rule: "sidekiq-enqueue" });
    }
    for (const m of code.matchAll(CONSTANT)) {
      const target = resolve(m[1], info.name);
      if (!target || target.name === info.name || target.kind === "controller" || enqueued.has(target.name)) continue;
      if (!follows(target.kind)) continue;
      const rule = (RULE[`${info.kind}>${target.kind}`] ??= `${info.kind}-uses-${target.kind}`);
      addEdge({ from: id, to: addNode(target), kind: "sync", rule });
    }

    if (info.kind === "model" && info.activeRecord) addEdge({ from: id, to: external("postgres"), kind: "io", rule: "activerecord-model" });
    for (const r of IO_RULES) if (r.re.test(raw) || r.re.test(code)) addEdge({ from: id, to: external(r.ext), kind: "io", rule: r.rule });
  }

  return {
    system: root.split("/").filter(Boolean).pop() ?? "rails-app",
    language: "ruby",
    framework: "rails",
    captured: opts.captured ?? "extracted by cc",
    endpoints,
    externals: [...externals.values()],
    nodes: [...nodes.values()],
    edges,
  };
}
