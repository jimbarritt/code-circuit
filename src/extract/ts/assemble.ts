import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DataMap, DmNode, Edge, Endpoint, External } from "../../datamap.ts";
import { routeKey } from "../routes.ts";
import { ENTRY_DETECTORS } from "./entries/index.ts";
import { EXIT_DETECTORS } from "./exits/index.ts";
import { loadProject } from "./project.ts";
import { allDeps, allMethods, buildIndex, classChain } from "./symbols.ts";
import type { ClassSym, Finding, SymbolIndex } from "./types.ts";

export interface TsExtractOptions {
  /** Keep only endpoints matching these, each written "METHOD target". Param names are ignored. */
  include?: string[];
  /** Date text recorded in the data map. */
  captured?: string;
}

export interface Survey { modules: string[]; entries: Finding[]; exits: Finding[] }

const LABELS: Record<string, string> = {
  "mikro-orm": "MikroORM", typeorm: "TypeORM", prisma: "Prisma", mongoose: "Mongoose", sequelize: "Sequelize", drizzle: "Drizzle",
  knex: "Knex", pg: "PostgreSQL", mysql: "MySQL", mysql2: "MySQL", mongodb: "MongoDB", dynamodb: "DynamoDB",
  ioredis: "ioredis", redis: "redis", "node-redis": "node-redis", "cache-manager": "cache-manager", keyv: "Keyv",
  kafka: "Kafka", kafkajs: "Kafka", rmq: "RabbitMQ", amqplib: "RabbitMQ", amqp: "RabbitMQ", nats: "NATS", mqtt: "MQTT",
  tcp: "TCP", smtp: "SMTP", nodemailer: "SMTP", sqs: "SQS", sns: "SNS", kinesis: "Kinesis", bullmq: "BullMQ", bull: "Bull",
  grpc: "gRPC", "nest-http": "Nest HttpService", "google-oauth2": "Google OAuth2", kysely: "Kysely", octokit: "GitHub API",
};
const label = (p: string) => LABELS[p] ?? (p.startsWith("aws-") ? `AWS ${p.slice(4).toUpperCase().replace(/-/g, " ")}` : p);

function externalName(kind: string, protocol: string): string {
  const l = label(protocol);
  switch (kind) {
    case "database": return `Database (${l})`;
    case "cache": return /redis/i.test(protocol) ? `Redis (${l})` : `Cache (${l})`;
    case "http-out": return `HTTP (${l})`;
    case "grpc-out": return "gRPC services";
    case "queue-out": return `Queue (${l})`;
    default: return l;
  }
}

const NAME_KINDS: [RegExp, string][] = [
  [/Controller$/, "controller"], [/Resolver$/, "resolver"], [/Gateway$/, "gateway"],
  [/(Consumer|Listener|Subscriber|Handler)$/, "consumer"], [/(Processor|Worker|Job|Cron|Scheduler|Task)s?$/, "worker"],
  [/(Repository|Repo)$/, "repository"], [/(Client|Producer|Publisher|Mailer)$/, "client"],
];
const DECORATOR_KINDS: Record<string, string> = { Controller: "controller", Resolver: "resolver", WebSocketGateway: "gateway", Processor: "worker", EntityRepository: "repository" };
const ENTRY_KINDS: Record<string, string> = { http: "controller", grpc: "controller", graphql: "resolver", websocket: "gateway", message: "consumer", queue: "worker", cron: "worker" };

function classKind(c: ClassSym, entryKinds: string[]): string {
  for (const [re, k] of NAME_KINDS) if (re.test(c.name)) return k;
  for (const d of c.decorators) if (DECORATOR_KINDS[d.name]) return DECORATOR_KINDS[d.name]!;
  if (c.extends && /Repository\b/.test(c.extends)) return "repository";
  for (const k of entryKinds) if (ENTRY_KINDS[k]) return ENTRY_KINDS[k]!;
  return "service";
}

