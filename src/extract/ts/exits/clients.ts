import ts from "typescript";
import type { DetectContext, ExitKind, Finding } from "../types.ts";

/**
 * What a value is, as far as exits care: a client of some library, found by import provenance.
 * `lib` names the family. `name` holds the entity, model, table, queue or service, when known.
 * `ctor` marks a class or factory: calling it or `new` on it gives the client.
 */
export interface Client {
  lib: string;
  name?: string;
  resolved?: boolean;
  protocol?: string;
  ctor?: boolean;
  base?: string;
  rule?: string;
}

export interface Site {
  call: ts.CallExpression | ts.TaggedTemplateExpression;
  file: string;
  /** The method called on the client, or "()" when the client itself is called. */
  method: string;
  client: Client;
  recv?: ts.Expression;
  args: readonly ts.Expression[];
}

type Decl = ts.VariableDeclaration | ts.ClassDeclaration | ts.FunctionDeclaration | ts.ParameterDeclaration | ts.EnumDeclaration;
type Binding = { decl: Decl; file: string } | { expr: ts.Expression; file: string } | { pkg: string; name: string } | { ns: string } | { global: string };
interface FileInfo { decls: Map<string, Decl>; defaultExpr?: ts.Expression; imports: Map<string, { spec: string; imported: string }>; reexports: { spec?: string; name?: string; local?: string }[] }

export const unwrap = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
  return e;
};

export const lineOf = (node: ts.Node) => {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
};

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const TRANSPORTS: Record<string, string> = { KAFKA: "kafka", RMQ: "rmq", NATS: "nats", REDIS: "redis", MQTT: "mqtt", TCP: "tcp", GRPC: "grpc" };
const NEST_CLIENT_TYPES: Record<string, string> = { ClientKafka: "kafka", ClientRMQ: "rmq", ClientNats: "nats", ClientRedis: "redis", ClientMqtt: "mqtt", ClientTCP: "tcp", ClientProxy: "nest" };
const AWS_NAMES: Record<string, string> = { ses: "SES", sesv2: "SESv2", s3: "S3", sqs: "SQS", sns: "SNS", dynamodb: "DynamoDB", lambda: "Lambda", eventbridge: "EventBridge", kinesis: "Kinesis", ssm: "SSM", sts: "STS", kms: "KMS", sfn: "SFN", "secrets-manager": "SecretsManager", "cognito-identity-provider": "CognitoIdentityProvider", cloudwatch: "CloudWatch" };

/** Short family key of an import specifier, or undefined for a package exits do not care about. */
function family(spec: string): string | undefined {
  if (spec.startsWith("@aws-sdk/client-")) return "aws3";
  if (spec === "@aws-sdk/lib-dynamodb") return "aws3-doc";
  if (spec === "aws-sdk" || spec.startsWith("aws-sdk/")) return "aws2";
  if (spec.startsWith("@mikro-orm/")) return "mikro";
  if (spec.startsWith("drizzle-orm")) return "drizzle";
  if (spec.startsWith("amqplib")) return "amqplib";
  if (spec === "mysql2" || spec === "mysql2/promise" || spec === "mysql") return "mysql";
  if (spec === "redis" || spec === "@redis/client") return "redis";
  if (spec === "node-fetch" || spec === "cross-fetch" || spec === "isomorphic-fetch") return "fetch";
  if (spec === "sequelize" || spec === "sequelize-typescript") return "sequelize";
  if (spec === "cache-manager" || spec === "@nestjs/cache-manager") return "cache-manager";
  if (spec === "@octokit/rest" || spec === "@octokit/core" || spec === "octokit") return "octokit";
  if (spec === "kysely" || spec === "nestjs-kysely") return "kysely";
  const known = ["axios", "got", "undici", "ioredis", "kafkajs", "pg", "knex", "mongoose", "@prisma/client", "typeorm", "bullmq", "bull", "nats", "keyv", "@nestjs/microservices", "@nestjs/axios", "nodemailer", "google-auth-library"];
  return known.includes(spec) ? spec : undefined;
}

/** The AWS service of an @aws-sdk or aws-sdk import: protocol suffix and display name. */
export function awsService(spec: string, className?: string): { key: string; name: string } {
  if (spec === "@aws-sdk/lib-dynamodb") return { key: "dynamodb", name: "DynamoDB" };
  const key = spec.startsWith("@aws-sdk/client-") ? spec.slice(16) : spec.startsWith("aws-sdk/clients/") ? spec.slice(16) : (className ?? "aws").toLowerCase();
  const name = className?.replace(/Client$/, "") || AWS_NAMES[key] || key.split("-").map(cap).join("");
  return { key, name };
}

