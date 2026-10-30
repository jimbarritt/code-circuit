# code-circuit

`ccircuit` draws a service as a circuit board.

Endpoints sit on the edge of the board as pads. Modules, classes and functions are chips. Traces show execution paths between them. Queue hops run through named lanes. Databases, caches and remote systems sit on the far edge. The board is interactive, so you can follow a path from an endpoint through the service and see where it ends.

The purpose is navigation. In a large repository or a monorepo with many endpoints, the board shows which chips many endpoints share and which sit inside a single path. A chip reached by one endpoint is a candidate seam.

**Status: first version.** `ccircuit extract` reads a Rails app and `ccircuit render` draws the data map. A hand-drawn board of six Mastodon endpoints stays in [src/html/sketch/](src/html/sketch/) and is unchanged. The mission report is [docs/report.md](docs/report.md). The layout rules are in [docs/layout-rules.md](docs/layout-rules.md).

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

## Install

With [Homebrew](https://brew.sh) on macOS or Linux:

```bash
brew install jimbarritt/tap/ccircuit
```

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

The other two commands move a data map in and out of SQLite.

```bash
ccircuit import mastodon.json store.db
ccircuit export store.db > copy.json
```

## Test

```bash
bun test
CC_MASTODON=~/src/mastodon bun test    # also runs the extractor on a Mastodon checkout
```

## Stack

TypeScript on [Bun](https://bun.sh). SQLite through `bun:sqlite`. The Ruby extractor reads source with line-based rules, not a parser. SVG in the browser for the board, with no library.

## Test system

[Mastodon](https://github.com/mastodon/mastodon) is the first target. It has REST endpoints, Postgres, Redis, Sidekiq queues, and inbound and outbound ActivityPub traffic.

## Licence

To be decided.

## Licence

MIT. See [LICENSE](LICENSE).
