# ts-plain fixture

A repo with no workspaces. The root `package.json` has no `workspaces` field. It has no `node_modules`: the code only needs to parse.

## Modules

| Module | Directory | How it is found |
|---|---|---|
| `@plain/gateway` | `gateway` | `package.json` and `tsconfig.json`, with a `paths` alias `@db/*` |
| `jobs` | `jobs` | Nx `project.json` and `tsconfig.json`, with no `package.json` |
| `ts-plain` | `.` | The root fallback module. It holds no source. |

## What it tests

- Express routes, and an `express.Router()` mounted with `app.use('/users', usersRouter)` in another file.
- Fastify `get` and `route({ method, url })`, and a Koa router with a `prefix`.
- `axios`, `fetch` and `got`.
- kafkajs `producer.send` and `consumer.subscribe` with `topic` and with `topics`.
- amqplib `publish`, `sendToQueue` and `consume`.
- AWS SQS `SendMessageCommand` and a `ReceiveMessageCommand` poller, and SNS `PublishCommand`.
- mongoose, knex, pg, drizzle, node-redis, sequelize, node-cron and `setInterval`.
- Targets from `process.env` and from string concatenation. These must stay in the survey with `resolved: false` and the source text as the target. The Kafka topic of `publishSignup` does not fold, so it makes no link to the `user.signup` consumer.

## EXPECTED.json

`EXPECTED.json` holds the ground truth: `modules`, `entries`, `exits` and `links`. The fields follow `docs/typescript-extractor.md`. These rules apply:

- `line` is the line where the call starts.
- The `symbol` of a route, consumer or schedule with a named handler is the handler name. Where the handler is not named, as in kafkajs `subscribe` and the SQS poller, it is the enclosing function.
- The `symbol` of an exit is the enclosing function.
- An unresolved `target` is the exact source text of the expression.
- An amqplib `publish` target is `<exchange>/<routing key>`.
- A link has `from_symbol`, `to_symbol`, `via`, `kind` (`async` or `sync`) and `protocol`.

The expected modules assume that discovery finds both the Nx project and the `package.json` module. The rule "the first source that yields modules wins" in the design note finds only `jobs`, and puts `gateway` in the root module.
