import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EXIT_DETECTORS } from "../src/extract/ts/exits/index.ts";
import { loadProject } from "../src/extract/ts/project.ts";
import { buildIndex } from "../src/extract/ts/symbols.ts";
import type { Finding } from "../src/extract/ts/types.ts";

const exitsOf = (root: string): Finding[] => {
  const project = loadProject(root);
  const index = buildIndex(project);
  return EXIT_DETECTORS.flatMap((d) => d.detect({ project, index }));
};

const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

/** Writes a small repo and returns its exits as `kind protocol method target` lines, with `?` on unresolved targets. */
function survey(files: Record<string, string>): string[] {
  const root = mkdtempSync(join(tmpdir(), "ccircuit-exits-"));
  made.push(root);
  for (const [rel, text] of Object.entries({ "package.json": '{"name":"app"}', ...files })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return exitsOf(root)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.method.localeCompare(b.method))
    .map((f) => `${f.kind} ${f.protocol} ${f.method} ${f.target}${f.resolved ? "" : " ?"}`);
}

const KEYS = ["direction", "kind", "protocol", "method", "target", "resolved", "file", "line", "symbol"] as const;
const keyOf = (f: Record<string, unknown>, extra: string[] = []) => [...KEYS, ...extra].map((k) => String(f[k])).join(" | ");

describe("fixtures", () => {
  for (const [name, extra] of [["ts-shop", ["module"]], ["ts-plain", ["module"]]] as const) {
    test(`${name}: exits match EXPECTED.json`, () => {
      const root = join(import.meta.dir, "fixtures", name);
      const expected = JSON.parse(readFileSync(join(root, "EXPECTED.json"), "utf8")).exits.map((f: any) => keyOf(f, [...extra])).sort();
      const found = exitsOf(root);
      expect(found.map((f) => keyOf(f as any, [...extra])).sort()).toEqual(expected);
      for (const f of found) {
        expect(f.rule).toBeTruthy();
        expect(f.node).toContain(":");
      }
    });
  }

  test("ts-shop: nodes and rules", () => {
    const found = exitsOf(join(import.meta.dir, "fixtures", "ts-shop"));
    const at = (file: string, line: number) => found.find((f) => f.file.endsWith(file) && f.line === line)!;
    expect(at("stock.service.ts", 9)).toMatchObject({ node: "@shop/inventory-svc:StockService", rule: "prisma-model" });
    expect(at("digest.scheduler.ts", 6)).toMatchObject({ node: "@shop/mailer-worker:services/mailer-worker/src/digest.scheduler.ts#scheduleDigest", rule: "bullmq-queue-add" });
    expect(at("inventory.client.ts", 20).rule).toBe("nest-grpc-client");
    expect(at("orders.service.ts", 37).rule).toBe("typeorm-repository");
  });
});

const NEST_STARTER = "/home/user/examples/nest-turbo-starter";

describe.skipIf(!existsSync(NEST_STARTER))("nest-turbo-starter", () => {
  const found = existsSync(NEST_STARTER) ? exitsOf(NEST_STARTER) : [];
  const has = (p: Partial<Finding>) => found.some((f) => Object.entries(p).every(([k, v]) => (f as any)[k] === v));

  test("AWS SES and S3", () => {
    expect(has({ kind: "cloud", protocol: "aws-ses", method: "SendEmail", target: "SES/SendEmail", symbol: "SesEmailService.sendEmail", line: 62 })).toBe(true);
    expect(has({ kind: "cloud", protocol: "aws-s3", method: "PutObject", target: "S3/PutObject", symbol: "AwsS3Service.uploadFile", line: 76 })).toBe(true);
  });

  test("gRPC clients injected through the microservice factory token", () => {
    expect(has({ kind: "grpc-out", target: "UserService/GetUser", symbol: "AuthService.login", rule: "nest-client-factory" })).toBe(true);
    expect(has({ kind: "grpc-out", target: "NotificationService/SendForgotPasswordMail", symbol: "AuthService.sendResetPasswordLink" })).toBe(true);
    expect(has({ kind: "grpc-out", target: "UserService/GetUser", symbol: "GrpcJwtAuthStrategy.validate", module: "@app/core" })).toBe(true);
  });

  test("MikroORM repository subclass and entity manager", () => {
    expect(has({ kind: "database", protocol: "mikro-orm", method: "findOne", target: "User", resolved: true, symbol: "UserService.getUser" })).toBe(true);
    expect(has({ kind: "database", protocol: "mikro-orm", method: "persist", target: "User", resolved: true, symbol: "UserService.createUser" })).toBe(true);
    expect(has({ kind: "database", protocol: "mikro-orm", method: "flush", target: "(unit of work)", symbol: "UserService.createUser" })).toBe(true);
    expect(has({ kind: "database", protocol: "mikro-orm", method: "create" })).toBe(false);
    expect(has({ kind: "database", protocol: "mikro-orm", method: "persist", target: "User", resolved: true, symbol: "CreateAdminCommand.run" })).toBe(true);
    expect(found.filter((f) => f.protocol === "mikro-orm" && f.method === "flush").every((f) => f.target === "(unit of work)")).toBe(true);
  });

  test("ioredis behind an inject token, and the axios wrapper only inside the wrapper", () => {
    expect(has({ kind: "cache", protocol: "ioredis", method: "get", target: "key", resolved: false, symbol: "RedisService.getValue" })).toBe(true);
    expect(found.filter((f) => f.kind === "cache").every((f) => f.file === "libs/core/src/redis/redis.service.ts")).toBe(true);
    const http = found.filter((f) => f.kind === "http-out");
    expect(http.length).toBeGreaterThan(0);
    expect(http.every((f) => f.file === "libs/core/src/http/http.service.ts" && f.protocol === "axios")).toBe(true);
    expect(has({ kind: "http-out", method: "GET", target: "url", symbol: "HttpService.get" })).toBe(true);
  });

  test("SMTP through nodemailer", () => {
    expect(has({ kind: "message-out", protocol: "smtp", method: "sendMail", symbol: "SmtpEmailService.sendEmail" })).toBe(true);
  });
});

