import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DataMap } from "../src/datamap.ts";
import { reachCounts, reachedBy, reachFrom } from "../src/reach.ts";
import { importDataMap, openStore } from "../src/store.ts";
import { SKETCH_JSON } from "./helpers/sketch.ts";

const map: DataMap = JSON.parse(readFileSync(SKETCH_JSON, "utf8"));
const db = openStore();
importDataMap(db, map);

/** The sketch's own breadth-first search, applied to the data map. */
function bfs(entry: string) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of map.edges) if (e.from === n && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
  }
  return seen;
}

test("reachFrom matches a breadth-first search for every endpoint of the sketch", () => {
  for (const ep of map.endpoints) {
    const r = reachFrom(db, ep.id)!;
    const want = bfs(ep.entry);
    expect(new Set(r.nodes)).toEqual(want);
    const wantEdges = map.edges.map((e, i) => (want.has(e.from) ? i : -1)).filter((i) => i >= 0);
    expect(r.edges).toEqual(wantEdges);
  }
});

test("POST /api/v1/statuses reaches the worker chain and Postgres", () => {
  const r = reachFrom(db, "e_statuses")!;
  for (const id of ["s_post", "w_distribution", "w_fanout", "a_feedmanager", "w_ap_delivery", "x_redis", "x_remote", "x_pg"]) {
    expect(r.nodes).toContain(id);
  }
  expect(r.nodes).not.toContain("c_home");
});

test("reachedBy lists the endpoints whose paths reach a chip", () => {
  expect(reachedBy(db, "c_notif")).toEqual(["e_notif"]);
  expect(reachedBy(db, "m_status")).toEqual(["e_statuses", "e_inbox"]);
  expect(reachedBy(db, "x_pg").length).toBe(6);
});

test("reachCounts agrees with reachedBy", () => {
  const c = reachCounts(db);
  expect(c["m_status"]).toBe(2);
  expect(c["c_notif"]).toBe(1);
});

test("a cycle in the edges terminates", () => {
  const cyc: DataMap = {
    endpoints: [{ id: "e", method: "GET", path: "/", entry: "a" }],
    nodes: [{ id: "a", name: "A", kind: "service" }, { id: "b", name: "B", kind: "service" }],
    edges: [{ from: "a", to: "b", kind: "sync" }, { from: "b", to: "a", kind: "sync" }],
    externals: [],
  };
  const d = openStore();
  importDataMap(d, cyc);
  expect(reachFrom(d, "e")!.nodes.sort()).toEqual(["a", "b"]);
});

test("an unknown endpoint gives null", () => {
  expect(reachFrom(db, "nope")).toBeNull();
});
