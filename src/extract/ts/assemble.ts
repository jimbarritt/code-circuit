import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DataMap, DmNode, Edge, Endpoint, External } from "../../datamap.ts";
import { routeKey } from "../routes.ts";
import { ENTRY_DETECTORS } from "./entries/index.ts";
import { EXIT_DETECTORS } from "./exits/index.ts";
import { loadProject } from "./project.ts";
import { buildIndex } from "./symbols.ts";
import type { ClassSym, Finding } from "./types.ts";

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
  grpc: "gRPC", "nest-http": "Nest HttpService", "google-oauth2": "Google OAuth2",
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

  // ---- nodes: finding owners, then every class they call ----
  const owners = new Map<string, Finding>();
  for (const f of [...entries, ...exits]) if (!owners.has(f.node)) owners.set(f.node, f);
  const keep = new Set(owners.keys());
  const work = [...keep].filter((id) => index.classById.has(id));
  const sync: Edge[] = [];
  while (work.length) {
    const c = index.classById.get(work.shift()!)!;
    const deps = new Map(c.deps.map((d) => [d.param, d.classId]));
    for (const m of c.methods) for (const call of m.calls) {
      const to = deps.get(call.dep);
      if (!to || to === c.id || !index.classById.has(to)) continue;
      sync.push({ from: c.id, to, kind: "sync", rule: "di-call" });
      if (!keep.has(to)) { keep.add(to); work.push(to); }
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
  const consumers = (f: Finding) => entries.filter((e) =>
    f.kind === "grpc-out" ? e.kind === "grpc" && grpcKey(e.target) === grpcKey(f.target)
      : e.kind === (f.kind === "message-out" ? "message" : "queue") && f.resolved && e.resolved && e.target === f.target);
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
