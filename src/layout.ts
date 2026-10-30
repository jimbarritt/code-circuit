import type { DataMap } from "./datamap.ts";

/** Chip size, as in the sketch. */
export const CHIP_W = 190;
export const CHIP_H = 40;
/** Columns before the overflow column. */
export const MAX_COLUMNS = 8;

const TRACK = 4;
const SLOTS = 4;
const TOP = 44;
const GUTTER_MIN = 36;
const BAND_MIN = 20;
/** Vertical step between the endpoint traces that enter one chip. */
export const EP_STEP = 14;
/** Height of the header above the first row of a module band. */
const MOD_HEAD = 18;
/** Character width of the 10px monospace pad labels. */
const CH = 6.1;
const PATH_MAX = 44;
const EXT_MAX = 32;

const ENDPOINT_KIND: Record<string, string> = {
  GRPC: "grpc", GRAPHQL: "graphql", KAFKA: "message", RMQ: "message", NATS: "message", MQTT: "message", REDIS: "message",
  TCP: "message", MESSAGE: "message", QUEUE: "queue", CRON: "cron", WS: "websocket",
};
/** Kind of an endpoint: its own kind field, else a kind read from the method, else http. */
export function endpointKind(e: { method: string; kind?: unknown }): string {
  return typeof e.kind === "string" && e.kind ? e.kind : ENDPOINT_KIND[e.method.toUpperCase()] ?? "http";
}
/** Kind of an external: its own kind field, else the part of the id before the first colon. */
export function externalKind(x: { id: string; kind?: unknown }): string | undefined {
  if (typeof x.kind === "string" && x.kind) return x.kind;
  const i = x.id.indexOf(":");
  return i > 0 ? x.id.slice(0, i) : undefined;
}
/** Shortens text to max characters by cutting out the middle, so both ends stay readable. */
export function shortMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  return s.slice(0, head) + "…" + s.slice(s.length - (max - 1 - head));
}
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export type Point = [number, number];

