# TypeScript extractor

This document describes the TypeScript extractor and its contracts. Mission `M-CCT-TSEXTRACT` built it. `ccircuit extract` and `ccircuit survey` use it on a TypeScript repo. Each detector rule is listed in [typescript-rules.md](typescript-rules.md).

## Goal

Read a real TypeScript repo with one or more modules. Write two things:

- a data map that `ccircuit render` draws;
- a survey of every entry point and every exit point, with file and line.

## Rules for every part

- Parse with the TypeScript compiler API (`typescript` package, `ts.createSourceFile`). Do not use regular expressions on source text to find code. Do not run the type checker: the repo has no `node_modules` installed in general.
- Do not rely on pnpm or Turborepo. A repo can use npm, yarn or pnpm workspaces, Nx, Lerna, plain `tsconfig.json` files, or no module system.
- Skip `node_modules`, `coverage`, `__tests__`, hidden directories, `*.d.ts`, `*.spec.ts` and `*.test.ts` everywhere. Skip `dist`, `build`, `out`, `test` and `tests` only at a module root, which is a directory with a `package.json`, `project.json` or `tsconfig.json`. Skip the `outDir` of each `tsconfig.json`. A directory with one of these names deeper in the source tree holds real code.
- Every finding records the rule that produced it.
- A value that cannot be resolved to a literal stays in the finding as the source text, with `resolved: false`. Never drop a finding because its target is unknown.

## Files

All code lives in `src/extract/ts/`.

| File | Task | Contents |
|---|---|---|
| `types.ts` | T-01 | The shared types below. Change only with the agreement of the lead. |
| `project.ts` | T-02 | `loadProject(root)` |
| `symbols.ts` | T-03 | `buildIndex(project)`, `resolveValue(...)` |
| `entries/*.ts` | T-04 | One file per framework. `entries/index.ts` exports `ENTRY_DETECTORS`. |
| `exits/*.ts` | T-05 | One file per client family. `exits/index.ts` exports `EXIT_DETECTORS`. |
| `assemble.ts` | T-06 | `extractTypeScript(root, opts)` returns a `DataMap` with a `survey` section. |
| `survey.ts` | T-07 | Text and JSON output of the survey. |

## Project (T-02)

`loadProject(root: string): Project`.

Module discovery merges these sources:

1. `workspaces` in the root `package.json` (array, or `{ packages: [...] }`), `pnpm-workspace.yaml` (or `.yml`) `packages`, `lerna.json` `packages`. A glob that starts with `!` excludes directories. Expand globs such as `apps/*` and `packages/**`.
2. Nx: every `project.json` outside skipped directories, unless a workspace module has the same directory.
3. Every `package.json` or `tsconfig.json` below the root, outside skipped directories, whose directory holds `.ts` files and is not inside a workspace or Nx module.
4. The root itself, always, as the fallback module.

A module has a name: the `name` of its `package.json`, else the `name` of its `project.json`, else its directory relative to the root. Module names are unique. When a name is taken, a later module is named `<name> (<dir>)`, and the root is named `<name> (root)`. Import resolution still uses the `package.json` name. A file belongs to the module with the deepest directory that contains it.

Import resolution: `project.resolveImport(fromRel, specifier)` returns a file path relative to the root, or `undefined`. It handles:

- relative specifiers, with `.ts`, `.tsx`, `/index.ts`;
- `compilerOptions.paths` and `baseUrl` from the nearest `tsconfig.json`, following `extends` chains to files inside the repo;
- workspace package names, to the package's `main`, `types` or `src/index.ts`;
- a bare specifier that matches a module directory such as `src/config/app.config` under `baseUrl`.

A workspace package name resolves to its `main`, `types`, `typings` or `module` field. When that field points into `dist`, `build`, `lib` or `out`, the same path under `src` is tried, because the build output is not in the repo. A subpath such as `@app/core/redis` resolves under the package's `src` directory first.

