# code-circuit

`cc` draws a service as a circuit board.

Endpoints sit on the edge of the board as pads. Modules, classes and functions are chips. Traces show execution paths between them. Queue hops run through named lanes. Databases, caches and remote systems sit on the far edge. The board is interactive, so you can follow a path from an endpoint through the service and see where it ends.

The purpose is navigation. In a large repository or a monorepo with many endpoints, the board shows which chips many endpoints share and which sit inside a single path. A chip reached by one endpoint is a candidate seam.

**Status: sketch.** A hand-drawn board of six Mastodon endpoints exists in [src/html/sketch/](src/html/sketch/). The product does not exist yet. The work is defined in [issue 1](../../issues/1).

## How it works

Two programs share one file format.

```
source code  ->  cc extract  ->  data map (JSON)  ->  cc render  ->  board in a browser
```

- `cc extract` reads source code and writes a data map. It never draws.
- `cc render` reads a data map and serves the board. It never reads source code.
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

```bash
bun install
bun run build        # bun build --compile, writes ./cc
```

The result is one binary, `cc`. It needs a browser at run time and nothing else.

## Use

```bash
cc extract ~/src/mastodon > mastodon.json
cc render mastodon.json
```

`render` prints a local URL. Open it.

## Stack

TypeScript on [Bun](https://bun.sh). SQLite through `bun:sqlite`. Tree-sitter for parsing. SVG in the browser for the board.

## Test system

[Mastodon](https://github.com/mastodon/mastodon) is the first target. It has REST endpoints, Postgres, Redis, Sidekiq queues, and inbound and outbound ActivityPub traffic.

## Licence

To be decided.
