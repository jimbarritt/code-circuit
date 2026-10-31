# code-circuit

`ccircuit` draws a service as a circuit board.

Endpoints sit on the edge of the board as pads. Modules, classes and functions are chips. Traces show execution paths between them. Queue hops run through named lanes. Databases, caches and remote systems sit on the far edge. The board is interactive, so you can follow a path from an endpoint through the service and see where it ends.

The purpose is navigation. In a large repository or a monorepo with many endpoints, the board shows which chips many endpoints share and which sit inside a single path. A chip reached by one endpoint is a candidate seam.

**Status: 0.2.0.** `ccircuit extract` reads a TypeScript repo or a Rails app and `ccircuit render` draws the data map. `ccircuit survey` lists every entry point and exit point of a repo. A hand-drawn board of six Mastodon endpoints stays in [src/html/sketch/](src/html/sketch/) and is unchanged. The mission report is [docs/report.md](docs/report.md). The layout rules are in [docs/layout-rules.md](docs/layout-rules.md). The TypeScript extractor is described in [docs/typescript-extractor.md](docs/typescript-extractor.md), and its detector rules are listed in [docs/typescript-rules.md](docs/typescript-rules.md).

## How it works

Two programs share one file format.

```
source code  ->  ccircuit extract  ->  data map (JSON)  ->  ccircuit render  ->  board in a browser
```

- `ccircuit extract` reads source code and writes a data map. It never draws.
- `ccircuit render` reads a data map and serves the board. It never reads source code.
- A hand-written data map renders the same way as an extracted one.
- SQLite holds the graph between the two. The JSON is its import and export.

## The data map

A data map holds four lists.

| List | Contents |
|---|---|
| `endpoints` | Inbound entry points: method, path, and the node that handles it. |
| `nodes` | Chips: name, kind, file. Workers also carry a queue name. |
| `edges` | Calls between nodes. Kind is `sync`, `async` or `io`. An `async` edge names its queue. |
| `externals` | Systems outside the service: database, cache, remote servers. |

Every edge records which extraction rule produced it.

The TypeScript extractor adds fields. An endpoint carries `kind` (`http`, `grpc`, `graphql`, `message`, `queue`, `cron`, `websocket`), `protocol`, `module`, `file` and `line`. A node carries `module`. The data map also holds a `survey` section with every finding. [docs/typescript-extractor.md](docs/typescript-extractor.md) defines them.

## Install

