import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DataMap } from "../src/datamap.ts";
import { MAX_COLUMNS, findCrossings, layoutBoard, shortLabel } from "../src/layout.ts";
import { SKETCH_JSON } from "./helpers/sketch.ts";

const sketch = (): DataMap => JSON.parse(readFileSync(SKETCH_JSON, "utf8"));

test("no trace crosses a chip on the sketch data map", () => {
  const b = layoutBoard(sketch());
  expect(findCrossings(b)).toEqual([]);
});

test("every node is placed once, on a free cell", () => {
  const b = layoutBoard(sketch());
  expect(b.nodes).toHaveLength(30);
  const cells = new Set(b.nodes.map((n) => `${n.column}:${n.row}`));
  expect(cells.size).toBe(30);
});

test("entry nodes sit in column 0 and a callee sits right of its caller", () => {
  const m = sketch();
  const b = layoutBoard(m);
  const col = new Map(b.nodes.map((n) => [n.id, n.column]));
  for (const e of m.endpoints) expect(col.get(e.entry)).toBe(0);
  expect(col.get("s_post")!).toBeGreaterThan(col.get("c_statuses")!);
  expect(col.get("w_distribution")!).toBeGreaterThan(col.get("s_post")!);
  expect(col.get("w_fanout")!).toBeGreaterThan(col.get("w_distribution")!);
});

test("every edge and endpoint has a trace of orthogonal segments", () => {
  const m = sketch();
  const b = layoutBoard(m);
  expect(b.traces).toHaveLength(m.edges.length + m.endpoints.length);
  for (const t of b.traces) {
    expect(t.points.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < t.points.length; i++) {
      const [a, c] = [t.points[i - 1], t.points[i]];
      expect(a[0] === c[0] || a[1] === c[1]).toBe(true);
    }
  }
});

test("a queue hop runs along the lane of its queue", () => {
  const b = layoutBoard(sketch());
  const lane = new Map(b.lanes.map((l) => [l.queue, l.y]));
  expect([...lane.keys()].sort()).toEqual(["default", "ingress", "pull", "push"]);
  const hop = b.traces.find((t) => t.kind === "async" && t.queue === "push")!;
  const ys = hop.points.map((p) => p[1]);
  const laneY = lane.get("push")!;
  expect(Math.max(...ys)).toBeGreaterThanOrEqual(laneY);
  expect(Math.max(...ys)).toBeLessThan(laneY + 20);
});

test("a sync call to the same or an earlier column runs along a channel between rows", () => {
  const b = layoutBoard(sketch());
  const nodes = new Map(b.nodes.map((n) => [n.id, n]));
  const back = b.traces.filter((t) => t.kind === "sync" && nodes.has(t.from) && nodes.get(t.to)!.column <= nodes.get(t.from)!.column);
  expect(back.length).toBeGreaterThan(0);
  for (const t of back) {
    const long = t.points.slice(1).map((p, i) => [t.points[i], p]).filter(([a, c]) => a[1] === c[1] && Math.abs(a[0] - c[0]) > 100);
    expect(long.length).toBeGreaterThan(0);
    for (const [a] of long) expect(b.nodes.some((n) => a[1] > n.y && a[1] < n.y + n.h)).toBe(false);
  }
});

test("a forward sync call never skips a column", () => {
  const b = layoutBoard(sketch());
  const nodes = new Map(b.nodes.map((n) => [n.id, n]));
  for (const t of b.traces) {
    if (t.kind === "io" || !nodes.has(t.from) || !nodes.has(t.to)) continue;
    expect(nodes.get(t.to)!.column - nodes.get(t.from)!.column).toBeLessThanOrEqual(1);
  }
});

test("a backward call in the same column loops through the gutter without crossing", () => {
  const m: DataMap = {
    endpoints: [{ id: "e", method: "GET", path: "/", entry: "a" }],
    nodes: ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase(), kind: "service" })),
    edges: [
      { from: "a", to: "b", kind: "sync" },
      { from: "b", to: "c", kind: "sync" },
      { from: "c", to: "a", kind: "sync" },
      { from: "c", to: "b", kind: "sync" },
      { from: "b", to: "b", kind: "sync" },
    ],
    externals: [],
  };
  const b = layoutBoard(m);
  expect(findCrossings(b)).toEqual([]);
  expect(b.nodes.find((n) => n.id === "a")!.column).toBe(0);
});

test("a chip deeper than the column limit goes to the overflow column and is logged", () => {
  const n = MAX_COLUMNS + 3;
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const m: DataMap = {
    endpoints: [{ id: "e", method: "GET", path: "/", entry: "n0" }],
    nodes: ids.map((id) => ({ id, name: id, kind: "service" })),
    edges: ids.slice(1).map((id, i) => ({ from: ids[i], to: id, kind: "sync" as const })),
    externals: [{ id: "x", name: "Postgres" }],
  };
  m.edges.push({ from: ids[n - 1], to: "x", kind: "io" });
  const b = layoutBoard(m);
  expect(b.overflow).toEqual(ids.slice(MAX_COLUMNS));
  expect(b.log.length).toBe(b.overflow.length);
  expect(b.log[0]).toContain("overflow");
  expect(findCrossings(b)).toEqual([]);
  expect(b.columns.at(-1)).toBe("OVERFLOW");
});

test("findCrossings reports a trace laid over a chip", () => {
  const b = layoutBoard(sketch());
  const n = b.nodes[0];
  b.traces[0].points = [[n.x - 5, n.y + 10], [n.x + n.w + 5, n.y + 10]];
  expect(findCrossings(b).some((c) => c.node === n.id)).toBe(true);
});

test("a large graph still has no crossing", () => {
  const N = 150;
  const ids = Array.from({ length: N }, (_, i) => `n${i}`);
  const edges: DataMap["edges"] = [];
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 1; i < N; i++) {
    edges.push({ from: ids[Math.floor(rnd() * i)], to: ids[i], kind: rnd() < 0.3 ? "async" : "sync", queue: "q" + Math.floor(rnd() * 3) });
    if (rnd() < 0.5) edges.push({ from: ids[Math.floor(rnd() * N)], to: ids[Math.floor(rnd() * N)], kind: "sync" });
    if (rnd() < 0.2) edges.push({ from: ids[i], to: "x" + Math.floor(rnd() * 3), kind: "io" });
  }
  for (const e of edges) if (e.kind !== "async") delete e.queue;
  const m: DataMap = {
    endpoints: [0, 1, 2].map((i) => ({ id: "e" + i, method: "GET", path: "/" + i, entry: ids[i] })),
    nodes: ids.map((id) => ({ id, name: id, kind: "service" })),
    edges,
    externals: [0, 1, 2].map((i) => ({ id: "x" + i, name: "X" + i })),
  };
  expect(findCrossings(layoutBoard(m))).toEqual([]);
});

test("shortLabel drops namespaces and truncates", () => {
  expect(shortLabel("Status (ActiveRecord)")).toBe("Status");
  expect(shortLabel("Api::V1::Statuses::FavouritesController#create")).toBe("FavouritesController#create");
  expect(shortLabel("A".repeat(40)).length).toBe(27);
});
