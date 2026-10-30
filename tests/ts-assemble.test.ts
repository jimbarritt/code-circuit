import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateDataMap } from "../src/datamap.ts";
import { extractTypeScript } from "../src/extract/ts/assemble.ts";

const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ccircuit-assemble-"));
  made.push(root);
  for (const [rel, text] of Object.entries({ "package.json": '{"name":"app"}', ...files })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

describe("fixtures", () => {
  for (const name of ["ts-shop", "ts-plain"]) {
    test(`${name}: the map validates and every EXPECTED link is an edge`, () => {
      const map = extractTypeScript(fixture(name));
      expect(validateDataMap(map)).toEqual([]);
      const expected = JSON.parse(readFileSync(join(fixture(name), "EXPECTED.json"), "utf8"));
      const findings = [...map.survey.entries, ...map.survey.exits];
      const nodeOf = (symbol: string) => findings.find((f) => f.symbol === symbol)?.node;
      for (const l of expected.links) {
        const from = nodeOf(l.from_symbol), to = nodeOf(l.to_symbol);
        expect(from && to).toBeTruthy();
        const edge = map.edges.find((e) => e.from === from && e.to === to && e.kind === l.kind && (l.kind === "sync" || e.queue === l.via));
        expect(edge ? `${l.from_symbol} -> ${l.to_symbol}` : `missing ${l.from_symbol} -> ${l.to_symbol} via ${l.via}`).toBe(`${l.from_symbol} -> ${l.to_symbol}`);
      }
      expect(map.endpoints.length).toBe(map.survey.entries.length);
      expect(map.language).toBe("TypeScript");
      expect(map.system).toBe(name);
      expect(map.survey.modules).toEqual(expected.modules);
    });
  }

  test("ts-shop: nodes, kinds, edges and externals", () => {
    const map = extractTypeScript(fixture("ts-shop"));
    const kind = (id: string) => map.nodes.find((n) => n.id === id)?.kind;
    expect(map.framework).toBe("NestJS");
    expect(kind("@shop/orders-api:OrdersController")).toBe("controller");
    expect(kind("@shop/orders-api:OrdersResolver")).toBe("resolver");
    expect(kind("@shop/orders-api:OrdersGateway")).toBe("gateway");
    expect(kind("@shop/orders-api:OrdersService")).toBe("service");
    expect(kind("@shop/orders-api:InventoryClient")).toBe("client");
    expect(kind("@shop/mailer-worker:EmailProcessor")).toBe("worker");
    expect(map.nodes.find((n) => n.id === "@shop/mailer-worker:EmailProcessor")?.queue).toBe("emails");
    for (const n of map.nodes) expect(typeof n.module).toBe("string");
    expect(map.edges).toContainEqual({ from: "@shop/orders-api:OrdersController", to: "@shop/orders-api:OrdersService", kind: "sync", rule: "di-call" });
    expect(map.edges).toContainEqual({ from: "@shop/orders-api:InventoryClient", to: "@shop/inventory-svc:InventoryController", kind: "sync", rule: "grpc-call" });
    expect(map.edges).toContainEqual({ from: "@shop/orders-api:OrdersService", to: "database:typeorm", kind: "io", rule: "typeorm-repository" });
    expect(map.externals).toContainEqual({ id: "cloud:aws-ses", name: "AWS SES", kind: "cloud", protocol: "aws-ses" });
    expect(map.externals.map((x) => x.id)).toContain("database:prisma");
    // a matched producer links to its consumer, not to an external
    expect(map.externals.map((x) => x.id)).not.toContain("message-out:kafka");
    const ep = map.endpoints.find((e) => e.path === "/api/orders/:id" && e.method === "GET")!;
    expect(ep).toMatchObject({ entry: "@shop/orders-api:OrdersController", kind: "http", protocol: "nest", module: "@shop/orders-api", file: "services/orders-api/src/orders/orders.controller.ts", line: 14 });
    expect(map.survey.modules).toEqual(JSON.parse(readFileSync(join(fixture("ts-shop"), "EXPECTED.json"), "utf8")).modules);
  });

  test("the output is the same on every run", () => {
    expect(JSON.stringify(extractTypeScript(fixture("ts-shop")))).toBe(JSON.stringify(extractTypeScript(fixture("ts-shop"))));
  });

  test("--include keeps the matching endpoints and what they reach", () => {
    const map = extractTypeScript(fixture("ts-shop"), { include: ["GET /api/orders/:orderId"] });
    expect(validateDataMap(map)).toEqual([]);
    expect(map.endpoints.map((e) => e.id)).toEqual(["@shop/orders-api:GET:/api/orders/:id"]);
    const ids = map.nodes.map((n) => n.id);
    expect(ids).toContain("@shop/orders-api:OrdersService");
    expect(ids).toContain("@shop/inventory-svc:InventoryController");
    expect(ids).not.toContain("@shop/orders-api:OrdersResolver");
    expect(map.survey.entries.length).toBe(1);
  });
});

test("an injected dependency that is never called makes no node and no edge", () => {
  const root = repo({
    "src/a.controller.ts": `import { Controller, Get } from "@nestjs/common";
import { UsedService } from "./used.service";
import { UnusedService } from "./unused.service";
@Controller("a")
export class AController {
  constructor(private readonly used: UsedService, private readonly unused: UnusedService) {}
  @Get() list() { return this.used.all(); }
}`,
    "src/used.service.ts": `export class UsedService { all() { return []; } }`,
    "src/unused.service.ts": `export class UnusedService { other() { return 1; } }`,
  });
  const map = extractTypeScript(root);
  expect(validateDataMap(map)).toEqual([]);
  expect(map.nodes.map((n) => n.id)).toEqual(["app:AController", "app:UsedService"]);
  expect(map.edges).toEqual([{ from: "app:AController", to: "app:UsedService", kind: "sync", rule: "di-call" }]);
  expect(map.endpoints).toEqual([{ id: "app:GET:/a", method: "GET", path: "/a", entry: "app:AController", kind: "http", protocol: "nest", module: "app", file: "src/a.controller.ts", line: 7 }]);
});

test("the system name falls back to the directory name", () => {
  const root = repo({ "package.json": "{}", "src/x.ts": "export const x = 1;" });
  const map = extractTypeScript(root);
  expect(map.system).toBe(root.split("/").pop()!);
  expect(map.framework).toBeUndefined();
  expect(map.endpoints).toEqual([]);
});

test("provider bindings, abstract classes, inherited dependencies and calls make di-call edges", () => {
  const root = repo({
    "src/mail.ts": `import { Controller, Get } from "@nestjs/common";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import Redis from "ioredis";
export abstract class AbstractMail { abstract send(): void; }
export class SmtpMail extends AbstractMail { send() { this.redis.get('k'); } constructor(private redis: Redis) { super(); } }
export abstract class AbstractStore { abstract put(): void; }
export class S3Store extends AbstractStore { put() { this.cache.set('a', 'b'); } constructor(private cache: Redis) { super(); } }
export class SesStore extends AbstractStore { put() { new SESClient({}).send(new SendEmailCommand({})); } }
export class MailModule { static providers = [{ provide: AbstractMail, useClass: SmtpMail }]; }
export class BaseService {
  constructor(protected mail: AbstractMail, protected store: AbstractStore, protected logger: AppLogger) {}
  protected notify() { this.mail.send(); this.logger.log('x'); }
}
export class AppLogger { log(m: string) {} }
@Controller("a")
export class AController extends BaseService {
  @Get() list() { this.notify(); this.store.put(); }
}`,
  });
  const map = extractTypeScript(root);
  expect(validateDataMap(map)).toEqual([]);
  expect(map.edges.filter((e) => e.kind === "sync")).toEqual([
    { from: "app:AController", to: "app:S3Store", kind: "sync", rule: "di-call" },
    { from: "app:AController", to: "app:SesStore", kind: "sync", rule: "di-call" },
    { from: "app:AController", to: "app:SmtpMail", kind: "sync", rule: "di-call" },
  ]);
});

test("ORM handle classes make no di-call for ORM methods, and plain function calls make fn-call edges", () => {
  const root = repo({
    "src/prisma.service.ts": `import { PrismaClient } from "@prisma/client";
export class PrismaService extends PrismaClient {}`,
    "src/users.repo.ts": `import { EntityRepository } from "@mikro-orm/core";
export class UsersRepo extends EntityRepository<User> { custom() { return this.em.find(User, {}); } }`,
    "src/a.controller.ts": `import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { UsersRepo } from "./users.repo";
import { publish } from "./kafka";
@Controller("a")
export class AController {
  constructor(private prisma: PrismaService, private users: UsersRepo) {}
  @Get() list() { this.prisma.user.findMany(); this.users.findOne({}); this.users.custom(); publish(); }
}`,
    "src/kafka.ts": `import { Kafka } from "kafkajs";
const producer = new Kafka({}).producer();
export async function publish() { await producer.send({ topic: "t", messages: [] }); }`,
  });
  const map = extractTypeScript(root);
  expect(validateDataMap(map)).toEqual([]);
  expect(map.edges.filter((e) => e.kind === "sync")).toEqual([
    { from: "app:AController", to: "app:UsersRepo", kind: "sync", rule: "di-call" },
    { from: "app:AController", to: "app:src/kafka.ts#publish", kind: "sync", rule: "fn-call" },
  ]);
  expect(map.edges).toContainEqual({ from: "app:AController", to: "database:prisma", kind: "io", rule: "prisma-model" });
});

test("async links need a compatible transport, and a topic passed to a wrapper links from the caller", () => {
  const root = repo({
    "src/main.ts": `import { NestFactory } from "@nestjs/core";
import { Transport } from "@nestjs/microservices";
async function boot() { await NestFactory.createMicroservice(M, { transport: Transport.NATS }); }`,
    "src/topics.ts": `export const TOPICS = { DONE: "job.done" } as const;`,
    "src/consumer.ts": `import { Controller } from "@nestjs/common";
import { EventPattern } from "@nestjs/microservices";
@Controller()
export class NatsConsumer { @EventPattern("job.done") done() {} @EventPattern("job.mqtt") m() {} }`,
    "src/producer.service.ts": `import { Inject } from "@nestjs/common";
import { ClientProxy, ClientProxyFactory, Transport } from "@nestjs/microservices";
export class ProducerService {
  private client = ClientProxyFactory.create({ transport: Transport.NATS });
  private mqtt: ClientProxy;
  constructor() { this.mqtt = ClientProxyFactory.create({ transport: Transport.MQTT }); }
  emitMessage(topic: string, msg: unknown) { return this.client.emit(topic, msg); }
  other() { this.mqtt.emit("job.mqtt", {}); }
}`,
    "src/caller.service.ts": `import { ProducerService } from "./producer.service";
import { TOPICS } from "./topics";
export class CallerService {
  constructor(private producer: ProducerService) {}
  run() { this.producer.emitMessage(TOPICS.DONE, {}); }
}`,
  });
  const map = extractTypeScript(root);
  expect(validateDataMap(map)).toEqual([]);
  expect(map.edges.filter((e) => e.kind === "async")).toEqual([
    { from: "app:CallerService", to: "app:NatsConsumer", kind: "async", queue: "job.done", rule: "nest-client-proxy-via-wrapper" },
  ]);
  expect(map.edges).toContainEqual({ from: "app:ProducerService", to: "message-out:mqtt", kind: "io", rule: "nest-client-proxy" });
});