## Symbol index (T-03)

`buildIndex(project): SymbolIndex` lists every class and every top-level function, with decorators, constructor dependencies, methods and the calls made inside each method.

- A constructor parameter with a type reference, or `@Inject(TOKEN)`, or `@InjectRepository(Entity)`, or `@InjectModel(Name)`, or `@InjectQueue(name)` is a dependency. The index records the parameter name, the type name, the token text, and the class it resolves to when the class is in the repo.
- A class property with an inject decorator, such as `@Inject(X) private x: X`, is a dependency too.
- `this.<dep>.<method>(...)` and `this['<dep>'].<method>(...)` inside a method are calls. The index records the dependency, the method and the line.
- A call to a top-level function of the repo, in the same file or imported, is a function call (`fnCalls`), in methods and in functions.
- Class ids are `<module>:<ClassName>`. When two classes in one module have the same name, the second and later ones are `<module>:<ClassName>@<file>`.
- `base` is the id of the class a class extends, when it is in the repo. `allMethods` and `allDeps` give the own and inherited methods and dependencies; a member of a subclass hides one of the same name in a base class.
- Nest custom providers `{ provide: X, useClass: Y }` and `{ provide: X, useExisting: Y }` are bindings from X (a class, or a folded token) to Y. A dependency on X with one binding resolves to Y.
- Decorators are matched by the name they are exported under and the package they come from. The index follows aliased imports (`Get as G`), namespace imports (`common.Get`) and local re-exports to find them.
- `resolveValue(expr, fileRel)` folds an expression to a string when it can: string literals, no-substitution templates, templates whose parts fold, `+` of folded parts, `const` identifiers in the same file or imported from another file, `export default` values, enum members (also those that name earlier members), and property access on a `const` object literal (`TOPICS.USER_CREATED`), including `as const` and computed string keys.

## Detectors

`ENTRY_DETECTORS` and `EXIT_DETECTORS` run over the whole project. Each one returns findings. [typescript-rules.md](typescript-rules.md) lists every rule they use.

Entry detectors match decorators by name and package, and calls by the package the callee is imported from. A Nest app's bootstrap code is any file that uses `NestFactory`, or that types a value as `INestApplication`, `NestExpressApplication` or `NestFastifyApplication`. From it the extractor reads, per module:

- `setGlobalPrefix(...)`, which prefixes every Nest HTTP path of the module;
- `enableVersioning(...)` with URI versioning, which adds `v<n>` (or the given `prefix`) from `@Version`, the controller `version` option or `defaultVersion`. `VERSION_NEUTRAL` adds nothing;
- the `transport` of each microservice, which gives Nest message handlers their protocol. With one transport other than gRPC, the handler takes its method and protocol, for example `KAFKA` and `kafka`. With none or more than one, the method is `MESSAGE` and the protocol is `nest`.

Exit detectors work by import provenance. `exits/clients.ts` follows each value back to where it comes from: an import from a known package, a `new` or a factory call on one, a constructor parameter type, an inject decorator, a `this.<name>` property, a local variable, or a property of another client (`prisma.user`, `em.getRepository(User)`, `kafka.producer()`). A call on a value that comes from a known client package is an exit. A known client package stays a package even when the repo holds its source, as the Nest repo itself does. Names that the code does not import from a client package never make an exit, so a method called `find` or `send` on a repo class is not a database or message call.

`@Inject(TOKEN)` on a Nest `ClientProxy` or `ClientGrpc` finds its transport from an object literal in the repo with the same `name` and a `transport`, as `ClientsModule.register` takes. `@Inject(...)` of a factory call that holds a `Transport.X` argument gives a client of that transport.

## Findings

Detectors return `Finding` objects. `types.ts` holds the exact type. The fields:

