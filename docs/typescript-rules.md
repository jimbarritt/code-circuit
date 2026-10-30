# TypeScript detector rules

Every finding of the TypeScript extractor records the rule that made it. This page lists each rule. The design is in [typescript-extractor.md](typescript-extractor.md).

Some limits hold for every rule:

- A rule matches a call only when the callee comes from the named package, by import, by a type written in the code, or by an assignment the extractor can follow. There is no type checker.
- A target that does not fold to a literal stays as source text with `resolved: false`, and the survey shows it with a `?`.
- Files under `node_modules`, `*.d.ts`, `*.spec.ts` and `*.test.ts` are never read.

## Entries

| Rule | Kind | Protocol | Source pattern | Target | Known limits |
|---|---|---|---|---|---|
| `nest-http-decorator` | `http` | `nest` | `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@All`, `@Search` on a method of a `@Controller` class, also inherited | global prefix, URI version, controller path and route, joined | One finding per path when a decorator takes an array. `setGlobalPrefix` and `enableVersioning` are read only from bootstrap files in the same module. |
| `nest-sse-decorator` | `http` | `nest` | `@Sse(path)` on a controller method | as above, method `GET` | As above. |
| `express-route` | `http` | `express` | `app.get(path, ...)`, `router.post(path, ...)` on `express()` or `Router()` | mount prefixes and path | Mounts count through `use(prefix, router)` when the router is a variable, an import or a factory function in the repo. A path array gives one finding per path. A mount that closes a cycle is dropped. |
| `express-route-chain` | `http` | `express` | `router.route(path).get(h).post(h)` | mount prefixes and path | As above. |
| `fastify-route` | `http` | `fastify` | `fastify.get(path, ...)` on `fastify()` or a `FastifyInstance` parameter | `register` prefixes and path | A plugin prefix counts only when `register(plugin, { prefix })` names the plugin directly. |
| `fastify-route-options` | `http` | `fastify` | `fastify.route({ method, url, handler })` | `register` prefixes and `url` | One finding per method in a `method` array. |
| `koa-route` | `http` | `koa` | `router.get(path, ...)` on `new Router()` from `@koa/router` or `koa-router` | router `prefix`, mounts and path | As for Express. |
| `hono-route` | `http` | `hono` | `app.get(path, ...)` on `new Hono()` | `app.route(prefix, sub)` prefixes and path | As for Express. |
| `nest-grpc-method` | `grpc` | `grpc` | `@GrpcMethod(service, method)` | `Service/Method` | Without arguments, the service is the class name and the method is the method name with a capital letter. |
| `nest-grpc-stream` | `grpc` | `grpc` | `@GrpcStreamMethod` or `@GrpcStreamCall` | `Service/Method` | As above. |
| `graphql-resolver` | `graphql` | `graphql` | `@Query`, `@Mutation`, `@Subscription` from `@nestjs/graphql` or `type-graphql` | `Query.<name>`, `Mutation.<name>`, `Subscription.<name>` | The name is the `name` option or string argument, else the method name. |
| `nest-ws-subscribe` | `websocket` | `ws` | `@SubscribeMessage(message)` in a `@WebSocketGateway` class | message, or `/<namespace> <message>` | The namespace comes only from the gateway's options object. |
| `nest-message-pattern` | `message` | the module's transport, else `nest` | `@MessagePattern(pattern)` | pattern | The transport is read from the bootstrap code of the same module, or from a `Transport.X` second argument. Object patterns stay unresolved. |
| `nest-event-pattern` | `message` | as above | `@EventPattern(pattern)` | pattern | As above. |
| `kafkajs-subscribe` | `message` | `kafka` | `consumer.subscribe({ topic })` or `subscribe({ topics: [...] })` in a file that imports `kafkajs` | topic, one finding per topic | The owner is the named function given to `eachMessage` or `eachBatch` of the same consumer's `run`, when there is one. |
| `amqplib-consume` | `message` | `amqplib` | `channel.consume(queue, handler)` in a file that imports `amqplib` or `amqp-connection-manager` | queue | The channel is matched by the method name and the file's import, not by type. |
| `nats-subscribe` | `message` | `nats` | `nc.subscribe(subject)` in a file that imports `nats` | subject | Only a subject that folds makes a finding. |
| `redis-subscribe` | `message` | `redis` | `sub.subscribe(channel, ...)` in a file that imports `ioredis` or `redis` | channel, one per argument | Only channels that fold make findings, because `subscribe` is also an RxJS method. |
| `redis-psubscribe` | `message` | `redis` | `sub.psubscribe(pattern, ...)` | pattern | As above. |
| `sqs-receive-command` | `queue` | `sqs` | `new ReceiveMessageCommand({ QueueUrl })` from `@aws-sdk/client-sqs` | queue URL | The owner is the enclosing class or function. |
| `sqs-receive-message` | `queue` | `sqs` | `sqs.receiveMessage({ QueueUrl })` with `aws-sdk` v2 | queue URL | As above. |
| `sqs-consumer` | `queue` | `sqs` | `Consumer.create({ queueUrl, handleMessage })` from `sqs-consumer` | queue URL | The owner is the named `handleMessage` or `handleMessageBatch` function, when there is one. |
| `nest-queue-process` | `queue` | `bullmq` or `bull` | `@Process(job)` on a method of a `@Processor(name)` class | queue name | The job name goes to `detail`. |
| `nest-queue-processor` | `queue` | `bullmq` or `bull` | `@Processor(name)` class with no `@Process` method | queue name | The owner is the `process` method when there is one. |
| `bullmq-worker` | `queue` | `bullmq` | `new Worker(name, processor)` from `bullmq` | queue name | The owner is the named processor function, when there is one. |
| `bull-process` | `queue` | `bull` | `queue.process(...)` on `const queue = new Queue(name)` from `bull` | queue name | Only a queue held in a variable of the same file. |
| `nest-cron` | `cron` | `cron` | `@Cron(expression)` from `@nestjs/schedule` | the expression as written | `CronExpression.X` folds only when the enum is in the repo. |
| `nest-interval` | `cron` | `interval` | `@Interval(ms)` | `every <n>ms` | |
| `nest-timeout` | `cron` | `timeout` | `@Timeout(ms)` | `after <n>ms` | |
| `node-cron-schedule` | `cron` | `node-cron` | `cron.schedule(expression, fn)` or `schedule(...)` from `node-cron` | expression | |
| `cron-job` | `cron` | `cron` | `new CronJob(time, onTick)`, `CronJob.from({ cronTime, onTick })` from `cron` | cron time | |
| `set-interval` | `cron` | `interval` | global `setInterval(fn, ms)` | `every <n>ms` | Every `setInterval` counts, also a short timer for a UI or a retry. |