const typeArgName = (args?: readonly ts.TypeNode[]) => {
  const a = args?.[0];
  return a && ts.isTypeReferenceNode(a) ? a.typeName.getText() : a?.getText();
};

/** Client for a package export. `asType` reads it as a type annotation, so classes give instances. */
function fromPkg(spec: string, name: string, asType: boolean, typeArgs?: readonly ts.TypeNode[]): Client | undefined {
  // A generated Prisma client, from a `generator client { output }` path that is not in git.
  if (name === "PrismaClient" && (/prisma/i.test(spec) || spec.startsWith("."))) return asType ? { lib: "prisma" } : { lib: "prisma", ctor: true };
  const fam = family(spec);
  if (!fam) return undefined;
  const whole = name === "default" || name === "*";
  const cls = (c: Client): Client => (asType ? c : { ...c, ctor: true });
  switch (fam) {
    case "axios": return whole || name === "axios" || name === "AxiosInstance" || name === "AxiosStatic" ? ({ lib: "axios" }) : undefined;
    case "got": return whole || name === "got" || name === "Got" ? ({ lib: "got" }) : undefined;
    case "fetch": return whole || name === "fetch" ? ({ lib: "fetch" }) : undefined;
    case "undici": return name === "fetch" ? ({ lib: "fetch" }) : name === "request" ? ({ lib: "undici" }) : undefined;
    case "ioredis": return whole || name === "Redis" || name === "Cluster" ? cls({ lib: "ioredis" }) : undefined;
    case "redis": return name === "createClient" || name === "createCluster" ? { lib: "redis", ctor: true } : /^Redis(Client|Cluster)Type$/.test(name) ? ({ lib: "redis" }) : undefined;
    case "kafkajs": return name === "Kafka" ? cls({ lib: "kafkajs" }) : name === "Producer" ? ({ lib: "kafka-producer" }) : undefined;
    case "amqplib":
      if (whole) return ({ lib: "amqp" });
      if (name === "connect") return { lib: "amqp-conn", ctor: true };
      return name === "Channel" || name === "ConfirmChannel" ? ({ lib: "amqp-channel" }) : name === "Connection" || name === "ChannelModel" ? ({ lib: "amqp-conn" }) : undefined;
    case "pg": return ["Pool", "Client", "PoolClient"].includes(name) ? cls({ lib: "pg" }) : undefined;
    case "mysql": return ["createPool", "createConnection", "createPoolCluster"].includes(name) ? { lib: "mysql", ctor: true } : ["Pool", "Connection", "PoolConnection"].includes(name) ? ({ lib: "mysql" }) : undefined;
    case "knex": return whole || name === "knex" ? (asType ? { lib: "knex" } : { lib: "knex", ctor: true }) : name === "Knex" ? ({ lib: "knex" }) : undefined;
    case "drizzle": return name === "drizzle" ? { lib: "drizzle", ctor: true } : /Database$/.test(name) ? ({ lib: "drizzle" }) : undefined;
    case "mongoose": return whole ? ({ lib: "mongoose" }) : name === "model" ? { lib: "mongoose-model", ctor: true } : name === "Model" && asType ? ({ lib: "mongoose-model" }) : undefined;
    case "sequelize": return name === "Sequelize" ? cls({ lib: "sequelize" }) : name === "Model" && asType ? ({ lib: "sequelize-model" }) : undefined;
    case "@prisma/client": return name === "PrismaClient" ? cls({ lib: "prisma" }) : undefined;
    case "typeorm":
      if (["Repository", "MongoRepository", "TreeRepository"].includes(name)) return ({ lib: "typeorm-repo", name: typeArgName(typeArgs), resolved: !!typeArgs?.length });
      return ["EntityManager", "DataSource", "Connection", "MongoEntityManager"].includes(name) ? cls({ lib: "typeorm-em" }) : undefined;
    case "mikro":
      if (name === "EntityRepository" || name === "SqlEntityRepository") return ({ lib: "mikro-repo", name: typeArgName(typeArgs), resolved: !!typeArgs?.length });
      if (name === "EntityManager" || name === "SqlEntityManager") return ({ lib: "mikro-em" });
      if (name === "MikroORM") return cls({ lib: "mikro-root" });
      return /QueryBuilder$/.test(name) ? ({ lib: "mikro-qb" }) : undefined;
    case "bullmq": case "bull": return name === "Queue" || (fam === "bull" && name === "default") ? cls({ lib: "queue", protocol: fam }) : undefined;
    case "aws3": case "aws3-doc":
      if (/Command$/.test(name) || whole || !/^[A-Z]/.test(name) || /(Exception|Input|Output|Config)$/.test(name)) return undefined;
      return cls({ lib: /Client$/.test(name) ? "aws3" : "aws3-agg", name: awsService(spec, name).name, protocol: `aws-${awsService(spec).key}` });
    case "aws2":
      if (spec.startsWith("aws-sdk/clients/")) return name === "default" ? cls({ lib: "aws2", name: awsService(spec).name, protocol: `aws-${awsService(spec).key}` }) : undefined;
      if (whole) return ({ lib: "aws2-mod" });
      return /^[A-Z]/.test(name) ? cls({ lib: "aws2", name, protocol: `aws-${name.toLowerCase()}` }) : undefined;
    case "nats": return name === "connect" ? { lib: "nats", ctor: true } : name === "NatsConnection" ? ({ lib: "nats" }) : undefined;
    case "keyv": return whole || name === "Keyv" ? cls({ lib: "keyv" }) : undefined;
    case "cache-manager": return name === "Cache" ? ({ lib: "cache-manager" }) : name === "createCache" || name === "caching" ? { lib: "cache-manager", ctor: true } : undefined;
    case "@nestjs/microservices":
      if (name === "ClientProxyFactory") return ({ lib: "client-factory" });
      if (name === "ClientGrpc" || name === "ClientGrpcProxy") return ({ lib: "grpc-client" });
      return NEST_CLIENT_TYPES[name] ? ({ lib: "nest-client", protocol: NEST_CLIENT_TYPES[name] }) : undefined;
    case "@nestjs/axios": return name === "HttpService" ? ({ lib: "nest-http" }) : undefined;
    case "nodemailer": return whole ? ({ lib: "nodemailer-mod" }) : name === "createTransport" ? { lib: "nodemailer", ctor: true } : name === "Transporter" ? ({ lib: "nodemailer" }) : undefined;
    case "google-auth-library": return name === "OAuth2Client" ? cls({ lib: "google-oauth" }) : undefined;
    case "octokit": return name === "Octokit" || name === "App" ? cls({ lib: "octokit" }) : undefined;
    case "kysely": return name === "Kysely" || name === "Transaction" ? cls({ lib: "kysely" }) : name === "sql" ? { lib: "kysely-sql" } : undefined;
  }
  return undefined;
}

