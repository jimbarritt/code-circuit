import type { Database } from "bun:sqlite";

export interface Reach {
  /** Ids of nodes and externals on the path, starting with the entry node. */
  nodes: string[];
  /** Edge seq numbers (their index in the data map's edge list) on the path. */
  edges: number[];
}

/** Everything reachable from the entry node of an endpoint, found by a recursive query. */
export function reachFrom(db: Database, endpointId: string): Reach | null {
  const ep = db.query("SELECT entry FROM endpoints WHERE id = ?").get(endpointId) as { entry: string } | null;
  if (!ep) return null;
  const nodes = db
    .query(
      `WITH RECURSIVE r(id) AS (
         SELECT ?1
         UNION
         SELECT e.dst FROM edges e JOIN r ON e.src = r.id
       ) SELECT id FROM r`,
    )
    .all(ep.entry)
    .map((x: any) => x.id as string);
  const edges = db
    .query(
      `WITH RECURSIVE r(id) AS (
         SELECT ?1
         UNION
         SELECT e.dst FROM edges e JOIN r ON e.src = r.id
       ) SELECT e.seq FROM edges e WHERE e.src IN (SELECT id FROM r) ORDER BY e.seq`,
    )
    .all(ep.entry)
    .map((x: any) => x.seq as number);
  return { nodes, edges };
}

/** Endpoints whose paths reach the node or external, in data map order. */
export function reachedBy(db: Database, id: string): string[] {
  return db
    .query(
      `WITH RECURSIVE up(id) AS (
         SELECT ?1
         UNION
         SELECT e.src FROM edges e JOIN up ON e.dst = up.id
       ) SELECT ep.id FROM endpoints ep WHERE ep.entry IN (SELECT id FROM up) ORDER BY ep.seq`,
    )
    .all(id)
    .map((x: any) => x.id as string);
}

/** How many endpoints reach each node and external. */
export function reachCounts(db: Database): Record<string, number> {
  const counts: Record<string, number> = {};
  const ids = db.query("SELECT id FROM nodes UNION SELECT id FROM externals").all() as { id: string }[];
  for (const { id } of ids) counts[id] = reachedBy(db, id).length;
  return counts;
}