| Field | Meaning |
|---|---|
| `direction` | `entry` or `exit` |
| `kind` | entry: `http`, `grpc`, `graphql`, `message`, `queue`, `cron`, `websocket`. exit: `database`, `cache`, `http-out`, `grpc-out`, `message-out`, `queue-out`, `cloud` |
| `protocol` | the library or transport, for example `nest`, `express`, `kafka`, `rmq`, `nats`, `bullmq`, `typeorm`, `prisma`, `kysely`, `axios`, `octokit`, `aws-ses` |
| `method` | entry: HTTP verb, or `GRPC`, `GRAPHQL`, `KAFKA`, `RMQ`, `NATS`, `MQTT`, `REDIS`, `TCP`, `MESSAGE`, `QUEUE`, `CRON`, `WS`. exit: the operation, such as `find`, `persist`, `send`, `emit`, `get`, `POST` |
| `target` | entry: HTTP path with prefixes, `Service/Method`, topic or pattern, queue name, schedule. exit: entity or table, topic, queue, URL or host, `Service/Method`, cloud service and operation |
| `resolved` | `true` when `target` is a folded literal |
| `module`, `file`, `line` | where the finding is in the source |
| `symbol` | owner, for example `UserController.getInfo` or `handleUser` |
| `node` | id of the node that owns the finding |
| `rule` | the detector rule, for example `nest-http-decorator` |

Exit targets of note: MikroORM `flush` writes the unit of work, so its target is `(unit of work)`. A `persist` or `remove` target is the entity when the argument is `new Entity()`, `repo.create(...)` or `em.create(Entity, ...)`, directly or through a local. A `PrismaClient` imported from a path with `prisma` in it, or from a relative path that is not in the repo, is a generated Prisma client.

Entry targets of schedules: a cron expression as written, `every <n>ms` for an interval and `after <n>ms` for a timeout. A WebSocket target is `/<namespace> <message>` when the gateway has a namespace.

Owners of entries: a handler method owns its decorator finding, also when it is inherited from a base class. Then the finding has the file and line of the base class method, and the node and module of the subclass. A named function passed as a handler owns the finding: a bullmq `Worker` processor, or the `eachMessage` or `eachBatch` of a kafkajs consumer's `run`.

One exception to the rule on unresolved values: a Redis or NATS `subscribe` whose channel does not fold makes no finding, because `subscribe` is also an RxJS method and the noise would be large.

Node ids: `<module>:<ClassName>` for a class, `<module>:<file>#<functionName>` for a function, `<module>:<file>` for code at the top level of a file.

## Data map (T-06)

`extractTypeScript(root, opts)` runs every detector and builds the data map:

- One endpoint per entry finding. `method` is the finding method. `path` is the target. `entry` is the node. Extra fields: `kind`, `protocol`, `module`, `file`, `line`.
- Nodes: every class and function that owns a finding, and every class reached from those by an index call. Kinds: `controller`, `resolver`, `consumer`, `worker`, `gateway`, `service`, `repository`, `client`, `function`. Extra field: `module`.
- `sync` edges: index calls between nodes, with rule `di-call`. Only calls made in method bodies count. An injected dependency that is never called makes no edge.
  - Inherited methods and dependencies count as the subclass's own. When a base class owns findings, the subclass links to it with rule `extends`.
  - A dependency on a class with provider bindings links to each bound class. A dependency on an abstract class with no binding links to each subclass in the repo.
  - A call to a class that extends an ORM client (`PrismaClient`, `EntityRepository`, `Repository`, `Kysely`) makes no edge when no class of the repo declares the method: the call is an exit of the caller.
  - Calls to loggers (class names that end in `Logger`, `LoggerService`, `LoggingService` or `LoggingRepository`) make no edge.
