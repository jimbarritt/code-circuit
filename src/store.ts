import { Database } from "bun:sqlite";
import { assertDataMap, type DataMap } from "./datamap.ts";

const KNOWN = {
  endpoint: ["id", "method", "path", "entry"],
  node: ["id", "name", "kind", "file", "queue"],
  edge: ["from", "to", "kind", "queue", "rule"],
  external: ["id", "name"],
} as const;
const TOP_LISTS = ["endpoints", "nodes", "edges", "externals"];

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, seq INTEGER NOT NULL, value TEXT NOT NULL);
CREATE TABLE endpoints (seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, entry TEXT NOT NULL, extra TEXT);
CREATE TABLE nodes (seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, file TEXT, queue TEXT, extra TEXT);
CREATE TABLE externals (seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, extra TEXT);
CREATE TABLE edges (seq INTEGER PRIMARY KEY, src TEXT NOT NULL, dst TEXT NOT NULL, kind TEXT NOT NULL, queue TEXT, rule TEXT, extra TEXT);
CREATE INDEX edges_src ON edges (src);
CREATE INDEX edges_dst ON edges (dst);
`;

const extraOf = (row: Record<string, unknown>, known: readonly string[]) => {
  const rest = Object.fromEntries(Object.entries(row).filter(([k]) => !known.includes(k)));
  return Object.keys(rest).length ? JSON.stringify(rest) : null;
};
const present = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

export function openStore(path = ":memory:"): Database {
  const db = new Database(path);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/** Replaces the whole contents of the store with the data map. */
export function importDataMap(db: Database, input: unknown): void {
  const map = assertDataMap(input);
  db.exec("DROP TABLE IF EXISTS meta; DROP TABLE IF EXISTS endpoints; DROP TABLE IF EXISTS nodes; DROP TABLE IF EXISTS externals; DROP TABLE IF EXISTS edges");
  db.exec(SCHEMA);
  db.transaction(() => {
    let i = 0;
    for (const [k, v] of Object.entries(map)) {
      if (TOP_LISTS.includes(k)) continue;
      db.query("INSERT INTO meta VALUES (?, ?, ?)").run(k, i++, JSON.stringify(v));
    }
    const ep = db.query("INSERT INTO endpoints VALUES (?, ?, ?, ?, ?, ?)");
    map.endpoints.forEach((e, n) => ep.run(n, e.id, e.method, e.path, e.entry, extraOf(e, KNOWN.endpoint)));
    const nd = db.query("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?)");
    map.nodes.forEach((e, n) => nd.run(n, e.id, e.name, e.kind, e.file ?? null, e.queue ?? null, extraOf(e, KNOWN.node)));
    const ex = db.query("INSERT INTO externals VALUES (?, ?, ?, ?)");
    map.externals.forEach((e, n) => ex.run(n, e.id, e.name, extraOf(e, KNOWN.external)));
    const ed = db.query("INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?)");
    map.edges.forEach((e, n) => ed.run(n, e.from, e.to, e.kind, e.queue ?? null, e.rule ?? null, extraOf(e, KNOWN.edge)));
    db.query("INSERT INTO meta VALUES ('__order', -1, ?)").run(JSON.stringify(Object.keys(map)));
  })();
}

const withExtra = (base: Record<string, unknown>, extra: string | null) => ({ ...present(base), ...(extra ? JSON.parse(extra) : {}) });

/** Rebuilds the data map, with keys in the order they were imported. */
export function exportDataMap(db: Database): DataMap {
  const q = (sql: string) => db.query(sql).all() as any[];
  const parts: Record<string, unknown> = {
    endpoints: q("SELECT * FROM endpoints ORDER BY seq").map((r) => withExtra({ id: r.id, method: r.method, path: r.path, entry: r.entry }, r.extra)),
    externals: q("SELECT * FROM externals ORDER BY seq").map((r) => withExtra({ id: r.id, name: r.name }, r.extra)),
    nodes: q("SELECT * FROM nodes ORDER BY seq").map((r) => withExtra({ id: r.id, name: r.name, kind: r.kind, file: r.file, queue: r.queue }, r.extra)),
    edges: q("SELECT * FROM edges ORDER BY seq").map((r) => withExtra({ from: r.src, to: r.dst, kind: r.kind, queue: r.queue, rule: r.rule }, r.extra)),
  };
  for (const r of q("SELECT * FROM meta WHERE key != '__order'")) parts[r.key] = JSON.parse(r.value);
  const order: string[] = JSON.parse(q("SELECT value FROM meta WHERE key = '__order'")[0].value);
  return Object.fromEntries(order.map((k) => [k, parts[k]])) as DataMap;
}
