import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ENTRY_DETECTORS } from "../src/extract/ts/entries/index.ts";
import { loadProject } from "../src/extract/ts/project.ts";
import { buildIndex } from "../src/extract/ts/symbols.ts";
import type { Finding } from "../src/extract/ts/types.ts";

const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function entries(root: string): Finding[] {
  const project = loadProject(root);
  const ctx = { project, index: buildIndex(project) };
  return ENTRY_DETECTORS.flatMap((d) => d.detect(ctx));
}

function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "ccircuit-entries-"));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const key = (f: Pick<Finding, "direction" | "kind" | "protocol" | "method" | "target" | "file" | "line">) =>
  [f.direction, f.kind, f.protocol, f.method, f.target, f.file, f.line].join(" | ");
const short = (fs: Finding[]) => fs.map((f) => `${f.method} ${f.target}${f.resolved ? "" : " ?"} ${f.symbol}`).sort();

for (const name of ["ts-shop", "ts-plain"]) {
  test(`entries of the ${name} fixture match EXPECTED.json`, () => {
    const root = join(import.meta.dir, "fixtures", name);
    const expected = JSON.parse(readFileSync(join(root, "EXPECTED.json"), "utf8")).entries as Finding[];
    const found = entries(root);
    expect(found.map(key).sort()).toEqual(expected.map(key).sort());
    const extra = (fs: Pick<Finding, "symbol" | "resolved" | "module">[]) => fs.map((f, i) => `${key(fs[i] as Finding)} | ${f.symbol} | ${f.resolved} | ${f.module}`).sort();
    expect(extra(found)).toEqual(extra(expected));
    expect(found.every((f) => f.rule && f.node)).toBe(true);
  });
}

test("a named handler owns its route, even when imported from another file", () => {
  const found = entries(join(import.meta.dir, "fixtures", "ts-plain"));
  expect(found.find((f) => f.target === "every 10000ms")?.node).toMatch(/:jobs\/src\/outbox\.ts#pollOutbox$/);
  expect(found.find((f) => f.target === "/users/search")?.node).toMatch(/:gateway\/src\/routes\/users\.ts#searchUsers$/);
});

test("Nest controllers: prefix forms, URI versioning and a global prefix", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "app" }),
    "src/main.ts": `import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('/api/');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}`,
    "src/paths.ts": "export const ROUTES = { USERS: 'users' } as const;",
    "src/a.controller.ts": `import { Controller, Get, Post, All, Version } from '@nestjs/common';
import { ROUTES } from './paths';
@Controller(ROUTES.USERS)
export class A {
  @Get() list() {}
  @Version('2') @Post(':id') make() {}
  @All(['x', 'y']) any() {}
}
@Controller({ path: 'b', version: ['3', '4'] })
export class B { @Get('/z/') z() {} }
@Controller(['c', 'd'])
export class C { @Get(process.env.P) p() {} }`,
    "src/not-nest.ts": `import { Controller, Get } from './my-decorators';
@Controller('no') export class N { @Get('no') n() {} }`,
  });
  expect(short(entries(root))).toEqual([
    "ALL /api/v1/users/x A.any", "ALL /api/v1/users/y A.any",
    "GET /api/v1/c/process.env.P ? C.p", "GET /api/v1/d/process.env.P ? C.p",
    "GET /api/v1/users A.list", "GET /api/v3/b/z B.z", "GET /api/v4/b/z B.z", "POST /api/v2/users/:id A.make",
  ]);
});

