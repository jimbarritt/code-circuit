import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { validateDataMap, type DataMap } from "../src/datamap.ts";
import { extractRails } from "../src/extract/rails.ts";
import { routeKey } from "../src/extract/routes.ts";
import { findCrossings, layoutBoard } from "../src/layout.ts";
import { reachFrom } from "../src/reach.ts";
import { importDataMap, openStore } from "../src/store.ts";

const SIX = [
  "POST /api/v1/statuses",
  "GET /api/v1/timelines/home",
  "POST /api/v1/statuses/:id/favourite",
  "POST /api/v1/accounts/:id/follow",
  "POST /inbox",
  "GET /api/v1/notifications",
];
const COMMITTED = new URL("../docs/e2e/mastodon-data-map.json", import.meta.url).pathname;

function check(map: DataMap) {
  expect(validateDataMap(map)).toEqual([]);
  const keys = map.endpoints.map((e) => routeKey(e.method, e.path));
  for (const s of SIX) expect(keys).toContain(routeKey(...(s.split(" ") as [string, string])));
  // each endpoint reaches a controller, a service and a queue edge with a named queue
  const db = openStore();
  importDataMap(db, map);
  for (const e of map.endpoints) expect(reachFrom(db, e.id)!.nodes.length).toBeGreaterThan(1);
  const queued = map.edges.filter((e) => e.kind === "async");
  expect(queued.length).toBeGreaterThan(0);
  for (const e of queued) expect(typeof e.queue).toBe("string");
  for (const e of map.edges) expect(typeof e.rule).toBe("string");
  const board = layoutBoard(map);
  expect(findCrossings(board)).toEqual([]);
}

test("the committed Mastodon data map has the six endpoints and renders with no trace over a chip", () => {
  check(JSON.parse(readFileSync(COMMITTED, "utf8")));
});

// Set CC_MASTODON to a Mastodon checkout to run the extractor against it.
const checkout = process.env.CC_MASTODON;
test.skipIf(!checkout || !existsSync(checkout))("extracting a Mastodon checkout gives the same kind of map", () => {
  check(extractRails(checkout!, { include: SIX }));
});
