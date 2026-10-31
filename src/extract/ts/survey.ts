import type { DataMap } from "../../datamap.ts";
import type { Survey } from "./assemble.ts";
import type { Finding } from "./types.ts";

const ENTRY_ORDER = ["http", "grpc", "graphql", "websocket", "message", "queue", "cron"];
const EXIT_ORDER = ["database", "cache", "http-out", "grpc-out", "message-out", "queue-out", "smtp-out", "cloud"];
const MAX_PAD = 48;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const counts = (entries: number, exits: number) => `${plural(entries, "entry", "entries")}, ${plural(exits, "exit")}`;
const where = (f: Finding) => (f.line ? `${f.file}:${f.line}` : f.file);
const target = (f: Finding) => (f.resolved ? f.target : `${f.target}?`).replace(/\s*\n\s*/g, " ");

/** Text survey: by module, then direction, then kind. Each row: method, target, symbol, file:line. */
export function formatSurvey(survey: Survey): string {
  const all = [...survey.entries, ...survey.exits];
  const w = [
    Math.min(MAX_PAD, Math.max(6, ...all.map((f) => f.method.length))),
    Math.min(MAX_PAD, Math.max(6, ...all.map((f) => target(f).length))),
    Math.min(MAX_PAD, Math.max(6, ...all.map((f) => f.symbol.length))),
  ];
  const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
  const out: string[] = [];
  const modules = [...new Set([...survey.modules, ...all.map((f) => f.module)])].sort();
  for (const mod of modules) {
    const ins = survey.entries.filter((f) => f.module === mod), outs = survey.exits.filter((f) => f.module === mod);
    out.push(`${mod}`);
    for (const [title, list, order] of [["entries", ins, ENTRY_ORDER], ["exits", outs, EXIT_ORDER]] as const) {
      if (!list.length) continue;
      out.push(`  ${title}`);
      const kinds = [...new Set(list.map((f) => f.kind))].sort((a, b) => rank(order, a) - rank(order, b) || a.localeCompare(b));
      for (const kind of kinds) {
        const rows = list.filter((f) => f.kind === kind);
        out.push(`    ${kind} (${rows.length})`);
        for (const f of rows) out.push(`      ${pad(f.method, w[0]!)}  ${pad(target(f), w[1]!)}  ${pad(f.symbol, w[2]!)}  ${where(f)}`.trimEnd());
      }
    }
    out.push(`  ${mod}: ${counts(ins.length, outs.length)}`, "");
  }
  out.push(`total: ${counts(survey.entries.length, survey.exits.length)} in ${plural(modules.length, "module")}`);
  return out.join("\n") + "\n";
}

const rank = (order: readonly string[], k: string) => (order.indexOf(k) < 0 ? order.length : order.indexOf(k));

export const surveyJson = (survey: Survey) => JSON.stringify(survey, null, 2) + "\n";

const RAILS_EXITS: Record<string, string> = { postgresql: "database", redis: "cache", "remote-http": "http-out", "web-push": "http-out" };

/** Best-effort survey of a Rails data map: its endpoints and its io edges. */
export function railsSurvey(map: DataMap): Survey {
  const mod = map.system ?? ".";
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const externals = new Map(map.externals.map((x) => [x.id, x]));
  const base = { module: mod, resolved: true, line: 0 };
  const entries: Finding[] = map.endpoints.map((e) => ({
    ...base, direction: "entry", kind: "http", protocol: "rails", method: e.method, target: e.path,
    file: nodes.get(e.entry)?.file ?? "", symbol: e.entry, node: e.entry, rule: String(e.rule ?? "rails-routes"),
  }));
  const exits: Finding[] = map.edges.filter((e) => e.kind === "io").map((e) => ({
    ...base, direction: "exit", kind: (RAILS_EXITS[e.to] ?? "http-out") as Finding["kind"], protocol: e.to, method: e.rule ?? "io",
    target: externals.get(e.to)?.name ?? e.to, file: nodes.get(e.from)?.file ?? "", symbol: e.from, node: e.from, rule: e.rule ?? "io",
  }));
  const order = (a: Finding, b: Finding) => a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol) || a.method.localeCompare(b.method) || a.target.localeCompare(b.target);
  return { modules: [mod], entries: entries.sort(order), exits: exits.sort(order) };
}
