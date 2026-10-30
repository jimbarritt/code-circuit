import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertDataMap, type DataMap } from "../src/datamap.ts";
import { EP_STEP, MAX_COLUMNS, endpointKind, externalKind, findCrossings, layoutBoard, shortLabel, shortMiddle } from "../src/layout.ts";
import { SKETCH_JSON } from "./helpers/sketch.ts";

const sketch = (): DataMap => JSON.parse(readFileSync(SKETCH_JSON, "utf8"));
const TS_SAMPLE = new URL("./fixtures/ts-sample-map.json", import.meta.url).pathname;
const tsSample = (): DataMap => JSON.parse(readFileSync(TS_SAMPLE, "utf8"));

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

test("the TypeScript sample map is valid and lays out with no crossing", () => {
  const m = assertDataMap(tsSample());
  const b = layoutBoard(m);
  expect(m.endpoints.length).toBeGreaterThanOrEqual(25);
  expect(b.nodes).toHaveLength(m.nodes.length);
  expect(b.traces).toHaveLength(m.edges.length + m.endpoints.length);
  expect(findCrossings(b)).toEqual([]);
});

test("every endpoint pad carries its kind, and pads of one chip do not overlap", () => {
  const m = tsSample();
  const b = layoutBoard(m);
  const pads = b.pads.filter((p) => p.side === "left");
  expect(new Set(pads.map((p) => p.kind))).toEqual(new Set(["http", "graphql", "websocket", "grpc", "message", "queue", "cron"]));
  const ys = pads.map((p) => p.y);
  expect(new Set(ys).size).toBe(ys.length);
  const nodes = new Map(b.nodes.map((n) => [n.id, n]));
  for (const p of pads) {
    const n = nodes.get(p.entry!)!;
    expect(p.y).toBeGreaterThan(n.y);
    expect(p.y).toBeLessThan(n.y + n.h);
    expect(p.x).toBeLessThan(b.left);
    const t = b.traces.find((t) => t.id === "ep:" + p.id)!;
    expect(t.points[0][1]).toBe(p.y);
  }
  const users = nodes.get("@acme/api:UsersController")!;
  expect(users.h).toBeGreaterThanOrEqual(5 * EP_STEP);
  const grpc = pads.find((p) => p.method === "GRPC")!;
  expect(grpc).toMatchObject({ protocol: "grpc", module: "@acme/orders-service", file: "apps/orders-service/src/orders/orders.grpc.controller.ts", line: 17 });
});

test("each module takes its own band of rows, in the order of the data map", () => {
  const b = layoutBoard(tsSample());
  expect(b.modules.map((m) => m.name)).toEqual(["@acme/api", "@acme/orders-service", "@acme/notification-worker"]);
  for (let i = 1; i < b.modules.length; i++) expect(b.modules[i].top).toBeGreaterThanOrEqual(b.modules[i - 1].bottom);
  const band = new Map(b.modules.map((m) => [m.name, m]));
  for (const n of b.nodes) {
    const m = band.get(n.module!)!;
    expect(n.y).toBeGreaterThan(m.top);
    expect(n.y + n.h).toBeLessThanOrEqual(m.bottom);
  }
});

test("a map with one module or none has no module bands and keeps its rows", () => {
  expect(layoutBoard(sketch()).modules).toEqual([]);
  const m = tsSample();
  for (const n of m.nodes) n.module = "one";
  expect(layoutBoard(m).modules).toEqual([]);
});

test("a topic or queue name with dots gets its own lane", () => {
  const b = layoutBoard(tsSample());
  expect(b.lanes.map((l) => l.queue)).toEqual(["audit.user.created", "email.send", "orders.order.created.v1", "sms.send"]);
  const lane = b.lanes.find((l) => l.queue === "orders.order.created.v1")!;
  const hop = b.traces.find((t) => t.kind === "async" && t.queue === "orders.order.created.v1")!;
  expect(Math.max(...hop.points.map((p) => p[1]))).toBeGreaterThanOrEqual(lane.y);
  expect(Math.max(...hop.points.map((p) => p[1]))).toBeLessThan(lane.y + 20);
});

test("long names are shortened so labels keep to their areas", () => {
  const b = layoutBoard(tsSample());
  for (const p of b.pads) expect(p.short!.length).toBeLessThanOrEqual(p.side === "left" ? 44 : 32);
  const long = b.pads.find((p) => p.path?.endsWith("/download"))!;
  expect(long.short).toContain("…");
  expect(long.short!.startsWith("/orders/")).toBe(true);
  expect(long.short!.endsWith("/download")).toBe(true);
  const chip = b.nodes.find((n) => n.name.startsWith("PaymentsHttpClient"))!;
  expect(chip.label.length).toBe(27);
  expect(b.width).toBeGreaterThan(Math.max(...b.pads.filter((p) => p.side === "right").map((p) => p.x)) + 24);
});

test("endpoint and external kinds fall back to the method and the id", () => {
  expect(endpointKind({ method: "GET" })).toBe("http");
  expect(endpointKind({ method: "KAFKA" })).toBe("message");
  expect(endpointKind({ method: "GRPC" })).toBe("grpc");
  expect(endpointKind({ method: "CRON" })).toBe("cron");
  expect(endpointKind({ method: "SOMETHING" })).toBe("http");
  expect(endpointKind({ method: "KAFKA", kind: "queue" })).toBe("queue");
  expect(externalKind({ id: "message-out:kafka" })).toBe("message-out");
  expect(externalKind({ id: "x_pg" })).toBeUndefined();
  expect(shortMiddle("abcdefghij", 5)).toBe("ab…ij");
  expect(shortMiddle("abc", 5)).toBe("abc");
});

test("an unknown node kind lays out like any other", () => {
  const m: DataMap = {
    endpoints: [{ id: "e", method: "TCP", path: "user.get", entry: "a" }],
    nodes: [{ id: "a", name: "A", kind: "guard" }, { id: "b", name: "B", kind: "service" }],
    edges: [{ from: "a", to: "b", kind: "sync" }],
    externals: [],
  };
  const b = layoutBoard(m);
  expect(b.nodes.map((n) => n.kind)).toEqual(["guard", "service"]);
  expect(b.pads[0].kind).toBe("message");
  expect(findCrossings(b)).toEqual([]);
});