describe("database", () => {
  test("TypeORM: custom repository, getRepository and entity manager", () => {
    expect(survey({
      "src/user.repo.ts": "import { Repository, DataSource } from 'typeorm';\nimport { User } from './user';\nexport class UserRepo extends Repository<User> {}\nexport class Svc {\n  constructor(private repo: UserRepo, private ds: DataSource) {}\n  a() { return this.repo.findBy({}); }\n  b() { return this.ds.getRepository(User).count(); }\n  c() { return this.ds.manager.findOne(User, {}); }\n  d() { return this.repo.create({}); }\n}",
    })).toEqual(["database typeorm findBy User", "database typeorm count User", "database typeorm findOne User"]);
  });

  test("MikroORM: @InjectRepository, em.find with an entity, fork and getRepository", () => {
    expect(survey({
      "src/svc.ts": "import { InjectRepository } from '@mikro-orm/nestjs';\nimport { EntityManager, EntityRepository } from '@mikro-orm/postgresql';\nimport { Book } from './book';\nexport class Svc {\n  constructor(@InjectRepository(Book) private books: EntityRepository<Book>, private em: EntityManager) {}\n  a() { return this.books.findAll(); }\n  b() { const em = this.em.fork(); return em.find(Book, {}); }\n  c() { return this.em.getRepository(Book).nativeDelete({}); }\n}",
    })).toEqual(["database mikro-orm findAll Book", "database mikro-orm find Book", "database mikro-orm nativeDelete Book"]);
  });

  test("Prisma: client field, model calls and raw queries; $connect is not an exit", () => {
    expect(survey({
      "src/db.ts": "import { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();\nexport async function f() {\n  await prisma.$connect();\n  await prisma.user.upsert({});\n  await prisma.$queryRaw`SELECT 1`;\n  await prisma.$executeRawUnsafe('DELETE FROM t');\n}",
    })).toEqual(["database prisma upsert user", "database prisma $queryRaw SELECT 1", "database prisma $executeRawUnsafe DELETE FROM t"]);
  });

  test("Mongoose @InjectModel, Sequelize query, knex raw and table, drizzle insert, mysql2", () => {
    expect(survey({
      "src/a.ts": "import { InjectModel } from '@nestjs/mongoose';\nimport { Model } from 'mongoose';\nimport { Cat } from './cat';\nexport class Cats {\n  constructor(@InjectModel(Cat.name) private cats: Model<Cat>) {}\n  all() { return this.cats.find().exec(); }\n}",
      "src/b.ts": "import { Sequelize } from 'sequelize';\nimport knex from 'knex';\nimport mysql from 'mysql2/promise';\nconst seq = new Sequelize('x');\nconst k = knex({});\nconst pool = mysql.createPool({});\nexport async function g() {\n  await seq.query('SELECT 2');\n  await k.raw('SELECT 3');\n  await k('orders');\n  await pool.execute('SELECT 4');\n}",
      "src/c.ts": "import { drizzle } from 'drizzle-orm/postgres-js';\nimport { pgTable } from 'drizzle-orm/pg-core';\nconst items = pgTable('items', {});\nconst db = drizzle('');\nexport const h = () => db.insert(items).values({});",
    })).toEqual(["database mongoose find Cat", "database sequelize query SELECT 2", "database knex raw SELECT 3", "database knex select orders", "database mysql execute SELECT 4", "database drizzle insert items"]);
  });
});