export interface PlacedNode {
  id: string;
  label: string;
  name: string;
  kind: string;
  module?: string;
  file?: string;
  queue?: string;
  column: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedPad {
  id: string;
  side: "left" | "right";
  label: string;
  /** Endpoint kind (http, grpc, graphql, message, queue, cron, websocket), or external kind such as database. */
  kind?: string;
  method?: string;
  path?: string;
  /** Path or name shortened to fit the label area. */
  short?: string;
  entry?: string;
  protocol?: string;
  module?: string;
  file?: string;
  line?: number;
  x: number;
  y: number;
}

export interface Trace {
  /** Edge number in the data map, or "ep:<endpoint id>" for the line from an endpoint pad. */
  id: string;
  from: string;
  to: string;
  kind: "sync" | "async" | "io";
  queue?: string;
  rule?: string;
  points: Point[];
}

export interface Board {
  width: number;
  height: number;
  columns: string[];
  nodes: PlacedNode[];
  pads: PlacedPad[];
  /** Left edge of the first gutter; endpoint labels sit left of it. */
  left: number;
  /** Module bands, in row order. Empty when the data map has fewer than two modules. */
  modules: { name: string; top: number; bottom: number }[];
  lanes: { queue: string; label: string; y: number }[];
  traces: Trace[];
  /** Ids of nodes placed in the overflow column. */
  overflow: string[];
  log: string[];
}

/** Shortens a name to fit a chip: drops leading namespaces, then truncates. */
export function shortLabel(name: string): string {
  let s = name.replace(/\s*\(.*\)\s*$/, "");
  const MAX = 27;
  while (s.length > MAX && s.includes("::")) s = s.slice(s.indexOf("::") + 2);
  return s.length > MAX ? s.slice(0, MAX - 1) + "…" : s;
}

interface Track { res: string; lo: number; hi: number; idx: number }
type Fn = () => number;
type Way = [Fn, Fn];

export function layoutBoard(map: DataMap): Board {
  const log: string[] = [];
  const bump = (m: Map<string, number>, id: string) => { const n = m.get(id) ?? 0; m.set(id, n + 1); return n; };
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  const entryIds = new Set(map.endpoints.map((e) => e.entry));

  // ---- rule 1 and 2: depth is the shortest path from an entry node ----
  const out = new Map<string, number[]>();
  map.edges.forEach((e, i) => {
    if (nodeById.has(e.to)) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(i);
  });
  const depth = new Map<string, number>();
  const bfs = (starts: string[]) => {
    const queue = starts.filter((id) => !depth.has(id));
    queue.forEach((id) => depth.set(id, 0));
    while (queue.length) {
      const id = queue.shift()!;
      for (const i of out.get(id) ?? []) {
        const to = map.edges[i].to;
        if (!depth.has(to)) { depth.set(to, depth.get(id)! + 1); queue.push(to); }
      }
    }
  };
  bfs([...entryIds].filter((id) => nodeById.has(id)));
  for (const n of map.nodes) bfs([n.id]);

  // ---- rule 4: overflow column ----
  const overflow: string[] = [];
  const column = new Map<string, number>();
  for (const n of map.nodes) {
    const d = depth.get(n.id)!;
    if (d >= MAX_COLUMNS) {
      column.set(n.id, MAX_COLUMNS);
      overflow.push(n.id);
      log.push(`overflow: ${n.id} has depth ${d}; placed in the overflow column`);
    } else column.set(n.id, d);
  }
  const nCols = Math.max(1, ...map.nodes.map((n) => column.get(n.id)! + 1));

  // ---- rule 3: rows by barycentre ----
  const cols: string[][] = Array.from({ length: nCols }, () => []);
  for (const n of map.nodes) cols[column.get(n.id)!].push(n.id);
  // ---- modules: when there are two or more, each module takes its own band of rows ----
  const modOf = (id: string) => str(nodeById.get(id)!.module) ?? "";
  const modNames = [...new Set(map.nodes.map((n) => modOf(n.id)))];
  const grouped = modNames.length > 1;
  const modIdx = new Map(modNames.map((m, i) => [m, i]));
  const mi = (id: string) => (grouped ? modIdx.get(modOf(id))! : 0);
  const bandSize = modNames.map(() => 0);
  for (const c of cols) {
    const per = new Map<number, number>();
    for (const id of c) per.set(mi(id), (per.get(mi(id)) ?? 0) + 1);
    for (const [m, k] of per) bandSize[m] = Math.max(bandSize[m], k);
  }
  const bandStart = bandSize.map((_, m) => bandSize.slice(0, m).reduce((a, b) => a + b, 0));
  for (let c = 0; c < nCols; c++) cols[c] = cols[c].map((id, i) => ({ id, i })).sort((a, b) => mi(a.id) - mi(b.id) || a.i - b.i).map((x) => x.id);
  const row = new Map<string, number>();
  const setRows = () => cols.forEach((c) => {
    const seen = new Map<number, number>();
    for (const id of c) {
      const m = mi(id), k = seen.get(m) ?? 0;
      seen.set(m, k + 1);
      row.set(id, bandStart[m] + k);
    }
  });
  setRows();
  const nbrs = new Map<string, string[]>();
  for (const e of map.edges) {
    if (!nodeById.has(e.to) || e.from === e.to) continue;
    (nbrs.get(e.from) ?? nbrs.set(e.from, []).get(e.from)!).push(e.to);
    (nbrs.get(e.to) ?? nbrs.set(e.to, []).get(e.to)!).push(e.from);
  }
  const sweep = (c: number, towards: number) => {
    const key = (id: string) => {
      const ns = (nbrs.get(id) ?? []).filter((x) => column.get(x) === towards);
      return ns.length ? ns.reduce((a, x) => a + row.get(x)!, 0) / ns.length : row.get(id)!;
    };
    const keyed = cols[c].map((id, i) => ({ id, i, k: key(id) }));
    keyed.sort((a, b) => mi(a.id) - mi(b.id) || a.k - b.k || a.i - b.i);
    cols[c] = keyed.map((x) => x.id);
    setRows();
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 1; c < nCols; c++) sweep(c, c - 1);
    for (let c = nCols - 2; c >= 0; c--) sweep(c, c + 1);
  }
  const R = Math.max(1, bandSize.reduce((a, b) => a + b, 0));
  const modStarts = new Map<number, number>(grouped ? bandStart.map((s, m) => [s, m]) : []);

