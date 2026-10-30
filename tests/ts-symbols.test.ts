import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { loadProject } from "../src/extract/ts/project.ts";
import { buildIndex } from "../src/extract/ts/symbols.ts";

const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function load(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "ccircuit-sym-"));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  const project = loadProject(root);
  return { project, index: buildIndex(project) };
}

/** Finds the initializer of `const <name>` in a file, for resolveValue tests. */
function init(project: ReturnType<typeof loadProject>, rel: string, name: string): ts.Expression {
  for (const st of project.file(rel)!.sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return d.initializer!;
  }
  throw new Error(`no ${name}`);
}

const NEST = {
  "package.json": JSON.stringify({ name: "shop", workspaces: ["apps/*", "libs/*"] }),
  "libs/core/package.json": JSON.stringify({ name: "@shop/core" }),
  "libs/core/src/index.ts": "export * from './redis/redis.service';\nexport { MailService as Mailer } from './mail';",
  "libs/core/src/redis/redis.service.ts": "@Injectable()\nexport class RedisService {\n  get(k: string) {}\n}",
  "libs/core/src/mail.ts": "export class MailService {}",
  "apps/api/package.json": JSON.stringify({ name: "api" }),
  "apps/api/src/user.repo.ts": "export class UserRepo {}",
  "apps/api/src/tokens.ts": "export const QUEUE = 'emails';",
  "apps/api/src/user.controller.ts": `import { Controller, Get, Inject } from '@nestjs/common';
import { RedisService, Mailer } from '@shop/core';
import { UserRepo } from './user.repo';
import { QUEUE } from './tokens';

@Controller('users')
export class UserController extends BaseController {
  constructor(
    private readonly redis: RedisService,
    private readonly repo: UserRepo,
    private mailer: Mailer,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectQueue(QUEUE) private queue: Queue,
    @Inject('CONFIG') private config: AppConfig,
    @InjectEntityManager() private em: EntityManager,
    plain: string,
  ) {}

  @Get(':id')
  async find(id: string) {
    const v = await this.redis.get(id);
    this.users.qb.getOne(id);
    this.helper();
    return [1].map(() => this.repo.load(id));
  }

  handle = async () => { await this.queue.add('job', {}); };

  private helper() {}
}

export function topLevel() { return 1; }
export const arrow = () => 2;
const notFn = 3;
`,
};

test("classes carry decorators, deps with folded tokens and class ids, methods and calls", () => {
  const { index } = load(NEST);
  const c = index.classById.get("api:UserController")!;
  expect(c.file).toBe("apps/api/src/user.controller.ts");
  expect(c.line).toBe(7);
  expect(c.extends).toBe("BaseController");
  expect(c.decorators.map((d) => `${d.name}:${d.args.length}@${d.line}`)).toEqual(["Controller:1@6"]);
  expect(c.deps.map((d) => [d.param, d.typeName, d.injectedBy, d.token, d.classId])).toEqual([
    ["redis", "RedisService", undefined, undefined, "@shop/core:RedisService"],
    ["repo", "UserRepo", undefined, undefined, "api:UserRepo"],
    ["mailer", "Mailer", undefined, undefined, "@shop/core:MailService"],
    ["users", "Repository<User>", "InjectRepository", "User", undefined],
    ["queue", "Queue", "InjectQueue", "emails", undefined],
    ["config", "AppConfig", "Inject", "CONFIG", undefined],
    ["em", "EntityManager", "InjectEntityManager", undefined, undefined],
  ]);
  expect(c.methods.map((m) => m.name)).toEqual(["find", "handle", "helper"]);
  const find = c.methods[0]!;
  expect(find.decorators.map((d) => d.name)).toEqual(["Get"]);
  expect(find.calls.map((x) => `${x.dep}.${x.method}@${x.line}`)).toEqual(["redis.get@21", "users.getOne@22", "repo.load@24"]);
  expect(c.methods[1]!.calls.map((x) => `${x.dep}.${x.method}`)).toEqual(["queue.add"]);
  expect(index.functions.map((f) => f.id)).toEqual(["api:apps/api/src/user.controller.ts#topLevel", "api:apps/api/src/user.controller.ts#arrow"]);
  expect(index.classesByName.get("RedisService")!.map((x) => x.id)).toEqual(["@shop/core:RedisService"]);
});

test("ownerOf names the enclosing method, function or file", () => {
  const { project, index } = load(NEST);
  const rel = "apps/api/src/user.controller.ts";
  const c = index.classById.get("api:UserController")!;
  expect(index.ownerOf(rel, c.methods[0]!.calls[0]!.node)).toEqual({ id: "api:UserController", symbol: "UserController.find" });
  expect(index.ownerOf(rel, c.methods[1]!.calls[0]!.node)).toEqual({ id: "api:UserController", symbol: "UserController.handle" });
  const fn = index.functions[1]!;
  expect(index.ownerOf(rel, fn.node.getChildAt(0))).toEqual({ id: fn.id, symbol: "arrow" });
  expect(index.ownerOf(rel, init(project, rel, "notFn"))).toEqual({ id: `api:${rel}`, symbol: rel });
});

test("resolveValue folds literals, templates, +, consts, enums and const objects across imports", () => {
  const { project, index } = load({
    "src/topics.ts": `export const PREFIX = 'shop';
export enum Topic { Created = 'user.created', Deleted = \`user.\${'deleted'}\` }
export enum Level { Low, High = 10, Higher }
export const TOPICS = { USER: { CREATED: PREFIX + '.user.created' }, PLAIN: 'plain' } as const;
const local = 'x';
export { local as aliased };
`,
    "src/index.ts": "export * from './topics';\nexport * as ns from './topics';",
    "src/use.ts": `import { PREFIX, Topic, TOPICS, aliased, Level } from './index';
import * as T from './topics';
import { ns } from './index';
const SUFFIX = 'v1';
let mutable = 'no';
const a = 'lit';
const b = \`\${PREFIX}.\${SUFFIX}\`;
const c = PREFIX + '-' + SUFFIX;
const d = Topic.Created;
const e = Topic.Deleted;
const f = TOPICS.USER.CREATED;
const g = (TOPICS.PLAIN as string);
const h = T.TOPICS['PLAIN'];
const i = aliased;
const j = mutable;
const k = process.env.TOPIC;
const l = \`\${unknownThing}\`;
const m = Level.Higher;
const n = ns.Topic.Created;
const o = 42;
`,
  });
  const got = Object.fromEntries("abcdefghijklmno".split("").map((n) => [n, index.resolveValue(init(project, "src/use.ts", n), "src/use.ts")]));
  expect(got).toEqual({
    a: "lit", b: "shop.v1", c: "shop-v1", d: "user.created", e: "user.deleted", f: "shop.user.created", g: "plain",
    h: "plain", i: "x", j: undefined, k: undefined, l: undefined, m: "11", n: "user.created", o: "42",
  });
});

const EXAMPLE = "/home/user/examples/nest-turbo-starter";

test.skipIf(!existsSync(EXAMPLE))("the nest-turbo-starter example folds gRPC service names through barrel files", () => {
  const index = buildIndex(loadProject(EXAMPLE));
  const consumer = index.classById.get("user-service:UserConsumer")!;
  const grpc = consumer.methods.flatMap((m) => m.decorators.filter((d) => d.name === "GrpcMethod").map((d) => d.args.map((a) => index.resolveValue(a, consumer.file)).join("/")));
  expect(grpc).toContain("UserService/CreateUser");
  const auth = index.classById.get("auth-service:AuthService")!;
  expect(auth.deps.find((d) => d.param === "redisService")?.classId).toBe("@app/core:RedisService");
});