- `sync` edges with rule `fn-call`: a call to a top-level function that owns a finding.
- `async` edges: a `message-out` or `queue-out` finding whose target matches a `message` or `queue` entry in the repo links the producer node to the consumer node, with `queue` set to the topic or queue name. The protocols must be compatible: the same transport (Kafka with Kafka, RabbitMQ with RabbitMQ), or a `nest` entry or exit, which stands for any transport. When consumers in the producer's module match, only those link.
- Producers behind a wrapper: when an unresolved `message-out` or `queue-out` target names a parameter of its method, as in `emitMessage(topic, msg)`, each call of that method whose argument folds links the caller to the matching consumers. The rule is the exit rule with `-via-wrapper`.
- A `grpc-out` finding whose `Service/Method` matches a `grpc` entry in the repo links the client node to the handler node with a `sync` edge, rule `grpc-call`.
- `io` edges: every other exit finding links its node to an external. One external per kind and protocol, for example `database:mikro-orm` named `Database (MikroORM)`, `message-out:kafka` named `Kafka`, `cloud:aws-ses` named `AWS SES`.
- `grpc-out` and `grpc` targets compare without the proto package and without case: `user.UserService/GetUser` matches `UserService/getUser`.
- An exit that links to a consumer in the repo, by `async` or `grpc-call`, makes no `io` edge.
- The rule of a direct `async` edge is the exit kind, `message-out` or `queue-out`.
- Edges are unique by `from`, `to`, `kind` and `queue`. The first rule wins.
- Node kinds come from the class name first (`...Controller`, `...Resolver`, `...Gateway`, `...Consumer`, `...Listener`, `...Handler`, `...Processor`, `...Worker`, `...Repository`, `...Client`, `...Producer`, `...Mailer` and others), then from the class decorators, then from what the class extends, then from the kind of entry it owns. A class with none of these is a `service`.
- The data map has `system` (the root `package.json` name, else the directory name), `language` (`TypeScript`) and `framework` (`NestJS`, `Express`, `Fastify`, `Koa` or `Hono`, joined with commas when there are more than one).
- A `survey` section: `{ modules, entries, exits }`, where `entries` and `exits` are the findings sorted by module, file and line.

With `--include`, `extract` keeps the endpoints that match, every node reachable from them along edges, and the externals those nodes reach. Parameter names do not matter in a match, as for Rails.

## Survey output (T-07)

`ccircuit survey` and `ccircuit extract` find the language of the directory. A directory with `config/routes.rb` and a `Gemfile` is Rails. A directory with `package.json`, `tsconfig.json` or a `.ts` file within six levels is TypeScript. `--lang ts` or `--lang rails` sets the language. On a Rails app, `survey` lists the routes as entries and the `io` edges as exits.

`ccircuit survey <dir> [--json] [--lang ts|rails] [--include "METHOD target"]...` prints the survey. With `--include`, it keeps the matching entries and the exits of the nodes they reach. Text output groups by module, then by direction, then by kind. Each line holds method, target, symbol and `file:line`. Unresolved targets show with a `?` mark. Each module ends with its counts, and the last line gives the totals. `--json` prints the survey section of the data map.

[e2e/nest-turbo-starter-survey.txt](e2e/nest-turbo-starter-survey.txt) is the survey of the example repo. [e2e/nest-turbo-starter-data-map.json](e2e/nest-turbo-starter-data-map.json) is its data map, and [e2e/nest-turbo-starter-board.png](e2e/nest-turbo-starter-board.png) is the board. They were made from commit `93b761fee763dbed5e044af51d6a5d4f7847c775` of the example.

## Known limits

- There is no type checker. A value whose client cannot be found from imports, types written in the code, or assignments makes no exit.
- A target that does not fold stays as source text with `resolved: false`. Such targets make no `async` or `grpc-call` link.
- Wrapper classes such as an `HttpService` that wraps axios show their exits in the wrapper, with the URL parameter as an unresolved target. Callers link to the wrapper with `di-call` edges.
- Calls through a dependency are seen only as `this.<dep>.<method>(...)`. A dependency copied to a local first is not followed.
- Code that registers handlers at run time from a list, or that builds routes in a loop, makes findings only where the values fold.