test("gRPC, GraphQL, WebSocket and Nest message handlers", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "svc" }),
    "src/main.ts": `import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, { transport: Transport.RMQ, options: { queue: 'q' } });
}`,
    "src/h.ts": `import { GrpcMethod, GrpcStreamMethod, MessagePattern, EventPattern, Transport } from '@nestjs/microservices';
import { Resolver, Query, Mutation, Subscription } from '@nestjs/graphql';
import { WebSocketGateway, SubscribeMessage } from '@nestjs/websockets';
export class Hero {
  @GrpcMethod('HeroService') findOne() {}
  @GrpcMethod() kill() {}
  @GrpcStreamMethod('HeroService', 'Watch') watch() {}
  @MessagePattern({ cmd: 'sum' }) sum() {}
  @EventPattern('hero.born') born() {}
  @EventPattern('hero.died', Transport.KAFKA) died() {}
}
@Resolver()
export class R {
  @Query('heroes') all() {}
  @Mutation(() => Boolean, { name: 'kill' }) k() {}
  @Subscription(() => Hero) heroAdded() {}
}
@WebSocketGateway(81)
export class G { @SubscribeMessage('events') ev() {} }`,
  });
  expect(short(entries(root))).toEqual([
    "GRAPHQL Mutation.kill R.k", "GRAPHQL Query.heroes R.all", "GRAPHQL Subscription.heroAdded R.heroAdded",
    "GRPC Hero/Kill Hero.kill", "GRPC HeroService/FindOne Hero.findOne", "GRPC HeroService/Watch Hero.watch",
    "KAFKA hero.died Hero.died", "RMQ hero.born Hero.born", "RMQ { cmd: 'sum' } ? Hero.sum", "WS events G.ev",
  ]);
});

test("Nest message handlers in a module with no known transport use MESSAGE", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "svc" }),
    "src/h.ts": "import { EventPattern } from '@nestjs/microservices';\nexport class H { @EventPattern('x') x() {} }",
  });
  const [f] = entries(root);
  expect([f!.method, f!.protocol, f!.target]).toEqual(["MESSAGE", "nest", "x"]);
});

test("express, fastify, koa and hono routes follow mounts across files", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "web" }),
    "src/server.ts": `import express from 'express';
import users from './users';
import { makeAdmin } from './admin';
const app = express();
const api = express.Router();
app.use('/api', api);
api.use('/users', users);
api.use('/admin', auth, makeAdmin());
app.route('/book').get(getBook).post((req, res) => {});
app.get('env');
function getBook() {}`,
    "src/users.ts": `import { Router } from 'express';
const r = Router();
r.get('/:id', async (req, res) => {});
export default r;`,
    "src/admin.ts": `import { Router } from 'express';
export function makeAdmin() {
  const r = Router();
  r.delete('/cache', clear);
  return r;
}
function clear() {}`,
    "src/fast.ts": `import Fastify, { FastifyInstance } from 'fastify';
const app = Fastify();
app.register(plugin, { prefix: '/v1' });
async function plugin(f: FastifyInstance) {
  f.get('/ping', { schema: {} }, async () => 'pong');
  f.route({ method: ['GET', 'HEAD'], url: '/items', handler: items });
}
function items() {}`,
    "src/koa.ts": `import Router from '@koa/router';
const outer = new Router({ prefix: '/k' });
const inner = new Router();
inner.put('/thing', async (ctx) => {});
outer.use('/in', inner.routes());`,
    "src/hono.ts": `import { Hono } from 'hono';
const app = new Hono().basePath('/h');
const books = new Hono();
books.get('/', (c) => c.text('x')).post('/', (c) => c.text('y'));
app.route('/books', books);`,
  });
  const found = entries(root);
  expect(short(found)).toEqual([
    "DELETE /api/admin/cache clear", "GET /api/users/:id src/users.ts", "GET /book getBook", "GET /h/books src/hono.ts",
    "GET /v1/items items", "GET /v1/ping plugin", "HEAD /v1/items items", "POST /book src/server.ts", "POST /h/books src/hono.ts",
    "PUT /k/in/thing src/koa.ts",
  ]);
  expect(new Set(found.map((f) => f.protocol))).toEqual(new Set(["express", "fastify", "koa", "hono"]));
});