/** Transports that can carry the same messages; "nest" stands for any. */
const FAMILY: Record<string, string> = { kafkajs: "kafka", rmq: "amqp", amqplib: "amqp", ioredis: "redis", "aws-sqs": "sqs" };
const family = (p: string) => FAMILY[p] ?? p;
const compatible = (a: string, b: string) => a === "nest" || b === "nest" || family(a) === family(b);

/** A class that is the ORM client itself, or extends it: calls to its ORM methods are exits of the caller. */
const ORM_HANDLE = /^(PrismaClient|EntityRepository|SqlEntityRepository|Repository|MongoRepository|TreeRepository|Kysely)$/;
/** Loggers draw many edges and show no data path. */
const LOGGER = /(Logger|LoggerService|LoggingRepository|LoggingService)$/;

/** The classes a dependency on `id` can reach: its providers, else every subclass of an abstract class, else itself. */
function targetsOf(index: SymbolIndex, id: string): string[] {
  const bound = index.bindings?.get(id);
  if (bound?.length) return bound;
  const c = index.classById.get(id);
  if (c?.abstract) {
    const subs = index.classes.filter((x) => x.base === id).map((x) => x.id);
    if (subs.length) return subs;
  }
  return [id];
}

/** Index of the method parameter that an unresolved exit target names, for wrappers such as `emitMessage(topic, msg)`. */
function paramIndex(index: SymbolIndex, f: Finding): { cls: ClassSym; method: string; i: number } | undefined {
  const cls = index.classById.get(f.node);
  const method = f.symbol.split(".")[1];
  if (f.resolved || !cls || !method || !/^[A-Za-z_$][\w$]*$/.test(f.target)) return undefined;
  const m = cls.methods.find((x) => x.name === method)?.node;
  const params = m && ("parameters" in m ? m.parameters : undefined);
  const i = params ? params.findIndex((p) => p.name.getText() === f.target) : -1;
  return i >= 0 ? { cls, method, i } : undefined;
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);
const byPlace = (a: Finding, b: Finding) =>
  cmp(a.module, b.module) || cmp(a.file, b.file) || a.line - b.line || cmp(a.method, b.method) || cmp(a.target, b.target) || cmp(a.symbol, b.symbol);

/** `pkg.Service/Method` and `Service/method` compare equal. */
const grpcKey = (t: string) => {
  const [svc = "", m = ""] = t.split("/");
  return `${svc.split(".").pop()}/${m}`.toLowerCase();
};

function systemName(root: string): string {
  try {
    const name = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name;
    if (typeof name === "string" && name) return name;
  } catch {}
  return basename(root.replace(/\/+$/, "")) || "system";
}

function frameworkOf(findings: Finding[]): string | undefined {
  const names = new Set<string>();
  for (const f of findings) {
    if (f.rule.startsWith("nest") || f.protocol === "nest") names.add("NestJS");
    else if (f.direction === "entry" && f.kind === "http") names.add({ express: "Express", fastify: "Fastify", koa: "Koa", hono: "Hono" }[f.protocol] ?? f.protocol);
  }
  return names.size ? [...names].sort().join(", ") : undefined;
}