export interface Resolver {
  clientOf(expr: ts.Expression): Client | undefined;
  /** Folds an expression: the literal when it folds, else its source text. */
  val(expr: ts.Expression | undefined, fallback?: string): { target: string; resolved: boolean };
  /** Finds the expression a name or property stands for: `const x = <init>` and `{ key: <init> }` lookups. */
  initOf(expr: ts.Expression): ts.Expression | undefined;
  prop(obj: ts.Expression | undefined, key: string): ts.Expression | undefined;
  /** An AWS SDK v3 command created with `new XCommand(params)`. */
  commandOf(expr: ts.Expression | undefined): { op: string; spec: string; params?: ts.Expression } | undefined;
  sites(): Site[];
}

const resolvers = new WeakMap<object, Resolver>();

export function resolver(ctx: DetectContext): Resolver {
  let r = resolvers.get(ctx.index);
  if (!r) { r = makeResolver(ctx); resolvers.set(ctx.index, r); }
  return r;
}

function makeResolver({ project, index }: DetectContext): Resolver {
  const infos = new Map<string, FileInfo>();
  const info = (rel: string): FileInfo | undefined => {
    if (infos.has(rel)) return infos.get(rel);
    const f = project.file(rel);
    if (!f) return undefined;
    const out: FileInfo = { decls: new Map(), imports: new Map(), reexports: [] };
    for (const st of f.sf.statements) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.decls.set(d.name.text, d);
      } else if ((ts.isClassDeclaration(st) || ts.isFunctionDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) {
        out.decls.set(st.name.text, st);
        if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) out.decls.set("default", st);
      } else if (ts.isExportAssignment(st)) out.defaultExpr = st.expression;
      else if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        const spec = st.moduleSpecifier.text, c = st.importClause;
        if (c?.name) out.imports.set(c.name.text, { spec, imported: "default" });
        const nb = c?.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) out.imports.set(nb.name.text, { spec, imported: "*" });
        else if (nb) for (const el of nb.elements) out.imports.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text });
      } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference) && ts.isStringLiteral(st.moduleReference.expression)) {
        out.imports.set(st.name.text, { spec: st.moduleReference.expression.text, imported: "*" });
      } else if (ts.isExportDeclaration(st)) {
        const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined;
        const ec = st.exportClause;
        if (!ec) { if (spec) out.reexports.push({ spec }); }
        else if (ts.isNamedExports(ec)) for (const el of ec.elements) out.reexports.push({ spec, name: el.name.text, local: (el.propertyName ?? el.name).text });
        else if (spec) out.reexports.push({ spec, name: ec.name.text });
      }
    }
    infos.set(rel, out);
    return out;
  };

  const importBinding = (file: string, spec: string, imported: string, seen: Set<string>): Binding | undefined => {
    // A known client package stays a package even when the repo holds its source, as the Nest repo does.
    const to = family(spec) ? undefined : project.resolveImport(file, spec);
    if (!to) return { pkg: spec, name: imported };
    return imported === "*" ? { ns: to } : exportOf(to, imported, seen);
  };

  /** What `name` means at the top level of `file`, following imports and re-exports. */
  const exportOf = (file: string, name: string, seen = new Set<string>()): Binding | undefined => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const fi = info(file);
    if (!fi) return undefined;
    const d = fi.decls.get(name);
    if (d) return { decl: d, file };
    if (name === "default" && fi.defaultExpr) return { expr: fi.defaultExpr, file };
    const imp = fi.imports.get(name);
    if (imp) return importBinding(file, imp.spec, imp.imported, seen);
    for (const r of fi.reexports) {
      if (r.name !== undefined && r.name !== name) continue;
      if (r.spec && !project.resolveImport(file, r.spec)) { if (r.name !== undefined) return { pkg: r.spec, name: r.local ?? "*" }; continue; }
      const to = r.spec ? project.resolveImport(file, r.spec)! : file;
      if (r.name === undefined) { const hit = exportOf(to, name, seen); if (hit) return hit; }
      else if (r.local === undefined) return { ns: to };
      else return exportOf(to, r.local, seen);
    }
    return undefined;
  };

  const declIn = (statements: ts.NodeArray<ts.Statement>, name: string): Decl | undefined => {
    for (const st of statements) {
      if (ts.isVariableStatement(st)) { for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return d; }
      else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name) return st;
    }
    return undefined;
  };

  /** Binds a name at a position: parameters and locals of enclosing scopes, then the file's top level. */
  const bind = (name: string, at: ts.Node): Binding | undefined => {
    const file = at.getSourceFile().fileName;
    for (let n: ts.Node | undefined = at.parent; n; n = n.parent) {
      if (ts.isFunctionLike(n)) for (const p of n.parameters) if (ts.isIdentifier(p.name) && p.name.text === name) return { decl: p, file };
      if ((ts.isBlock(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n))) { const d = declIn(n.statements, name); if (d) return { decl: d, file }; }
      if ((ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isForStatement(n)) && n.initializer && ts.isVariableDeclarationList(n.initializer)) {
        for (const d of n.initializer.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return { decl: d, file };
      }
      if (ts.isSourceFile(n)) return exportOf(file, name) ?? { global: name };
    }
    return undefined;
  };

  const importSpec = (name: string, at: ts.Node) => {
    const b = bind(name, at);
    return b && "pkg" in b ? b.pkg : undefined;
  };

  const val = (expr: ts.Expression | undefined, fallback = "?") => {
    if (!expr) return { target: fallback, resolved: false };
    const v = index.resolveValue(expr, expr.getSourceFile().fileName);
    return v !== undefined ? { target: v, resolved: true } : { target: expr.getText(), resolved: false };
  };

  const entityName = (arg: ts.Expression | undefined): { name?: string; resolved: boolean } => {
    if (!arg) return { resolved: false };
    const e = unwrap(arg);
    if (ts.isIdentifier(e)) return { name: e.text, resolved: true };
    if (ts.isPropertyAccessExpression(e) && e.name.text === "name" && ts.isIdentifier(e.expression)) return { name: e.expression.text, resolved: true };
    if (ts.isArrowFunction(e) && !ts.isBlock(e.body)) return entityName(e.body);
    const v = val(e);
    return { name: v.target, resolved: v.resolved };
  };

  const transportOf = (obj: ts.Expression | undefined): string | undefined => {
    const t = obj && ts.isObjectLiteralExpression(unwrap(obj)) ? prop(obj, "transport") : undefined;
    const u = t && unwrap(t);
    return u && ts.isPropertyAccessExpression(u) ? TRANSPORTS[u.name.text] : undefined;
  };

  let registry: Map<string, string> | undefined;
  /** Transport of each Nest client registered by name, from `{ name, transport: Transport.X }` objects. */
  const registered = (token: string) => {
    if (!registry) {
      registry = new Map();
      for (const f of project.files) {
        const visit = (n: ts.Node) => {
          if (ts.isObjectLiteralExpression(n)) {
            const name = prop(n, "name"), t = transportOf(n);
            const v = name && t ? index.resolveValue(name, f.rel) : undefined;
            if (v !== undefined && t) registry!.set(v, t);
          }
          ts.forEachChild(n, visit);
        };
        visit(f.sf);
      }
    }
    return registry.get(token);
  };

  const fromTransport = (t: string | undefined, service?: { name?: string; resolved: boolean }, rule?: string): Client | undefined => {
    if (!t) return undefined;
    if (t === "grpc") return service?.name ? { lib: "grpc-service", name: service.name, resolved: service.resolved, rule } : { lib: "grpc-client", rule };
    return { lib: "nest-client", protocol: t, rule };
  };

  /** Client given by the inject decorators of a constructor parameter or property. */
  const injected = (node: ts.ParameterDeclaration | ts.PropertyDeclaration, typed: Client | undefined): Client | undefined => {
    for (const d of ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : []) {
      const call = ts.isCallExpression(d.expression) ? d.expression : undefined;
      const callee = call ? call.expression : d.expression;
      if (!ts.isIdentifier(callee)) continue;
      const name = callee.text, spec = importSpec(name, node) ?? "", arg = call?.arguments[0];
      if (name === "InjectRepository") { const en = entityName(arg); return { lib: spec.includes("mikro-orm") ? "mikro-repo" : "typeorm-repo", name: en.name, resolved: en.resolved }; }
      if (name === "InjectModel") { const en = entityName(arg); return { lib: spec === "@nestjs/sequelize" ? "sequelize-model" : "mongoose-model", name: en.name, resolved: en.resolved }; }
      if (name === "InjectQueue") { const v = arg ? val(arg) : { target: "default", resolved: true }; return { lib: "queue", protocol: spec === "@nestjs/bull" ? "bull" : "bullmq", name: v.target, resolved: v.resolved }; }
      if (name === "InjectRedis") return { lib: "ioredis" };
      if (name === "InjectKysely") return { lib: "kysely" };
      if (/^Inject(DataSource|EntityManager|Connection)$/.test(name) && spec === "@nestjs/typeorm") return { lib: "typeorm-em" };
      if (name === "Client" && call) return fromTransport(transportOf(arg));
      if (name !== "Inject" || !arg) continue;
      const t = unwrap(arg);
      if (ts.isIdentifier(t) && t.text === "CACHE_MANAGER") return { lib: "cache-manager" };
      if (ts.isCallExpression(t)) {
        const tr = t.arguments.map(unwrap).find((a): a is ts.PropertyAccessExpression => ts.isPropertyAccessExpression(a) && a.expression.getText() === "Transport" && !!TRANSPORTS[a.name.text]);
        const other = t.arguments.find((a) => unwrap(a) !== tr);
        if (tr) return fromTransport(TRANSPORTS[tr.name.text], other ? entityName(other) : undefined, "nest-client-factory");
      }
      const token = index.resolveValue(arg, node.getSourceFile().fileName);
      if (token !== undefined && typed && (typed.lib === "grpc-client" || (typed.lib === "nest-client" && typed.protocol === "nest"))) {
        const via = registered(token);
        if (via) return via === "grpc" ? { lib: "grpc-client" } : { ...typed, protocol: via };
      }
    }
    return undefined;
  };

  const memo = new Map<ts.Node | string, Client | null>();
  const busy = new Set<ts.Node | string>();
  const cached = (key: ts.Node | string, f: () => Client | undefined): Client | undefined => {
    if (memo.has(key)) return memo.get(key) ?? undefined;
    if (busy.has(key)) return undefined;
    busy.add(key);
    const out = f();
    busy.delete(key);
    memo.set(key, out ?? null);
    return out;
  };

  const typeKind = (type: ts.TypeNode | undefined): Client | undefined => {
    if (!type) return undefined;
    if (ts.isUnionTypeNode(type)) { for (const t of type.types) { const k = typeKind(t); if (k) return k; } return undefined; }
    if (!ts.isTypeReferenceNode(type)) return undefined;
    const tn = type.typeName;
    if (ts.isQualifiedName(tn)) {
      let left: ts.EntityName = tn.left;
      while (ts.isQualifiedName(left)) left = left.left;
      const b = bind(left.text, type);
      return b && "pkg" in b ? fromPkg(b.pkg, tn.right.text, true, type.typeArguments) : undefined;
    }
    const b = bind(tn.text, type);
    if (!b) return undefined;
    if ("pkg" in b) return fromPkg(b.pkg, b.name, true, type.typeArguments);
    if ("decl" in b && ts.isClassDeclaration(b.decl)) return classKind(b.decl);
    return undefined;
  };

  /** Client a repo class is, through what it extends: PrismaService extends PrismaClient, UserRepository extends EntityRepository<User>. */
  const classKind = (cls: ts.ClassDeclaration): Client | undefined => cached(cls, () => {
    const h = cls.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    if (!h) return undefined;
    const e = h.expression;
    let b: Binding | undefined;
    let pkgName: string | undefined;
    if (ts.isIdentifier(e)) b = bind(e.text, cls);
    else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) { b = bind(e.expression.text, cls); pkgName = e.name.text; }
    if (!b) return undefined;
    if ("pkg" in b) {
      const k = fromPkg(b.pkg, pkgName ?? b.name, true, h.typeArguments);
      return k?.lib === "sequelize-model" ? { ...k, name: cls.name?.text, resolved: true } : k;
    }
    if ("decl" in b && ts.isClassDeclaration(b.decl)) {
      const k = classKind(b.decl);
      if (!k) return undefined;
      const params = b.decl.typeParameters?.map((p) => p.name.text) ?? [];
      const i = k.name ? params.indexOf(k.name) : -1;
      if (i >= 0 || (k.name === undefined && h.typeArguments?.length)) return { ...k, name: typeArgName(h.typeArguments?.slice(Math.max(i, 0))), resolved: true };
      return k;
    }
    return undefined;
  });

  const enclosingClass = (n: ts.Node): ts.ClassDeclaration | undefined => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isClassDeclaration(p)) return p;
      if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) return undefined;
    }
    return undefined;
  };

  const baseClass = (cls: ts.ClassDeclaration): ts.ClassDeclaration | undefined => {
    const e = cls.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
    const b = e && ts.isIdentifier(e) ? bind(e.text, cls) : undefined;
    return b && "decl" in b && ts.isClassDeclaration(b.decl) ? b.decl : undefined;
  };

  /** Client held by `this.<name>` in a class: initialiser, assignments, constructor parameter, type, then the base class. */
  const fieldKind = (cls: ts.ClassDeclaration, name: string): Client | undefined => cached(`${cls.getSourceFile().fileName}:${cls.pos}:${name}`, () => {
    let prop: ts.PropertyDeclaration | undefined;
    let param: ts.ParameterDeclaration | undefined;
    for (const m of cls.members) {
      if (ts.isPropertyDeclaration(m) && m.name.getText() === name) prop = m;
      if (ts.isConstructorDeclaration(m)) param ??= m.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
    }
    if (prop) {
      const k = injected(prop, typeKind(prop.type)) ?? (prop.initializer && clientOf(prop.initializer));
      if (k) return k;
    }
    let assigned: Client | undefined;
    const visit = (n: ts.Node) => {
      if (assigned) return;
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.expression.kind === ts.SyntaxKind.ThisKeyword && n.left.name.text === name) assigned = clientOf(n.right);
      ts.forEachChild(n, visit);
    };
    for (const m of cls.members) if (!ts.isPropertyDeclaration(m)) visit(m);
    if (assigned) return assigned;
    if (param) { const k = paramKind(param); if (k) return k; }
    if (prop) { const k = typeKind(prop.type); if (k) return k; }
    const base = baseClass(cls);
    return base ? fieldKind(base, name) : undefined;
  });

  const paramKind = (p: ts.ParameterDeclaration): Client | undefined => cached(p, () => {
    const typed = typeKind(p.type);
    return injected(p, typed) ?? typed ?? (p.initializer && clientOf(p.initializer));
  });

  const ofBinding = (b: Binding | undefined, at: ts.Node): Client | undefined => {
    if (!b) return undefined;
    if ("global" in b) return b.global === "fetch" ? { lib: "fetch" } : undefined;
    if ("pkg" in b) return fromPkg(b.pkg, b.name, false);
    if ("ns" in b) return undefined;
    if ("expr" in b) return clientOf(b.expr);
    const d = b.decl;
    if (ts.isParameter(d)) return paramKind(d);
    if (ts.isVariableDeclaration(d)) return cached(d, () => (d.initializer ? clientOf(d.initializer) : undefined) ?? typeKind(d.type));
    if (ts.isClassDeclaration(d)) return classKind(d);
    return undefined;
  };

  const construct = (c: Client, args: readonly ts.Expression[]): Client => {
    const out: Client = { ...c };
    delete out.ctor;
    if (c.lib === "queue" || c.lib === "mongoose-model") { const v = val(args[0]); out.name = v.target; out.resolved = v.resolved; }
    if (c.lib === "nodemailer") { const h = prop(args[0], "host"); if (h) { const v = val(h); out.name = v.target; out.resolved = v.resolved; } }
    if (c.lib === "axios") { const b = prop(args[0], "baseURL"); if (b) out.base = index.resolveValue(b, b.getSourceFile().fileName); }
    return out;
  };

  /** Members that give another client: prisma.user, dataSource.manager, orm.em, db.query.users. */
  const member = (c: Client, name: string): Client | undefined => {
    if (c.ctor) return c.lib === "aws2" ? c : undefined;
    switch (c.lib) {
      case "prisma": return name.startsWith("$") ? undefined : { lib: "prisma-model", name, resolved: true };
      case "typeorm-em": return name === "manager" ? c : undefined;
      case "mikro-root": return name === "em" ? { lib: "mikro-em" } : undefined;
      case "nest-http": return name === "axiosRef" ? { lib: "axios" } : undefined;
      case "drizzle": return name === "query" ? { lib: "drizzle-q" } : undefined;
      case "drizzle-q": return { lib: "drizzle-model", name, resolved: true };
      case "mongoose": return name === "model" ? { lib: "mongoose-model", ctor: true } : undefined;
      case "amqp": return name === "connect" ? { lib: "amqp-conn", ctor: true } : undefined;
      case "aws2-mod": return /^[A-Z]/.test(name) ? { lib: "aws2", name, protocol: `aws-${name.toLowerCase()}`, ctor: true } : undefined;
      case "nodemailer-mod": return name === "createTransport" ? { lib: "nodemailer", ctor: true } : undefined;
      case "octokit": return name === "rest" ? { lib: "octokit-rest" } : undefined;
      case "octokit-rest": return { lib: "octokit-ns", name };
    }
    return undefined;
  };

  /** Client returned by calling `method` on client `c`: axios.create(), kafka.producer(), client.getService('X'). */
  const callResult = (c: Client, method: string, call: ts.CallExpression): Client | undefined => {
    const args = call.arguments;
    if (c.ctor) {
      if ((c.lib === "aws3" || c.lib === "aws3-agg") && method === "from") return construct(c, []);
      if (c.lib === "mikro-root" && method === "init") return construct(c, []);
      return undefined;
    }
    switch (c.lib) {
      case "knex": return method === "()" ? { lib: "knex-query", ...nameOf(args[0]) } : undefined;
      case "axios": return method === "create" ? construct(c, args) : undefined;
      case "got": return method === "extend" ? c : undefined;
      case "kafkajs": return method === "producer" ? { lib: "kafka-producer" } : undefined;
      case "kafka-producer": return method === "transaction" ? c : undefined;
      case "amqp-conn": return method === "createChannel" || method === "createConfirmChannel" ? { lib: "amqp-channel" } : undefined;
      case "pg": case "mysql": return method === "connect" || method === "getConnection" ? c : undefined;
      case "grpc-client": return method === "getService" ? { lib: "grpc-service", ...nameOf(args[0]), rule: c.rule } : undefined;
      case "typeorm-em": return /^get(Mongo|Tree)?Repository$|^withRepository$/.test(method) ? { lib: "typeorm-repo", ...entityName(args[0]) } : undefined;
      case "mikro-em": return method === "getRepository" ? { lib: "mikro-repo", ...entityName(args[0]) } : method === "fork" || method === "persist" || method === "remove" ? c : undefined;
      case "mikro-repo": return method === "getEntityManager" ? { lib: "mikro-em" } : undefined;
      case "client-factory": return method === "create" ? fromTransport(transportOf(args[0])) : undefined;
      case "prisma": return method === "$extends" ? c : undefined;
    }
    return undefined;
  };
  const nameOf = (e: ts.Expression | undefined) => { const v = val(e); return { name: v.target, resolved: v.resolved }; };

  const clientOf = (expr: ts.Expression): Client | undefined => {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) return cached(e, () => ofBinding(bind(e.text, e), e));
    if (e.kind === ts.SyntaxKind.ThisKeyword) { const cls = enclosingClass(e); return cls && classKind(cls); }
    if (ts.isPropertyAccessExpression(e)) return cached(e, () => {
      const name = e.name.text, obj = unwrap(e.expression);
      if (obj.kind === ts.SyntaxKind.ThisKeyword) {
        const cls = enclosingClass(obj);
        if (!cls) return undefined;
        const f = fieldKind(cls, name);
        if (f) return f;
        const self = classKind(cls);
        return self && member(self, name);
      }
      if (ts.isIdentifier(obj)) {
        const b = bind(obj.text, obj);
        if (b && "ns" in b) return ofBinding(exportOf(b.ns, name), e);
        if (b && "pkg" in b && (b.name === "*" || b.name === "default")) { const k = fromPkg(b.pkg, name, false); if (k) return k; }
      }
      const base = clientOf(obj);
      return base && member(base, name);
    });
    if (ts.isNewExpression(e)) return cached(e, () => { const c = clientOf(e.expression); return c?.ctor ? construct(c, e.arguments ?? []) : undefined; });
    if (ts.isTaggedTemplateExpression(e) && ts.isIdentifier(e.tag)) return clientOf(e.tag)?.lib === "kysely-sql" ? { lib: "kysely-raw" } : undefined;
    if (ts.isCallExpression(e)) return cached(e, () => {
      const callee = unwrap(e.expression);
      if (ts.isIdentifier(callee) && callee.text === "require" && e.arguments[0] && ts.isStringLiteral(e.arguments[0])) return fromPkg(e.arguments[0].text, "*", false);
      const f = clientOf(callee);
      if (f?.ctor) return construct(f, e.arguments);
      if (ts.isPropertyAccessExpression(callee)) { const r = clientOf(callee.expression); return r && callResult(r, callee.name.text, e); }
      return f && callResult(f, "()", e);
    });
    return undefined;
  };

  const initOf = (expr: ts.Expression): ts.Expression | undefined => {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) {
      const b = bind(e.text, e);
      return b && "decl" in b && ts.isVariableDeclaration(b.decl) && b.decl.initializer ? b.decl.initializer : undefined;
    }
    return undefined;
  };

  const prop = (obj: ts.Expression | undefined, key: string): ts.Expression | undefined => {
    if (!obj) return undefined;
    let o = unwrap(obj);
    for (let i = 0; i < 5 && !ts.isObjectLiteralExpression(o); i++) { const n = initOf(o); if (!n) return undefined; o = unwrap(n); }
    if (!ts.isObjectLiteralExpression(o)) return undefined;
    for (const p of [...o.properties].reverse()) {
      if (ts.isPropertyAssignment(p) && p.name.getText().replace(/^['"]|['"]$/g, "") === key) return p.initializer;
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) return p.name;
    }
    return undefined;
  };

  const commandOf = (expr: ts.Expression | undefined, depth = 0): { op: string; spec: string; params?: ts.Expression } | undefined => {
    if (!expr || depth > 5) return undefined;
    const e = unwrap(expr);
    if (ts.isNewExpression(e) && ts.isIdentifier(e.expression)) {
      const b = bind(e.expression.text, e);
      if (b && "pkg" in b && (family(b.pkg) === "aws3" || family(b.pkg) === "aws3-doc") && /Command$/.test(b.name)) return { op: b.name.replace(/Command$/, ""), spec: b.pkg, params: e.arguments?.[0] };
      return undefined;
    }
    const init = initOf(e);
    return init && commandOf(init, depth + 1);
  };

  let all: Site[] | undefined;
  const sites = (): Site[] => {
    if (all) return all;
    all = [];
    for (const f of project.files) {
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
          const callee = unwrap(n.expression);
          if (ts.isPropertyAccessExpression(callee)) {
            const method = callee.name.text;
            const c = clientOf(callee.expression) ?? (method === "send" && commandOf(n.arguments[0]) ? { lib: "aws3-any" } : undefined);
            if (c && !c.ctor) all!.push({ call: n, file: f.rel, method, client: c, recv: callee.expression, args: n.arguments });
          } else {
            const c = clientOf(callee);
            if (c && !c.ctor) all!.push({ call: n, file: f.rel, method: "()", client: c, args: n.arguments });
          }
        } else if (ts.isTaggedTemplateExpression(n) && ts.isPropertyAccessExpression(n.tag)) {
          const c = clientOf(n.tag.expression);
          if (c && !c.ctor) all!.push({ call: n, file: f.rel, method: n.tag.name.text, client: c, recv: n.tag.expression, args: [n.template] });
        }
        ts.forEachChild(n, visit);
      };
      visit(f.sf);
    }
    return all;
  };

  return { clientOf, val, initOf, prop, commandOf, sites };
}