With [Homebrew](https://brew.sh) on macOS or Linux:

```bash
brew install jimbarritt/tap/ccircuit
```

The formula exists only after a release run writes it to `jimbarritt/homebrew-tap`. That needs the secret `HOMEBREW_TAP_TOKEN` (see Release). Until then, download a binary from the [releases](https://github.com/jimbarritt/code-circuit/releases) page or build from source.

To build from source:

```bash
bun install
bun run build        # bun build --compile, writes ./ccircuit
```

The result is one binary, `ccircuit`. It needs a browser at run time and nothing else.

## Release

Bump `version` in `package.json`, commit and push to `main`. The workflow in `.github/workflows/release.yml` runs the tests, tags the commit, creates the GitHub release, builds the binary for macOS and Linux (Apple silicon and Intel, arm64 and x86_64), and writes `Formula/ccircuit.rb` in `jimbarritt/homebrew-tap`. The `formula` job needs the secret `HOMEBREW_TAP_TOKEN` in the environment `release`.

## Use

```bash
ccircuit extract ~/src/mastodon > mastodon.json
ccircuit render mastodon.json
```

`render` prints a local URL. Open it.

Without options, `extract` writes every route of the app. For a Rails app of Mastodon's size, that gives a board too large to read. Name the endpoints to keep with `--include`. Parameter names do not matter in a match.

```bash
ccircuit extract ~/src/mastodon \
  --include "POST /api/v1/statuses" \
  --include "GET /api/v1/timelines/home" \
  --include "POST /api/v1/statuses/:id/favourite" \
  --include "POST /api/v1/accounts/:id/follow" \
  --include "POST /inbox" \
  --include "GET /api/v1/notifications" > mastodon.json
```

The result for these six endpoints is in [docs/e2e/mastodon-data-map.json](docs/e2e/mastodon-data-map.json). The board for it is [docs/img/mastodon-board.png](docs/img/mastodon-board.png).

On the board:

- Click a pad to light the path reachable from it. The rest dims.
- Click a chip to list the endpoints whose paths reach it. The inspector shows the rule that made each edge.
- Tab to a pad or chip and press Enter or Space to do the same.

## TypeScript

`ccircuit` reads TypeScript repos with the TypeScript compiler API. It parses each file but does not run the type checker, so the repo needs no `node_modules`.

It finds these entry points: NestJS HTTP, gRPC, GraphQL, WebSocket and microservice handlers; Express, Fastify, Koa and Hono routes, with their mount prefixes; kafkajs, amqplib, NATS and Redis subscribers; SQS pollers; BullMQ and Bull workers; Nest schedules, node-cron, `cron` and `setInterval`.

It finds these exit points: TypeORM, MikroORM, Prisma, Mongoose, Sequelize, Knex, Drizzle, Kysely, `pg` and `mysql2`; ioredis, node-redis, cache-manager and Keyv; axios, got, fetch, undici, Nest `HttpService` and Octokit; gRPC stubs; Nest client proxies, kafkajs, amqplib, NATS and Redis producers, and nodemailer; BullMQ and Bull queues; the AWS SDK v2 and v3, and Google OAuth2.

A call is an exit only when the client comes from one of these packages, by import, type or assignment. A producer whose topic matches a consumer in the repo links to it with a queue hop. A gRPC call whose service and method match a handler in the repo links to it directly.

### Modules

A repo can have one module or many. `ccircuit` does not need pnpm or Turborepo. It merges these sources:

1. `workspaces` in `package.json` (npm and yarn), `pnpm-workspace.yaml`, and `lerna.json`;
2. Nx `project.json` files;
3. any other directory with a `package.json` or `tsconfig.json` and `.ts` files;
4. the root, for files no other module holds.

Imports resolve through relative paths, `tsconfig.json` `paths` and `baseUrl` (with `extends`), and workspace package names. Build output, `node_modules`, tests and `*.d.ts` files are skipped.

### Survey

`ccircuit survey` prints every entry point and exit point, grouped by module, direction and kind, with the file and line. A `?` marks a target that is not a literal in the source.

```bash
ccircuit survey ~/src/nest-turbo-starter
ccircuit survey ~/src/nest-turbo-starter --json
ccircuit survey ~/src/nest-turbo-starter --include "GRPC UserService/GetUser"
```

`ccircuit extract` and `ccircuit survey` find the language of the directory. Use `--lang ts` or `--lang rails` to set it. With `--include`, `survey` keeps the matching entries and the exits of the code they reach.

Part of the survey of [nest-turbo-starter](https://github.com/typv/nest-turbo-starter), a Turborepo with three NestJS services that call each other over gRPC:

```
notification-service
  entries
    http (1)
      GET                     /api                                        AppController.getHello                         apps/notification-service/src/modules/app.controller.ts:10
    grpc (1)
      GRPC                    NotificationService/SendForgotPasswordMail  SendMailConsumer.sendMail                      apps/notification-service/src/modules/send-mail/send-mail.consumer.ts:16
  exits
    message-out (1)
      sendMail                this.smtpConfig.smtpHost?                   SmtpEmailService.sendEmail                     apps/notification-service/src/modules/email/smtp-email.service.ts:39
    cloud (1)
      SendEmail               SES/SendEmail                               SesEmailService.sendEmail                      apps/notification-service/src/modules/email/ses-email.service.ts:62
  notification-service: 2 entries, 2 exits

total: 19 entries, 57 exits in 7 modules
```

The full survey is [docs/e2e/nest-turbo-starter-survey.txt](docs/e2e/nest-turbo-starter-survey.txt). The data map is [docs/e2e/nest-turbo-starter-data-map.json](docs/e2e/nest-turbo-starter-data-map.json), and the board for it is [docs/e2e/nest-turbo-starter-board.png](docs/e2e/nest-turbo-starter-board.png).

```bash
ccircuit extract ~/src/nest-turbo-starter > nest.json
ccircuit render nest.json
```

### Known limits

- There is no type checker. A call is an exit only when its client can be traced from imports, written types or assignments.
- A target that is not a literal in the source, such as a URL or a cache key passed in as a method parameter, shows with a `?`. It makes no queue hop or gRPC link.
- A wrapper class around a client, such as an `HttpService` around axios, shows the exit in the wrapper. Callers link to the wrapper.
- Calls through a dependency are seen only as `this.<dep>.<method>(...)`. A dependency copied to a local variable first is not followed. In a chain such as `this.repo.qb.where().getOne()`, only the first call is recorded.
- Class expressions (`const H = class {}`) and anonymous default classes are not indexed. Their findings belong to the file.
- GraphQL resolvers built by a class factory make no findings.
- Redis and NATS `subscribe` calls whose channel is not a literal are dropped, because RxJS uses the same method name.
- In a module that listens on several transports, a message consumer can link to a producer on another transport.
- nodemailer `sendMail` shows as a `message-out` exit. Command line entry points (nest-commander, commander, yargs) are not found.
- Handlers registered at run time from a list, or routes built in a loop, make findings only where the values are literals.

## Store

The other two commands move a data map in and out of SQLite.

```bash
ccircuit import mastodon.json store.db
ccircuit export store.db > copy.json
```

## Test

```bash
bun test
CC_MASTODON=~/src/mastodon bun test    # also runs the extractor on a Mastodon checkout
CC_NEST=~/src/nest-turbo-starter bun test    # also runs the extractor on a nest-turbo-starter checkout
```

## Stack

TypeScript on [Bun](https://bun.sh). SQLite through `bun:sqlite`. The Ruby extractor reads source with line-based rules, not a parser. The TypeScript extractor parses source with the `typescript` 5.9 compiler API. SVG in the browser for the board, with no library.

## Test system

[Mastodon](https://github.com/mastodon/mastodon) is the Rails target. It has REST endpoints, Postgres, Redis, Sidekiq queues, and inbound and outbound ActivityPub traffic.

[nest-turbo-starter](https://github.com/typv/nest-turbo-starter) is the TypeScript target. It is a Turborepo with pnpm, NestJS, gRPC, MikroORM, ioredis, axios and AWS SES.

## Licence

MIT. See [LICENSE](LICENSE).
