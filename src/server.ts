import type { Database } from "bun:sqlite";
import PAGE from "./render/board.html" with { type: "text" };
import { layoutBoard } from "./layout.ts";
import { reachCounts, reachedBy, reachFrom } from "./reach.ts";
import { exportDataMap } from "./store.ts";

const json = (v: unknown, status = 200) => Response.json(v, { status });

/** Serves the board for the data map held in the store. Every query runs against the store. */
export function serveBoard(db: Database, opts: { port?: number; title?: string } = {}) {
  const map = exportDataMap(db);
  const board = { ...layoutBoard(map), title: opts.title ?? (map.system ? `${map.system} circuit board` : "Circuit board") };
  for (const line of board.log) console.error(`cc: ${line}`);
  return Bun.serve({
    port: opts.port ?? 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/":
          return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
        case "/api/board":
          return json(board);
        case "/api/datamap":
          return json(exportDataMap(db));
        case "/api/seams":
          return json(reachCounts(db));
        case "/api/reach": {
          const r = reachFrom(db, url.searchParams.get("endpoint") ?? "");
          return r ? json(r) : json({ error: "unknown endpoint" }, 404);
        }
        case "/api/reached-by":
          return json({ endpoints: reachedBy(db, url.searchParams.get("id") ?? "") });
        default:
          return json({ error: "not found" }, 404);
      }
    },
  });
}
