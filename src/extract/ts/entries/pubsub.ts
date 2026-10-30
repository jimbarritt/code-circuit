import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { calleeName, fileImports, finding, unwrap, walk } from "./util.ts";

const NATS = (s: string) => s === "nats" || s === "@nats-io/transport-node" || s === "@nats-io/nats-core";
const REDIS = (s: string) => s === "ioredis" || s === "redis" || s.startsWith("@redis/");

/** NATS subscribe(subject) and Redis subscribe / psubscribe(channel, ...). Only channels that fold count. */
export const pubsub: Detector = {
  name: "pubsub",
  detect(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.project.files) {
      const nats = fileImports(f.sf, NATS);
      if (!nats && !fileImports(f.sf, REDIS)) continue;
      const base = nats ? { kind: "message" as const, protocol: "nats", method: "NATS", rule: "nats-subscribe" } : { kind: "message" as const, protocol: "redis", method: "REDIS", rule: "redis-subscribe" };
      walk(f.sf, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
        const name = calleeName(n);
        if (name !== "subscribe" && !(name === "psubscribe" && !nats)) return;
        const args = nats ? n.arguments.slice(0, 1) : n.arguments;
        for (const a of args) {
          const e = unwrap(a);
          if (ts.isArrayLiteralExpression(e)) continue;
          const v = ctx.index.resolveValue(e, f.rel);
          if (v !== undefined) out.push(finding(ctx, f, n, { ...base, ...(name === "psubscribe" ? { rule: "redis-psubscribe" } : {}) }, { value: v, resolved: true }));
        }
      });
    }
    return out;
  },
};
