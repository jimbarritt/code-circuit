# TypeScript extractor: design

This document defines the contracts of the TypeScript extractor. Mission `M-CCT-TSEXTRACT` builds it. `ccircuit extract` and `ccircuit survey` use it on a TypeScript repo.

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

1. `workspaces` in the root `package.json` (array, or `{ packages: [...] }`), `pnpm-workspace.yaml` `packages`, `lerna.json` `packages`. Expand globs such as `apps/*` and `packages/**`.
2. Nx: every `project.json` outside skipped directories, unless a workspace module has the same directory.
3. Every `package.json` or `tsconfig.json` below the root, outside skipped directories, whose directory holds `.ts` files and is not inside a workspace or Nx module.
4. The root itself, always, as the fallback module.

A module has a name: the `name` of its `package.json`, else the `name` of its `project.json`, else its directory relative to the root. Module names are unique. When a name is taken, a later module is named `<name> (<dir>)`, and the root is named `<name> (root)`. Import resolution still uses the `package.json` name. A file belongs to the module with the deepest directory that contains it.

Import resolution: `project.resolveImport(fromRel, specifier)` returns a file path relative to the root, or `undefined`. It handles:

- relative specifiers, with `.ts`, `.tsx`, `/index.ts`;
- `compilerOptions.paths` and `baseUrl` from the nearest `tsconfig.json`, following `extends` chains to files inside the repo;
- workspace package names, to the package's `main`, `types` or `src/index.ts`;
- a bare specifier that matches a module directory such as `src/config/app.config` under `baseUrl`.

## Symbol index (T-03)

`buildIndex(project): SymbolIndex` lists every class and every top-level function, with decorators, constructor dependencies, methods and the calls made inside each method.

- A constructor parameter with a type reference, or `@Inject(TOKEN)`, or `@InjectRepository(Entity)`, or `@InjectModel(Name)`, or `@InjectQueue(name)` is a dependency. The index records the parameter name, the type name, the token text, and the class it resolves to when the class is in the repo.
- `this.<dep>.<method>(...)` inside a method is a call. The index records the dependency, the method and the line.
- `resolveValue(expr, fileRel)` folds an expression to a string when it can: string literals, no-substitution templates, templates whose parts fold, `+` of folded parts, `const` identifiers in the same file or imported from another file, enum members, and property access on a `const` object literal (`TOPICS.USER_CREATED`), including `as const`.

## Findings

Detectors return `Finding` objects. `types.ts` holds the exact type. The fields:

| Field | Meaning |
|---|---|
| `direction` | `entry` or `exit` |
| `kind` | entry: `http`, `grpc`, `graphql`, `message`, `queue`, `cron`, `websocket`. exit: `database`, `cache`, `http-out`, `grpc-out`, `message-out`, `queue-out`, `cloud` |
| `protocol` | the library or transport, for example `nest`, `express`, `kafka`, `rmq`, `nats`, `bullmq`, `typeorm`, `prisma`, `axios`, `aws-ses` |
| `method` | entry: HTTP verb, or `GRPC`, `GRAPHQL`, `KAFKA`, `RMQ`, `NATS`, `MQTT`, `REDIS`, `TCP`, `MESSAGE`, `QUEUE`, `CRON`, `WS`. exit: the operation, such as `find`, `persist`, `send`, `emit`, `get`, `POST` |
| `target` | entry: HTTP path with prefixes, `Service/Method`, topic or pattern, queue name, schedule. exit: entity or table, topic, queue, URL or host, `Service/Method`, cloud service and operation |
| `resolved` | `true` when `target` is a folded literal |
| `module`, `file`, `line` | where the finding is in the source |
| `symbol` | owner, for example `UserController.getInfo` or `handleUser` |
| `node` | id of the node that owns the finding |
| `rule` | the detector rule, for example `nest-http-decorator` |

Node ids: `<module>:<ClassName>` for a class, `<module>:<file>#<functionName>` for a function, `<module>:<file>` for code at the top level of a file.

## Data map (T-06)

`extractTypeScript(root, opts)` runs every detector and builds the data map:

- One endpoint per entry finding. `method` is the finding method. `path` is the target. `entry` is the node. Extra fields: `kind`, `protocol`, `module`, `file`, `line`.
- Nodes: every class and function that owns a finding, and every class reached from those by an index call. Kinds: `controller`, `resolver`, `consumer`, `worker`, `gateway`, `service`, `repository`, `client`, `function`. Extra field: `module`.
- `sync` edges: index calls between nodes, with rule `di-call`. Only calls made in method bodies count. An injected dependency that is never called makes no edge.
- `async` edges: a `message-out` or `queue-out` finding whose target matches a `message` or `queue` entry in the repo links the producer node to the consumer node, with `queue` set to the topic or queue name.
- A `grpc-out` finding whose `Service/Method` matches a `grpc` entry in the repo links the client node to the handler node with a `sync` edge, rule `grpc-call`.
- `io` edges: every other exit finding links its node to an external. One external per kind and protocol, for example `database:mikro-orm` named `Database (MikroORM)`, `message-out:kafka` named `Kafka`, `cloud:aws-ses` named `AWS SES`.
- A `survey` section: `{ modules, entries, exits }`, where `entries` and `exits` are the findings sorted by module, file and line.

## Survey output (T-07)

`ccircuit survey <dir> [--json] [--lang ts|rails]` prints the survey. Text output groups by module, then by direction, then by kind. Each line holds method, target, symbol and `file:line`. Unresolved targets show with a `?` mark.