  // ---- endpoints: one slot per endpoint on the left side of its entry chip ----
  const epSlot = new Map<string, number>();
  const epCount = new Map<string, number>();
  for (const e of map.endpoints) epSlot.set(e.id, bump(epCount, e.entry));
  const chipH = (id: string) => Math.max(CHIP_H, 26 + EP_STEP * (epCount.get(id) ?? 0));
  const rowH = Array.from({ length: R }, () => CHIP_H);
  for (const n of map.nodes) rowH[row.get(n.id)!] = Math.max(rowH[row.get(n.id)!], chipH(n.id));
  const pathChars = Math.min(PATH_MAX, Math.max(8, ...map.endpoints.map((e) => e.path.length)));
  const LEFT = map.endpoints.length ? Math.round(62 + pathChars * CH + 34) : 40;

  // ---- pads ----
  const exts = map.externals.map((x) => x.id);
  const extKey = (id: string) => {
    const rs = map.edges.filter((e) => e.to === id && row.has(e.from)).map((e) => row.get(e.from)!);
    return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  };
  const extOrder = exts.map((id, i) => ({ id, i, k: extKey(id) })).sort((a, b) => a.k - b.k || a.i - b.i);
  const X = Math.max(1, extOrder.length);
  const padRow = new Map<string, { row: number; extra: number }>();
  extOrder.forEach((x, j) => {
    padRow.set(x.id, X <= R ? { row: Math.round(((j + 0.5) * R) / X - 0.5), extra: 0 } : { row: j % R, extra: Math.floor(j / R) * 14 });
  });

