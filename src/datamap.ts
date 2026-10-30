import Ajv from "ajv";
import schema from "../schema/data-map.schema.json";

export type EdgeKind = "sync" | "async" | "io";

export interface Endpoint { id: string; method: string; path: string; entry: string; [extra: string]: unknown }
export interface DmNode { id: string; name: string; kind: string; file?: string; queue?: string; [extra: string]: unknown }
export interface Edge { from: string; to: string; kind: EdgeKind; queue?: string; rule?: string; [extra: string]: unknown }
export interface External { id: string; name: string; [extra: string]: unknown }

export interface DataMap {
  system?: string;
  language?: string;
  framework?: string;
  captured?: string;
  endpoints: Endpoint[];
  nodes: DmNode[];
  edges: Edge[];
  externals: External[];
  [extra: string]: unknown;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateShape = ajv.compile(schema);

/** Returns a list of problems; empty means valid. Checks the schema, then ids and references. */
export function validateDataMap(value: unknown): string[] {
  if (!validateShape(value)) {
    return (validateShape.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
  }
  const m = value as DataMap;
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const id of [...m.endpoints, ...m.nodes, ...m.externals].map((x) => x.id)) {
    if (seen.has(id)) problems.push(`duplicate id ${id}`);
    seen.add(id);
  }
  const nodeIds = new Set(m.nodes.map((n) => n.id));
  const targetIds = new Set([...nodeIds, ...m.externals.map((x) => x.id)]);
  for (const e of m.endpoints) if (!nodeIds.has(e.entry)) problems.push(`endpoint ${e.id} enters unknown node ${e.entry}`);
  m.edges.forEach((e, i) => {
    if (!nodeIds.has(e.from)) problems.push(`edge ${i} starts at unknown node ${e.from}`);
    if (!targetIds.has(e.to)) problems.push(`edge ${i} ends at unknown id ${e.to}`);
  });
  return problems;
}

export function assertDataMap(value: unknown): DataMap {
  const problems = validateDataMap(value);
  if (problems.length) throw new Error("invalid data map:\n  " + problems.join("\n  "));
  return value as DataMap;
}