export interface Hit { kind: ExitKind; protocol: string; method: string; target: string; resolved: boolean; rule: string; detail?: string; node?: ts.Node }

/** Builds a finding for a site; the owner and line come from the call, or from `hit.node` when given. */
export function finding(ctx: DetectContext, site: Site, hit: Hit): Finding {
  const node = hit.node ?? site.call;
  const owner = ctx.index.ownerOf(site.file, node);
  const f: Finding = {
    direction: "exit", kind: hit.kind, protocol: hit.protocol, method: hit.method, target: hit.target, resolved: hit.resolved,
    module: ctx.project.file(site.file)?.module ?? ".", file: site.file, line: lineOf(node), symbol: owner.symbol, node: owner.id, rule: hit.rule,
  };
  if (hit.detail) f.detail = hit.detail;
  return f;
}

/** A detector over the shared call sites: `match` returns the hits for one site. */
export function siteDetector(name: string, match: (site: Site, r: Resolver, ctx: DetectContext) => Hit | Hit[] | undefined) {
  return {
    name,
    detect(ctx: DetectContext): Finding[] {
      const r = resolver(ctx);
      const out: Finding[] = [];
      for (const s of r.sites()) {
        const h = match(s, r, ctx);
        for (const hit of h === undefined ? [] : Array.isArray(h) ? h : [h]) out.push(finding(ctx, s, hit));
      }
      return out;
    },
  };
}
