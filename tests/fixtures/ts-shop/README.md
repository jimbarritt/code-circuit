# ts-shop fixture

A small NestJS shop as an npm workspaces repo. It uses no pnpm and no Turborepo. It has no `node_modules`: the code only needs to parse.

## Modules

| Module | Directory | Contents |
|---|---|---|
| `@shop/orders-api` | `services/orders-api` | HTTP controllers with the global prefix `api`, a GraphQL resolver, a WebSocket gateway, TypeORM, a Kafka client, a BullMQ queue, a gRPC client, `HttpService` and `cache-manager` |
| `@shop/inventory-svc` | `services/inventory-svc` | A gRPC handler, Kafka consumers, Prisma, `@Cron` and `@Interval` |
| `@shop/mailer-worker` | `services/mailer-worker` | A BullMQ `@Processor`, a plain BullMQ `Worker` and `Queue`, AWS SES, AWS S3 and ioredis |
| `@shop/contracts` | `packages/contracts` | Shared topics as a `const` object and as an enum, queue names and DTOs |
| `ts-shop` | `.` | The root fallback module. It holds no source. |

## What it tests

- Module discovery from the `workspaces` array.
- Imports of `@shop/contracts` by package name.
- Topic names folded from `TOPICS.ORDER_CREATED` (`as const`) and `OrderTopic.Cancelled` (enum) in another module.
- HTTP paths that join the global prefix, the controller prefix and the route.
- Targets that do not fold, such as template keys and `process.env` URLs. These must stay in the survey with `resolved: false` and the source text as the target.
- Links across modules: Kafka producer to consumer, BullMQ producer to worker, and gRPC client to handler.

## EXPECTED.json

`EXPECTED.json` holds the ground truth: `modules`, `entries`, `exits` and `links`. The fields follow `docs/typescript-extractor.md`. These rules apply:

- `line` is the line of the decorator for a decorator finding, and the line where the call starts for a call.
- `symbol` is `Class.method`, or the function name for code in a top-level function.
- An unresolved `target` is the exact source text of the expression.
- A cloud target is `<Service>/<Operation>`, for example `SES/SendEmail`.
- A link has `from_symbol`, `to_symbol`, `via` (topic, queue or `Service/Method`), `kind` (`async` or `sync`) and `protocol`.