describe("cache", () => {
  test("ioredis, node-redis, cache-manager and keyv; listeners and publish are not cache calls", () => {
    expect(survey({
      "src/a.ts": "import Redis from 'ioredis';\nimport { createClient } from 'redis';\nimport Keyv from 'keyv';\nconst r = new Redis();\nconst n = createClient();\nconst kv = new Keyv();\nconst KEY = 'k';\nexport async function f() {\n  r.on('error', () => {});\n  await r.hgetall(KEY);\n  await n.hSet('h', 'a', 'b');\n  await kv.get('x');\n  await r.publish('chan', 'hi');\n}",
      "src/b.ts": "import { Inject } from '@nestjs/common';\nimport { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';\nexport class S {\n  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}\n  f() { return this.cache.del('a'); }\n}",
    })).toEqual(["cache ioredis hgetall k", "cache redis hSet h", "cache keyv get x", "message-out redis publish chan", "cache cache-manager del a"]);
  });

  test("a local class named Redis is not ioredis", () => {
    expect(survey({ "src/a.ts": "class Redis { get(k: string) {} }\nconst r = new Redis();\nr.get('x');" })).toEqual([]);
  });
});

describe("http-out", () => {
  test("axios instance with baseURL, axios(config), got(), undici, fetch with a method, HttpService.axiosRef", () => {
    expect(survey({
      "src/a.ts": "import axios from 'axios';\nimport got from 'got';\nimport { request } from 'undici';\nimport { HttpService } from '@nestjs/axios';\nconst api = axios.create({ baseURL: 'https://api.example.com/' });\nexport class C {\n  constructor(private http: HttpService) {}\n  a() { return api.get('/users'); }\n  b() { return axios({ method: 'put', url: 'https://x.example.com' }); }\n  c() { return got('https://g.example.com', { method: 'DELETE' }); }\n  d() { return request('https://u.example.com'); }\n  e() { return fetch('https://f.example.com', { method: 'POST' }); }\n  f() { return this.http.axiosRef.patch('https://n.example.com'); }\n}",
    })).toEqual([
      "http-out axios GET https://api.example.com/users",
      "http-out axios PUT https://x.example.com",
      "http-out got DELETE https://g.example.com",
      "http-out undici GET https://u.example.com",
      "http-out fetch POST https://f.example.com",
      "http-out axios PATCH https://n.example.com",
    ]);
  });

  test("a repo class named HttpService is not @nestjs/axios, and a local fetch is not global fetch", () => {
    expect(survey({
      "src/http.ts": "export class HttpService { get(u: string) {} }",
      "src/a.ts": "import { HttpService } from './http';\nfunction fetch(u: string) {}\nexport class C {\n  constructor(private http: HttpService) {}\n  a() { this.http.get('/x'); fetch('/y'); }\n}",
    })).toEqual([]);
  });
});

describe("grpc-out and message-out", () => {
  test("ClientProxy transport from ClientsModule.register, @Client, ClientProxyFactory, kafkajs sendBatch, nats", () => {
    expect(survey({
      "src/app.module.ts": "import { ClientsModule, Transport } from '@nestjs/microservices';\nexport const M = ClientsModule.register([{ name: 'BUS', transport: Transport.RMQ }]);",
      "src/a.ts": "import { Inject } from '@nestjs/common';\nimport { Client, ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';\nimport { Kafka } from 'kafkajs';\nimport { connect } from 'nats';\nconst p = new Kafka({}).producer();\nexport class S {\n  @Client({ transport: Transport.NATS }) nats: ClientProxy;\n  private mq = ClientProxyFactory.create({ transport: Transport.MQTT });\n  constructor(@Inject('BUS') private bus: ClientProxy) {}\n  a() { this.bus.emit('user.created', {}); }\n  b() { this.nats.send({ cmd: 'sum' }, 1); }\n  c() { this.mq.emit('m', 1); }\n  d() { return p.sendBatch({ topicMessages: [{ topic: 't1', messages: [] }, { topic: 't2', messages: [] }] }); }\n  async e() { const nc = await connect(); nc.publish('subj'); }\n}",
    })).toEqual([
      "message-out rmq emit user.created",
      "message-out nats send { cmd: 'sum' } ?",
      "message-out mqtt emit m",
      "message-out kafka sendBatch t1",
      "message-out kafka sendBatch t2",
      "message-out nats publish subj",
    ]);
  });

  test("gRPC stub from getService in a local variable, and from a client registered by name", () => {
    expect(survey({
      "src/app.module.ts": "import { ClientsModule, Transport } from '@nestjs/microservices';\nexport const M = ClientsModule.register([{ name: 'HERO', transport: Transport.GRPC }]);",
      "src/a.ts": "import { Inject } from '@nestjs/common';\nimport { ClientGrpc } from '@nestjs/microservices';\nconst SVC = 'HeroService';\nexport class H {\n  constructor(@Inject('HERO') private client: ClientGrpc) {}\n  a() { const s = this.client.getService<any>(SVC); return s.findOne({ id: 1 }); }\n}",
    })).toEqual(["grpc-out grpc findOne HeroService/FindOne"]);
  });
});