test("queues, message consumers and schedules", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "w" }),
    "src/bull.ts": `import { Processor, Process } from '@nestjs/bull';
import Queue from 'bull';
@Processor({ name: 'audio' })
export class AudioConsumer {
  @Process('transcode') transcode() {}
  @Process() other() {}
}
const video = new Queue('video');
video.process('encode', encode);
function encode() {}`,
    "src/bullmq.ts": `import { Worker } from 'bullmq';
new Worker('top', run);
function run() {}`,
    "src/nats.ts": `import { connect } from 'nats';
export async function go() { const nc = await connect(); nc.subscribe('orders.*'); }`,
    "src/redis.ts": `import Redis from 'ioredis';
const sub = new Redis();
sub.subscribe('news', 'music', (err) => {});
sub.psubscribe('user:*');
someObservable.subscribe(handler);`,
    "src/sqs.ts": `import { Consumer } from 'sqs-consumer';
const app = Consumer.create({ queueUrl: 'https://q/1', handleMessage: onMsg });
async function onMsg() {}`,
    "src/sched.ts": `import { Cron, CronExpression, Timeout } from '@nestjs/schedule';
import { CronJob } from 'cron';
import * as cron from 'node-cron';
export class S {
  @Cron(CronExpression.EVERY_HOUR) hourly() {}
  @Timeout('boot', 5000) boot() {}
  onModuleInit() { setInterval(() => this.tick(), 1000); }
}
new CronJob('0 0 * * *', nightly);
CronJob.from({ cronTime: '* * * * *', onTick: () => {} });
cron.schedule('0 1 * * *', () => {});
function nightly() {}`,
  });
  expect(short(entries(root))).toEqual([
    "CRON * * * * * src/sched.ts", "CRON 0 0 * * * nightly", "CRON 0 1 * * * src/sched.ts", "CRON CronExpression.EVERY_HOUR ? S.hourly",
    "CRON after 5000ms S.boot", "CRON every 1000ms S.onModuleInit", "NATS orders.* go", "QUEUE audio AudioConsumer.other",
    "QUEUE audio AudioConsumer.transcode", "QUEUE https://q/1 onMsg", "QUEUE top run", "QUEUE video encode",
    "REDIS music src/redis.ts", "REDIS news src/redis.ts", "REDIS user:* src/redis.ts",
  ]);
});

const EXAMPLE = "/home/user/examples/nest-turbo-starter";

test.skipIf(!existsSync(EXAMPLE))("the nest-turbo-starter example: HTTP routes under /api and gRPC handlers", () => {
  const found = entries(EXAMPLE);
  const t = (f: Finding) => `${f.module} ${f.method} ${f.target} ${f.symbol}`;
  const all = found.map(t);
  for (const want of [
    "auth-service POST /api/login AuthController.login",
    "auth-service POST /api/forgot-password/verify AuthController.verifyResetPasswordLink",
    "auth-service GET /api AppController.getHello",
    "user-service GET /api/info UserController.getUserInfo",
    "user-service GRPC UserService/CreateUser UserConsumer.createUser",
    "user-service GRPC UserService/FindUserByEmail UserConsumer.findUserByEmail",
    "notification-service GRPC NotificationService/SendForgotPasswordMail SendMailConsumer.sendMail",
  ]) expect(all).toContain(want);
  expect(found.filter((f) => f.kind === "http").length).toBe(12);
  expect(found.filter((f) => f.kind === "grpc").length).toBe(7);
  expect(found.every((f) => f.resolved)).toBe(true);
});

test("Nest decorators imported under an alias, through a namespace or through a local re-export", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "app" }),
    "src/http.ts": "export { Get as HttpGet, Controller } from '@nestjs/common';",
    "src/a.controller.ts": `import { Controller, Get as G } from '@nestjs/common';
import * as common from '@nestjs/common';
import { HttpGet } from './http';
@Controller('users')
export class A {
  @G('me') me() {}
  @common.Post('ns') ns() {}
  @HttpGet('barrel') barrel() {}
}`,
    "src/b.controller.ts": `import { Controller, Get } from '@nestjs/common';
import * as mine from './my-decorators';
@Controller('b')
export class B { @mine.Get('no') no() {} }`,
  });
  expect(short(entries(root))).toEqual(["GET /users/barrel A.barrel", "GET /users/me A.me", "POST /users/ns A.ns"]);
});