  // ---- routes, symbolic: points are functions, resolved once the geometry is known ----
  const tracks: Track[] = [];
  const mk = (res: string, a: number, b: number): Track => {
    const t = { res, lo: Math.min(a, b), hi: Math.max(a, b), idx: -1 };
    tracks.push(t);
    return t;
  };
  const G = {
    gutterLeft: (_g: number) => 0, colX: (_c: number) => 0, bandTop: (_c: number) => 0,
    rowTop: (_r: number) => 0, laneTop: (_q: string) => 0, padX: 0,
  };
  const rowKey = (r: number) => 2 * r + 1;
  const queues = [...new Set(map.edges.filter((e) => e.kind === "async").map((e) => e.queue ?? "default"))].sort((a, b) =>
    a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b),
  );
  const laneKey = (q: string) => 2 * R + 2 + queues.indexOf(q);

  const colOf = (id: string) => column.get(id)!;
  const rightX = (c: number): Fn => () => G.colX(c) + CHIP_W;
  const leftX = (c: number): Fn => () => G.colX(c);
  const pinY = (r: number, slot: number): Fn => () => G.rowTop(r) + 6 + (slot % SLOTS) * 8 + 2;
  const gutX = (g: number, t: Track): Fn => () => G.gutterLeft(g) + 12 + t.idx * TRACK;
  const chanY = (c: number, t: Track): Fn => () => G.bandTop(c) + 7 + t.idx * TRACK;
  const laneY = (q: string, t: Track): Fn => () => G.laneTop(q) + 7 + t.idx * TRACK;

  /** Out of a start gutter, along a horizontal run, into the gutter left of the target, then into the target. */
  const viaRun = (start: Way, startG: number, startKey: number, runKey: number, runRes: string, runY: (t: Track) => Fn, tCol: number, tRow: number, ty: Fn): Way[] => {
    const endG = tCol - 1;
    const v1 = mk(`g${startG}`, startKey, runKey);
    const h = mk(runRes, startG, endG);
    const v2 = mk(`g${endG}`, runKey, rowKey(tRow));
    return [start, [gutX(startG, v1), start[1]], [gutX(startG, v1), runY(h)], [gutX(endG, v2), runY(h)], [gutX(endG, v2), ty], [leftX(tCol), ty]];
  };

  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();

  const routes: { id: string; from: string; to: string; kind: Trace["kind"]; queue?: string; rule?: string; way: Way[] }[] = [];

  for (const ep of map.endpoints) {
    const t = ep.entry;
    const tr = row.get(t)!, tc = colOf(t);
    const y: Fn = () => G.rowTop(tr) + CHIP_H / 2 + EP_STEP * epSlot.get(ep.id)!;
    const start: Way = [() => LEFT - 13, y];
    const way: Way[] = tc === 0 ? [start, [leftX(0), y]] : viaRun(start, -1, rowKey(tr), 2 * tr, `c${tr}`, (h) => chanY(tr, h), tc, tr, y);
    routes.push({ id: `ep:${ep.id}`, from: ep.id, to: t, kind: "sync", way });
  }

  map.edges.forEach((e, i) => {
    const s = e.from;
    const sc = colOf(s), sr = row.get(s)!;
    const sy = pinY(sr, bump(outCount, s));
    const start: Way = [rightX(sc), sy];
    let way: Way[];
    if (nodeById.has(e.to)) {
      const tc = colOf(e.to), tr = row.get(e.to)!;
      const ty = pinY(tr, bump(inCount, e.to));
      if (e.kind === "async") {
        const q = e.queue ?? "default";
        way = viaRun(start, sc, rowKey(sr), laneKey(q), `l${q}`, (h) => laneY(q, h), tc, tr, ty);
      } else if (tc === sc + 1) {
        const v = mk(`g${sc}`, rowKey(sr), rowKey(tr));
        way = [start, [gutX(sc, v), sy], [gutX(sc, v), ty], [leftX(tc), ty]];
      } else {
        way = viaRun(start, sc, rowKey(sr), 2 * tr, `c${tr}`, (h) => chanY(tr, h), tc, tr, ty);
      }
    } else {
      const pr = padRow.get(e.to) ?? { row: 0, extra: 0 };
      const py: Fn = () => G.rowTop(pr.row) + CHIP_H / 2 + pr.extra;
      const last = nCols - 1;
      const padX: Fn = () => G.padX;
      if (sc === last) {
        const v = mk(`g${last}`, rowKey(sr), rowKey(pr.row));
        way = [start, [gutX(last, v), sy], [gutX(last, v), py], [padX, py]];
      } else {
        const c = sr + 1;
        const v1 = mk(`g${sc}`, rowKey(sr), 2 * c);
        const h = mk(`c${c}`, sc, last);
        const v2 = mk(`g${last}`, 2 * c, rowKey(pr.row));
        way = [start, [gutX(sc, v1), sy], [gutX(sc, v1), chanY(c, h)], [gutX(last, v2), chanY(c, h)], [gutX(last, v2), py], [padX, py]];
      }
    }
    routes.push({ id: String(i), from: s, to: e.to, kind: e.kind, queue: e.queue, rule: e.rule, way });
  });

  // ---- track packing: tracks of one gutter, channel or lane share a line when their extents do not meet ----
  const byRes = new Map<string, Track[]>();
  for (const t of tracks) (byRes.get(t.res) ?? byRes.set(t.res, []).get(t.res)!).push(t);
  const used = new Map<string, number>();
  for (const [res, ts] of byRes) {
    ts.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    const ends: number[] = [];
    for (const t of ts) {
      let k = ends.findIndex((end) => end < t.lo);
      if (k < 0) { k = ends.length; ends.push(t.hi); } else ends[k] = t.hi;
      t.idx = k;
    }
    used.set(res, ends.length);
  }
  const count = (res: string) => used.get(res) ?? 0;

  // ---- geometry ----
  const gutterW = (g: number) => GUTTER_MIN + TRACK * count(`g${g}`);
  const colXs: number[] = [];
  const gutLeft = new Map<number, number>([[-1, LEFT]]);
  let x = LEFT + gutterW(-1);
  for (let c = 0; c < nCols; c++) {
    colXs.push(x);
    gutLeft.set(c, x + CHIP_W);
    x += CHIP_W + gutterW(c);
  }
  const padX = x + 14;
  const extChars = Math.min(EXT_MAX, Math.max(0, ...map.externals.map((e) => e.name.length)));
  const width = padX + (extChars ? Math.round(24 + extChars * CH) : 0) + 40;
  const bandH = (c: number) => BAND_MIN + TRACK * count(`c${c}`);
  const bandTops: number[] = [];
  const rowTops: number[] = [];
  let y = TOP;
  const modules: Board["modules"] = [];
  for (let r = 0; r < R; r++) {
    if (modStarts.has(r)) {
      const m = modStarts.get(r)!;
      if (modules.length) modules[modules.length - 1].bottom = y;
      modules.push({ name: modNames[m] || "(no module)", top: y, bottom: 0 });
      y += MOD_HEAD;
    }
    bandTops.push(y);
    y += bandH(r);
    rowTops.push(y);
    y += rowH[r];
  }
  if (modules.length) modules[modules.length - 1].bottom = y + 6;
  bandTops.push(y);
  y += bandH(R) + 24;
  const laneTops = new Map<string, number>();
  for (const q of queues) { laneTops.set(q, y); y += 14 + TRACK * count(`l${q}`) + 6; }
  const height = y + 14;
  G.gutterLeft = (g) => gutLeft.get(g)!;
  G.colX = (c) => colXs[c];
  G.bandTop = (c) => bandTops[c];
  G.rowTop = (r) => rowTops[r];
  G.laneTop = (q) => laneTops.get(q)!;
  G.padX = padX;

  // ---- result ----
  const clean = (pts: Point[]): Point[] => {
    const dedup = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    return dedup.filter((p, i) => {
      if (i === 0 || i === dedup.length - 1) return true;
      const a = dedup[i - 1], b = dedup[i + 1];
      return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
    });
  };
  const traces: Trace[] = routes.map((r) => ({
    id: r.id, from: r.from, to: r.to, kind: r.kind,
    ...(r.queue !== undefined ? { queue: r.queue } : {}),
    ...(r.rule !== undefined ? { rule: r.rule } : {}),
    points: clean(r.way.map(([fx, fy]) => [fx(), fy()] as Point)),
  }));

  const nodes: PlacedNode[] = map.nodes.map((n) => ({
    id: n.id, label: shortLabel(n.name), name: n.name, kind: n.kind,
    ...(str(n.module) ? { module: str(n.module) } : {}),
    ...(n.file !== undefined ? { file: n.file } : {}),
    ...(n.queue !== undefined ? { queue: n.queue } : {}),
    column: column.get(n.id)!, row: row.get(n.id)!,
    x: colXs[column.get(n.id)!], y: rowTops[row.get(n.id)!], w: CHIP_W, h: chipH(n.id),
  }));
  const pads: PlacedPad[] = [
    ...map.endpoints.map((e) => ({
      id: e.id, side: "left" as const, label: `${e.method} ${e.path}`, kind: endpointKind(e), method: e.method, path: e.path,
      short: shortMiddle(e.path, pathChars), entry: e.entry,
      ...(str(e.protocol) ? { protocol: str(e.protocol) } : {}),
      ...(str(e.module) ? { module: str(e.module) } : {}),
      ...(str(e.file) ? { file: str(e.file) } : {}),
      ...(typeof e.line === "number" ? { line: e.line } : {}),
      x: LEFT - 20, y: rowTops[row.get(e.entry)!] + CHIP_H / 2 + EP_STEP * epSlot.get(e.id)!,
    })),
    ...map.externals.map((e) => {
      const p = padRow.get(e.id)!;
      const kind = externalKind(e);
      return {
        id: e.id, side: "right" as const, label: e.name, short: shortMiddle(e.name, EXT_MAX), ...(kind ? { kind } : {}),
        ...(str(e.protocol) ? { protocol: str(e.protocol) } : {}),
        x: padX, y: rowTops[p.row] + CHIP_H / 2 + p.extra,
      };
    }),
  ];
  const columns = Array.from({ length: nCols }, (_, c) => (c === 0 ? "ENTRY" : c === MAX_COLUMNS ? "OVERFLOW" : `STEP ${c}`));
  const laneChars = Math.max(8, Math.floor((LEFT - 30) / CH));
  const lanes = queues.map((q) => ({ queue: q, label: shortMiddle(q, laneChars), y: laneTops.get(q)! + 7 }));
  return { width, height, left: LEFT, columns, nodes, pads, modules, lanes, traces, overflow, log };
}

/** Every pair of a trace and a chip where a segment passes through the chip's interior. */
export function findCrossings(board: Board): { trace: string; node: string }[] {
  const found: { trace: string; node: string }[] = [];
  for (const t of board.traces) {
    for (let i = 1; i < t.points.length; i++) {
      const [x1, y1] = t.points[i - 1], [x2, y2] = t.points[i];
      const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2);
      for (const n of board.nodes) {
        if (lx < n.x + n.w && hx > n.x && ly < n.y + n.h && hy > n.y) found.push({ trace: t.id, node: n.id });
      }
    }
  }
  return found;
}