describe("queue-out and cloud", () => {
  test("Bull @InjectQueue, AWS v3 aggregated client, lib-dynamodb, Kinesis, AWS v2", () => {
    expect(survey({
      "src/a.ts": "import { InjectQueue } from '@nestjs/bull';\nimport { Queue } from 'bull';\nexport class P {\n  constructor(@InjectQueue('audio') private q: Queue) {}\n  a() { return this.q.add({}); }\n}",
      "src/b.ts": "import { S3 } from '@aws-sdk/client-s3';\nimport { DynamoDBClient } from '@aws-sdk/client-dynamodb';\nimport { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';\nimport { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';\nimport AWS from 'aws-sdk';\nconst s3 = new S3({});\nconst doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));\nconst k = new KinesisClient({});\nconst lambda = new AWS.Lambda();\nexport async function f() {\n  await s3.getObject({ Bucket: 'b', Key: 'k' });\n  await doc.send(new PutCommand({ TableName: 't', Item: {} }));\n  await k.send(new PutRecordCommand({ StreamName: 'clicks', Data: new Uint8Array(), PartitionKey: 'p' }));\n  await lambda.invoke({ FunctionName: 'fn' }).promise();\n}",
    })).toEqual([
      "queue-out bull add audio",
      "cloud aws-s3 GetObject S3/GetObject",
      "cloud aws-dynamodb Put DynamoDB/Put",
      "message-out aws-kinesis PutRecord clicks",
      "cloud aws-lambda Invoke Lambda/Invoke",
    ]);
  });

  test("an AWS command sent through a client the detector cannot see still counts", () => {
    expect(survey({
      "src/a.ts": "import { SendEmailCommand } from '@aws-sdk/client-ses';\nexport async function f(client: any) {\n  const cmd = new SendEmailCommand({});\n  await client.send(cmd);\n}",
    })).toEqual(["cloud aws-ses SendEmail SES/SendEmail"]);
  });
});

describe("more clients", () => {
  test("a generated Prisma client, Kysely, MikroORM persist targets and Octokit", () => {
    expect(survey({
      "src/prisma.service.ts": "import { PrismaClient } from '../prisma/generated-prisma-client';\nexport class PrismaService extends PrismaClient {}",
      "src/users.ts": "import { PrismaService } from './prisma.service';\nexport class Users {\n  constructor(private prisma: PrismaService) {}\n  a() { return this.prisma.user.findMany(); }\n}",
      "src/album.repo.ts": "import { Kysely, sql } from 'kysely';\nimport { InjectKysely } from 'nestjs-kysely';\nexport class AlbumRepo {\n  constructor(@InjectKysely() private db: Kysely<DB>) {}\n  a() { return this.db.selectFrom('album').selectAll().execute(); }\n  b() { return this.db.deleteFrom('album').where('id', '=', 1).execute(); }\n  c() { return sql`select 1`.execute(this.db); }\n}",
      "src/admin.ts": "import { EntityManager } from '@mikro-orm/core';\nexport async function f(em: EntityManager) {\n  const admin = em.create(User, {});\n  em.persist(admin);\n  em.persist(new Role());\n  await em.flush();\n}",
      "src/gh.ts": "import { Octokit } from '@octokit/rest';\nconst octokit = new Octokit({});\nexport async function g() {\n  await octokit.rest.repos.get({ owner: 'o', repo: 'r' });\n  await octokit.request('GET /user');\n}",
    })).toEqual([
      "database mikro-orm persist User",
      "database mikro-orm persist Role",
      "database mikro-orm flush (unit of work)",
      "database kysely selectFrom album",
      "database kysely deleteFrom album",
      "database kysely sql sql`select 1` ?",
      "http-out octokit get repos.get",
      "http-out octokit REQUEST GET /user",
      "database prisma findMany user",
    ]);
  });

  test("a Nest client package resolved to source inside the repo still gives clients", () => {
    expect(survey({
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@nestjs/microservices": ["./packages/microservices"] } } }),
      "packages/microservices/index.ts": "export class ClientProxyFactory { static create(o: any) {} }\nexport enum Transport { RMQ }",
      "src/rmq.controller.ts": "import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';\nexport class RMQController {\n  client: ClientProxy;\n  constructor() { this.client = ClientProxyFactory.create({ transport: Transport.RMQ }); }\n  a() { return this.client.send('sum', 1); }\n}",
    })).toEqual(["message-out rmq send sum"]);
  });
});