test("handlers inherited from a base class are reported under each subclass", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "app" }),
    "src/base.ts": `import { Get, Post } from '@nestjs/common';
import { EventPattern } from '@nestjs/microservices';
import { Cron } from '@nestjs/schedule';
export abstract class BaseCrud {
  @Get('list') list() {}
  @Post() create() {}
  @EventPattern('crud.changed') changed() {}
  @Cron('0 * * * *') tick() {}
}`,
    "src/users.controller.ts": `import { Controller, Post } from '@nestjs/common';
import { BaseCrud } from './base';
@Controller('users')
export class UsersController extends BaseCrud { @Post('own') create() {} }`,
    "src/health.controller.ts": `import { Controller } from '@nestjs/common';
import { BaseCrud } from './base';
@Controller('_health')
export class HealthController extends BaseCrud {}`,
  });
  const found = entries(root);
  expect(short(found)).toEqual([
    "CRON 0 * * * * HealthController.tick", "CRON 0 * * * * UsersController.tick",
    "GET /_health/list HealthController.list", "GET /users/list UsersController.list",
    "MESSAGE crud.changed HealthController.changed", "MESSAGE crud.changed UsersController.changed",
    "POST /_health HealthController.create", "POST /users/own UsersController.create",
  ]);
  expect(found.find((f) => f.target === "/users/list")).toMatchObject({ node: "app:UsersController", file: "src/base.ts", module: "app" });
});

test("Sse handlers, GraphQL operations without @Resolver, and a global prefix set in a bootstrap helper", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "app" }),
    "src/app.common.ts": `import { INestApplication } from '@nestjs/common';
export function configure(app: INestApplication) { app.setGlobalPrefix('api'); }`,
    "src/a.controller.ts": `import { Controller, Sse, Get, Version } from '@nestjs/common';
@Controller('a')
export class A {
  @Sse('events') events() {}
}`,
    "src/git.resolver.ts": `import { Query, Mutation } from '@nestjs/graphql';
export class GitResolver {
  @Query() repos() {}
  @Mutation() connect() {}
}`,
  });
  expect(short(entries(root))).toEqual(["GET /api/a/events A.events", "GRAPHQL Mutation.connect GitResolver.connect", "GRAPHQL Query.repos GitResolver.repos"]);
});

test("an unresolved @Version stays in the target, unresolved", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "app" }),
    "src/main.ts": `import { NestFactory } from '@nestjs/core';
async function bootstrap() { const app = await NestFactory.create(M); app.enableVersioning(); }`,
    "src/a.controller.ts": `import { Controller, Get, Version } from '@nestjs/common';
@Controller('a')
export class A { @Version(config.v) @Get('x') x() {} }`,
  });
  expect(short(entries(root))).toEqual(["GET /vconfig.v/a/x ? A.x"]);
});

test("express: an aliased Router import, and routers that mount each other", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "app" }),
    "src/app.ts": `import express, { Router as R } from 'express';
const app = express();
const api = R();
const admin = R();
api.get('/users/:id', (req, res) => {});
admin.post('/x', (req, res) => {});
api.use('/admin', admin);
admin.use('/back', api);
app.use('/api', api);`,
  });
  expect(short(entries(root))).toEqual(["GET /api/users/:id src/app.ts", "POST /api/admin/x src/app.ts"]);
});

test("a kafkajs subscription is owned by the eachMessage handler of the same consumer", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "app" }),
    "src/k.ts": `import { Kafka } from 'kafkajs';
const consumer = new Kafka({}).consumer({ groupId: 'g' });
export async function start() {
  await consumer.subscribe({ topic: 'a' });
  await consumer.run({ eachMessage: onMessage });
}
async function onMessage() {}`,
  });
  expect(short(entries(root))).toEqual(["KAFKA a onMessage"]);
});