export function extractTypeScript(root: string, opts: TsExtractOptions = {}): DataMap & { survey: Survey } {
  const project = loadProject(root);
  const index = buildIndex(project);
  const ctx = { project, index };
  const entries = ENTRY_DETECTORS.flatMap((d) => d.detect(ctx)).sort(byPlace);
  const exits = EXIT_DETECTORS.flatMap((d) => d.detect(ctx)).sort(byPlace);
  const fnById = new Map(index.functions.map((f) => [f.id, f]));

  const consumers = (f: Finding) => {
    const all = entries.filter((e) =>
      f.kind === "grpc-out" ? e.kind === "grpc" && grpcKey(e.target) === grpcKey(f.target)
        : e.kind === (f.kind === "message-out" ? "message" : "queue") && f.resolved && e.resolved && e.target === f.target && compatible(f.protocol, e.protocol));
    const near = all.filter((e) => e.module === f.module);
    return near.length ? near : all;
  };

  // ---- producers behind a wrapper: the caller passes the topic to a method that sends it ----
  const derived: Finding[] = [];
  const wrappers = exits.flatMap((f) => {
    const p = f.kind === "message-out" || f.kind === "queue-out" ? paramIndex(index, f) : undefined;
    return p ? [{ f, ...p }] : [];
  });
  if (wrappers.length) for (const c of index.classes) {
    const deps = new Map(allDeps(index, c).map((d) => [d.param, d.classId ? targetsOf(index, d.classId) : []]));
    for (const { m, cls } of allMethods(index, c)) for (const call of m.calls) for (const w of wrappers) {
      if (call.method !== w.method || !deps.get(call.dep)?.includes(w.cls.id)) continue;
      const arg = call.node.arguments[w.i];
      const v = arg && index.resolveValue(arg, cls.file);
      if (v === undefined) continue;
      const d: Finding = { ...w.f, target: v, resolved: true, module: c.module, file: cls.file, line: call.line, symbol: `${c.name}.${m.name}`, node: c.id, rule: `${w.f.rule}-via-wrapper` };
      if (consumers(d).length) derived.push(d);
    }
  }

  // ---- nodes: finding owners, then every class they call ----
  const owners = new Map<string, Finding>();
  for (const f of [...entries, ...exits, ...derived]) if (!owners.has(f.node)) owners.set(f.node, f);
  const keep = new Set(owners.keys());
  const work = [...keep];
  const sync: Edge[] = [];
  const reach = (from: string, to: string, rule: string) => {
    if (to === from) return;
    sync.push({ from, to, kind: "sync", rule });
    if (!keep.has(to)) { keep.add(to); work.push(to); }
  };
  while (work.length) {
    const id = work.shift()!;
    const c = index.classById.get(id);
    // Calls to top-level functions count when the function owns a finding.
    const fnCalls = c ? allMethods(index, c).flatMap(({ m }) => m.fnCalls ?? []) : fnById.get(id)?.fnCalls ?? [];
    for (const call of fnCalls) if (owners.has(call.fn)) reach(id, call.fn, "fn-call");
    if (!c) continue;
    // Findings in an inherited method belong to the base class node.
    for (const b of classChain(index, c).slice(1)) if (owners.has(b.id)) reach(c.id, b.id, "extends");
    const deps = new Map(allDeps(index, c).map((d) => [d.param, d.classId]));
    for (const { m } of allMethods(index, c)) for (const call of m.calls) {
      const dep = deps.get(call.dep);
      for (const to of dep ? targetsOf(index, dep) : []) {
        const t = index.classById.get(to);
        if (!t || LOGGER.test(t.name)) continue;
        // A call to an ORM method that no class of the repo declares is an exit of the caller.
        if (classChain(index, t).some((x) => x.extends && ORM_HANDLE.test(x.extends)) && !allMethods(index, t).some(({ m: tm }) => tm.name === call.method)) continue;
        reach(c.id, to, "di-call");
      }
    }
  }

  const entryKindsOf = new Map<string, string[]>();
  for (const f of entries) entryKindsOf.set(f.node, [...(entryKindsOf.get(f.node) ?? []), f.kind]);
  const nodes = new Map<string, DmNode>();
  for (const id of keep) {
    const c = index.classById.get(id), fn = fnById.get(id), f = owners.get(id);
    const node: DmNode = c ? { id, name: c.name, kind: classKind(c, entryKindsOf.get(id) ?? []), module: c.module, file: c.file }
      : fn ? { id, name: fn.name, kind: "function", module: fn.module, file: fn.file }
      : { id, name: f!.symbol.split(".")[0] || basename(f!.file), kind: "function", module: f!.module, file: f!.file };
    const queue = entries.find((e) => e.node === id && e.kind === "queue" && e.resolved);
    if (queue) node.queue = queue.target;
    nodes.set(id, node);
  }

  // ---- endpoints ----
  const endpoints: Endpoint[] = [];
  const eids = new Set<string>();
  for (const f of entries) {
    let id = `${f.module}:${f.method}:${f.target}`;
    if (eids.has(id)) id += `@${f.file}:${f.line}`;
    eids.add(id);
    endpoints.push({ id, method: f.method, path: f.target || "?", entry: f.node, kind: f.kind, protocol: f.protocol, module: f.module, file: f.file, line: f.line });
  }

  // ---- links between producers and consumers, and io to externals ----
  const edges: Edge[] = [...sync];
  const externals = new Map<string, External>();
  for (const f of derived) for (const e of consumers(f)) edges.push({ from: f.node, to: e.node, kind: "async", queue: f.target, rule: f.rule });
  for (const f of exits) {
    const linked = f.kind === "grpc-out" || f.kind === "message-out" || f.kind === "queue-out" ? consumers(f) : [];
    for (const e of linked) {
      edges.push(f.kind === "grpc-out" ? { from: f.node, to: e.node, kind: "sync", rule: "grpc-call" } : { from: f.node, to: e.node, kind: "async", queue: f.target, rule: f.kind });
    }
    if (linked.length) continue;
    const xid = `${f.kind}:${f.protocol}`;
    if (!externals.has(xid)) externals.set(xid, { id: xid, name: externalName(f.kind, f.protocol), kind: f.kind, protocol: f.protocol });
    edges.push({ from: f.node, to: xid, kind: "io", rule: f.rule });
  }

  let map = finish({ endpoints, nodes: [...nodes.values()], edges, externals: [...externals.values()] });
  let survey: Survey = { modules: project.modules.map((m) => m.name).sort(), entries, exits };

  if (opts.include?.length) {
    const wanted = new Set(opts.include.map((x) => { const [m = "", ...p] = x.trim().split(/\s+/); return routeKey(m, p.join(" ")); }));
    const eps = map.endpoints.filter((e) => wanted.has(routeKey(e.method, e.path)));
    const reach = new Set(eps.map((e) => e.entry));
    const queue = [...reach];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of map.edges) if (e.from === id && !reach.has(e.to)) { reach.add(e.to); queue.push(e.to); }
    }
    map = finish({
      endpoints: eps, nodes: map.nodes.filter((n) => reach.has(n.id)), edges: map.edges.filter((e) => reach.has(e.from)),
      externals: map.externals.filter((x) => reach.has(x.id)),
    });
    const kept = new Set(eps.map((e) => `${e.file}:${e.line}:${e.method}:${e.path}`));
    survey = { ...survey, entries: entries.filter((f) => kept.has(`${f.file}:${f.line}:${f.method}:${f.target || "?"}`)), exits: exits.filter((f) => reach.has(f.node)) };
  }

  const out: DataMap & { survey: Survey } = {
    system: systemName(root),
    language: "TypeScript",
    ...(frameworkOf([...entries, ...exits]) ? { framework: frameworkOf([...entries, ...exits]) } : {}),
    captured: opts.captured ?? "extracted by ccircuit",
    ...map,
    survey,
  };
  return out;
}

function finish(m: { endpoints: Endpoint[]; nodes: DmNode[]; edges: Edge[]; externals: External[] }) {
  const seen = new Set<string>();
  const edges = m.edges.filter((e) => {
    const k = `${e.from}|${e.to}|${e.kind}|${e.queue ?? ""}`;
    return !seen.has(k) && !!seen.add(k);
  });
  return {
    endpoints: m.endpoints,
    nodes: [...m.nodes].sort((a, b) => cmp(a.id, b.id)),
    edges: edges.sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind) || cmp(a.queue ?? "", b.queue ?? "")),
    externals: [...m.externals].sort((a, b) => cmp(a.id, b.id)),
  };
}