## Exits

| Rule | Kind | Protocol | Source pattern | Target | Known limits |
|---|---|---|---|---|---|
| `typeorm-repository` | `database` | `typeorm` | `repo.find(...)` and other TypeORM methods on a `Repository<E>`, `@InjectRepository(E)` or `getRepository(E)` | entity `E`, or SQL for `query` | A repository typed without a type argument stays unresolved. |
| `typeorm-entity-manager` | `database` | `typeorm` | `em.find(Entity, ...)` on an `EntityManager`, `DataSource` or `Connection` | entity | |
| `typeorm-data-source` | `database` | `typeorm` | `dataSource.query(sql)` | SQL | |
| `mikro-orm-entity-manager` | `database` | `mikro-orm` | `em.find(Entity, ...)`, `em.persist(x)`, `em.remove(x)`, `em.flush()`, `em.execute(sql)` on an `EntityManager` or `orm.em` | entity, `(unit of work)` for `flush`, SQL for `execute` | `persist` and `remove` find the entity only from `new E()`, `repo.create(...)` or `em.create(E, ...)`, directly or through a local. |
| `mikro-orm-repository` | `database` | `mikro-orm` | entity and unit-of-work methods on an `EntityRepository<E>` or a class that extends one | entity `E` | |
| `mikro-orm-query-builder` | `database` | `mikro-orm` | `qb.getResult()`, `getResultAndCount()`, `execute()` and similar on a `QueryBuilder` | the builder as written, unresolved | The entity of the builder is not followed. |
| `prisma-model` | `database` | `prisma` | `prisma.user.findMany(...)` and other model methods on a `PrismaClient` or a class that extends it | model name | A generated client counts when its import path contains `prisma` or is a relative path outside the repo. |
| `prisma-raw` | `database` | `prisma` | `$queryRaw`, `$executeRaw` and their `Unsafe` forms, `$runCommandRaw` | SQL | Tagged templates stay unresolved. |
| `mongoose-model` | `database` | `mongoose` | model methods on `model(...)`, `Model<T>` or `@InjectModel(Name)` | model name | |
| `sequelize-model` | `database` | `sequelize` | model methods on a `Model` type or `@InjectModel(Name)` from `@nestjs/sequelize` | model name | |
| `sequelize-query` | `database` | `sequelize` | `sequelize.query(sql)` | SQL | |
| `knex-table` | `database` | `knex` | `knex('table')`, `knex.table`, `from`, `into` | table | |
| `knex-raw` | `database` | `knex` | `knex.raw(sql)` | SQL | |
| `drizzle-query` | `database` | `drizzle` | `db.select().from(t)`, `db.insert(t)`, `update`, `delete`, `execute`, `db.query.<model>.findMany` | table name from `pgTable('name', ...)` and similar | A table defined outside the repo stays unresolved. |
| `kysely-query` | `database` | `kysely` | `db.selectFrom(t)`, `insertInto`, `updateTable`, `deleteFrom`, `replaceInto`, `mergeInto` on a `Kysely` or `@InjectKysely()` | table | |
| `kysely-sql` | `database` | `kysely` | `` sql`...`.execute(db) `` | the template, unresolved | |
| `pg-query` | `database` | `pg` | `pool.query(sql)` or `execute` on a `pg` `Pool`, `Client` or `PoolClient` | SQL | |
| `mysql-query` | `database` | `mysql` | `pool.query(sql)` or `execute` on a `mysql` or `mysql2` pool or connection | SQL | |
| `ioredis-command` | `cache` | `ioredis` | any command method on an `ioredis` `Redis` or `Cluster`, or `@InjectRedis()` | key | Event, connection and pub/sub methods are not commands. Keys built at run time stay unresolved. |
| `node-redis-command` | `cache` | `redis` | any command method on `createClient()` from `redis` | key | As above. |
| `cache-manager` | `cache` | `cache-manager` | `get`, `set`, `del`, `wrap` and similar on `@Inject(CACHE_MANAGER)`, a `Cache` or `createCache()` | key | |
| `keyv` | `cache` | `keyv` | `get`, `set`, `delete` and similar on a `Keyv` | key | |
| `axios-call` | `http-out` | `axios` | `axios.get(url)`, `axios(config)`, `instance.post(url)`, `postForm` and similar, also `httpService.axiosRef` | URL, with `baseURL` of `axios.create` when it folds | A URL passed in as a parameter stays unresolved. |
| `got-call` | `http-out` | `got` | `got(url)`, `got.get(url)` | URL | |
| `fetch-call` | `http-out` | `fetch` | global `fetch(url, init)`, or `fetch` from `node-fetch`, `cross-fetch`, `isomorphic-fetch` or `undici` | URL, method from `init.method` | |
| `undici-request` | `http-out` | `undici` | `request(url, opts)` from `undici` | URL | |
| `nest-http-service` | `http-out` | `nest-http` | `httpService.get(url)` and other verbs on `HttpService` from `@nestjs/axios` | URL | |
| `octokit-request` | `http-out` | `octokit` | `octokit.request('GET /repos/...')` | the route as written | The host is `api.github.com` in `detail`. |
| `octokit-rest` | `http-out` | `octokit` | `octokit.rest.<ns>.<method>(...)` | `<ns>.<method>` | As above. |
| `nest-grpc-client` | `grpc-out` | `grpc` | `stub.method(...)` on `client.getService('Service')` of a `ClientGrpc` | `Service/Method` | A service name that does not fold stays unresolved and makes no `grpc-call` link. |
| `nest-client-proxy` | `message-out` | the client's transport, else `nest` | `client.emit(pattern, ...)` or `client.send(pattern, ...)` on a `ClientProxy`, `ClientKafka`, `ClientRMQ` and so on | pattern | The transport comes from the client type, `@Client({ transport })`, `ClientProxyFactory.create({ transport })` or a registered client with the same `name`. |
| `nest-client-factory` | `message-out` or `grpc-out` | the factory's transport | as `nest-client-proxy` or `nest-grpc-client`, on a client from `@Inject(factory(..., Transport.X))` | pattern or `Service/Method` | |
| `kafkajs-producer` | `message-out` | `kafka` | `producer.send({ topic })` and `producer.sendBatch({ topicMessages })` on `kafka.producer()` or a `Producer` | topic, one per batch item | |
| `amqplib-publish` | `message-out` | `amqplib` | `channel.sendToQueue(queue, ...)`, `channel.publish(exchange, key, ...)` | queue, or `exchange/key` | |
| `nats-publish` | `message-out` | `nats` | `nc.publish(subject)` or `nc.request(subject)` on `connect()` from `nats` | subject | |
| `redis-publish` | `message-out` | `redis` | `redis.publish(channel, ...)` | channel | |
| `nodemailer-send` | `message-out` | `smtp` | `transporter.sendMail(...)` on `createTransport(...)` from `nodemailer` | the transport host when it folds | The target is the host argument of `createTransport` as written, often a config property. |
| `bullmq-queue-add` | `queue-out` | `bullmq` | `queue.add(...)`, `addBulk` on `new Queue(name)` or `@InjectQueue(name)` | queue name | |
| `bull-queue-add` | `queue-out` | `bull` | as above, from `bull` or `@nestjs/bull` | queue name | |
| `aws-sdk-v3-command` | `cloud`, or `queue-out`, `message-out` | `aws-<service>` | `client.send(new XCommand(params))` from `@aws-sdk/client-<service>` or `@aws-sdk/lib-dynamodb` | `<Service>/<Op>`; queue URL for SQS `SendMessage`; topic ARN for SNS `Publish`; stream for Kinesis `PutRecord` | SQS `ReceiveMessage` is an entry, not an exit. A command that cannot be found keeps its text, unresolved. |
| `aws-sdk-v3-client` | as above | `aws-<service>` | `ses.sendEmail(params)` on an aggregated v3 client such as `SES` | as above | |
| `aws-sdk-v2` | as above | `aws-<service>` | `new AWS.S3().putObject(params)` and clients from `aws-sdk/clients/<service>` | as above | |
| `google-auth-library` | `cloud` | `google-oauth2` | `getToken`, `verifyIdToken`, `refreshAccessToken` and similar on an `OAuth2Client` | `OAuth2/<Op>` | |

## Assembly rules

These rules mark edges that `assemble.ts` makes from the index and the findings.

| Rule | Edge | Made by | Known limits |
|---|---|---|---|
| `di-call` | `sync` | `this.<dep>.<method>()` in a method, where `<dep>` is an injected class of the repo | Calls to loggers and to ORM methods that no repo class declares make no edge. A dependency copied to a local first is not followed. |
| `fn-call` | `sync` | a call to a top-level function of the repo that owns a finding | |
| `extends` | `sync` | a subclass whose base class owns findings | |
| `grpc-call` | `sync` | a `grpc-out` exit whose `Service/Method` matches a `grpc` entry in the repo | The proto package and case are ignored. |
| `message-out`, `queue-out` | `async` | an exit whose target and protocol match a `message` or `queue` entry in the repo | Both targets must fold. |
| `<exit rule>-via-wrapper` | `async` | a call to a method that sends to its own parameter, when the argument folds and matches a consumer | Only one level of wrapper is followed. |
