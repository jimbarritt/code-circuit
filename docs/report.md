# Mission report: M-CCT-BOOT

## Outcome

Done. All 15 tasks reached `done`. `bun test` passes with 58 tests. `bun run build` produces one binary, `cc`.

| Task | Attempts |
|---|---|
| T-01 to T-07, T-11 to T-15 | 1 |
| T-08 Rails extractor | 2 |
| T-09 End to end | 2 |
| T-10 This report | 1 |

T-08 needed a second attempt because the Ruby scanner dropped the closing brace of `"#{...}"` interpolation. Every route after the first such line in `config/routes.rb` was lost, and the first Mastodon run found 0 endpoints. T-09 needed a second attempt because the first layout put 109 of 170 chips in the overflow column.

The essential task, T-09, is met on its stated terms. The extracted Mastodon map renders with no trace over a chip. The board is [img/mastodon-board.png](img/mastodon-board.png). The data map is [e2e/mastodon-data-map.json](e2e/mastodon-data-map.json). It was extracted from Mastodon commit `147bfc1f1784b173a1ce157830c480787dd13fe0`.

## Account

I added five tasks to the plan: T-11 layout rules, T-12 fixture Rails app, T-13 Mastodon clone, T-14 embedded page, T-15 usage section. I kept the sketch unchanged. I built the product beside it.

Numbers for the extracted map of six endpoints: 169 chips, 459 edges, 4 externals, 4 queues, 7 chips in the overflow column, a board of 3584 by 2970 pixels. The hand-drawn sketch has 30 chips and 42 edges for the same six endpoints.

## What the sketch failed to predict

1. **Size.** The sketch shows 30 chips. The extractor finds 169 for the same six endpoints. Selecting `POST /api/v1/statuses` lights 417 of 459 traces. The sketch's 17 chips on that path were a hand selection. The board at full size has no crossings and is hard to read.
2. **Parameter names.** The sketch writes `/api/v1/statuses/:id/favourite`. Rails names the parameter `:status_id` for a resource nested in `resources :statuses`. A match on endpoint text fails unless parameter names are ignored. `cc extract --include` and the end-to-end test ignore them.
3. **Columns by kind do not hold.** The sketch puts controllers, services, models, workers and adapters in separate columns. A rule from the edge graph mixes kinds in every column. A worker can enqueue a worker that calls a service, so workers and services alternate.
4. **Longest-path depth fails on a real graph.** The first layout used the longest path from an entry chip. On the Mastodon map 109 of 170 chips had depth 8 or more. Shortest-path depth puts 7 chips in the overflow column. The sketch had no cycles to expose this.
5. **Forward calls do not skip columns.** Under shortest-path depth, a forward call reaches the next column at most. Every call to the same or an earlier column loops back through a channel. The sketch drew those loop-backs as an exception. On the extracted map they are common.
6. **Externals.** The sketch puts PostgreSQL on a rail along the top edge. The product puts every external on the right edge.

## What the briefing failed to give me

- Whether `cc extract` writes all routes or only the six. Mastodon has 754 routes that resolve to a controller file. I added `--include "METHOD /path"`. Without it, the output is every route.
- A readability criterion. "No trace crosses a chip" is true by construction of the router. It holds for any graph, so it does not test whether the board can be read. The layout test asserts it on a random graph of 150 chips.
- Which actions to follow. A route may name an action that a controller inherits from a concern. I follow only actions defined in the controller file.
- What a chip represents for a controller. I made one chip per controller action and one per class for everything else.

## What I found wrong in the briefing

- The README names tree-sitter in its Stack section. The briefing leaves the parser to me. I used line-based rules and changed the README. This costs accuracy, listed below.
- "Matches the sketch's model byte for byte" can mean the JSON the sketch's script produces, or the sketch's whole model. The script's JSON leaves out the endpoint-to-controller edges and the column and row of each chip. I took the first meaning and tested it by running the sketch's own script against a stub DOM.
- The plan names `cc import` and `cc export` in T-04 but not in the objective. I kept them as commands because the tests use them.

## What I found wrong in my own work

- The first layout rule and the first test of the skip-column routing were wrong. The test assumed a call two columns apart that does not exist under the final rule. I replaced it with a test of loop-backs and a test that no forward call skips a column.
- Routing rule 3 of the first draft of `docs/layout-rules.md` described a case that never occurs. I removed it.
- Gutter and channel tracks are packed by extent. Two traces can overlap along the stub that leaves a pin when they share a pin slot. This is a visual defect. It is not a crossing.
- The page shows a pad's label above its entry chip. The centre of the pad's bounding box lies on that chip, so a script that clicks the centre hits the chip. A person who clicks the circle is not affected. The end-to-end script clicks the circle.
- The overflow column holds chips from several depths in one column. Rows there are ordered by the same barycentre rule, with no regard to depth.

## Extractor heuristics that were wrong or weak

| Heuristic | Result on Mastodon |
|---|---|
| A constant anywhere in a service or worker file is a call from every path through that file | Over-reaches. This is the main cause of the 169 chips. A constant used in a rarely called method joins every endpoint that reaches the class. |
| A superclass in `class A < B` counted as a reference | Wrong. It added edges to `BaseService` and `ApplicationRecord`. Fixed by dropping the declaration before the scan. |
| A model follows adapters and queue hops only | Keeps models from pulling in the whole app. Adds 26 `model-uses-adapter` edges that the sketch did not draw. |
| Redis is any file with the word `redis` or `Rails.cache` | Matches 33 chips. It cannot tell a read from a write, or a feed from a cache. |
| Remote HTTP is `HTTP.`, `Faraday` or `Net::HTTP` | Finds one chip, `Request`. Calls made through other gems are missed. |
| A route's action must be defined in the controller file | Loses actions inherited from concerns or parent controllers. |
| `concern` blocks and `concerns:` options are skipped | Loses routes declared through concerns, for example the account routes in the top-level `config/routes.rb`. |
| A name resolves to the class with that name in `app/` | Cannot see dynamic dispatch, `constantize`, or a constant built from a string. |
| `push_bulk` counts as an enqueue of the worker | Right for the common case. It ignores the queue given in `set(queue: ...)`. |

Every edge carries `rule`. The rules in use are `rails-routes`, `sidekiq-enqueue`, `controller-uses-*`, `service-uses-*`, `worker-uses-*`, `model-uses-adapter`, `activerecord-model`, `redis-call`, `http-client` and `webpush-call`. The inspector shows the rule beside each input and output of a chip.
