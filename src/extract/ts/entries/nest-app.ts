import ts from "typescript";
import type { DetectContext } from "../types.ts";
import { calleeName, fold, prop, unwrap, walk } from "./util.ts";

export interface NestApp {
  prefix?: { value: string; resolved: boolean };
  /** Set when the app enables URI versioning. */
  versioning?: { prefix: string; defaultVersion?: string[] };
  /** Transports of the microservices the app listens on, for example KAFKA or GRPC. */
  transports: string[];
}

const cache = new WeakMap<DetectContext["project"], Map<string, NestApp>>();

/** Reads setGlobalPrefix, enableVersioning and the microservice transports of each module's bootstrap code. */
export function nestApps(ctx: DetectContext): Map<string, NestApp> {
  const hit = cache.get(ctx.project);
  if (hit) return hit;
  const out = new Map<string, NestApp>();
  const app = (m: string) => { let a = out.get(m); if (!a) out.set(m, (a = { transports: [] })); return a; };
  for (const f of ctx.project.files) {
    let boot = false;
    walk(f.sf, (n) => { if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "NestFactory") boot = true; });
    if (!boot) continue;
    walk(f.sf, (n) => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n);
        const arg = n.arguments[0];
        if (name === "setGlobalPrefix" && arg && !app(f.module).prefix) app(f.module).prefix = fold(ctx, arg, f.rel, f.sf);
        if (name === "enableVersioning") {
          const opts = arg && unwrap(arg);
          const type = opts && ts.isObjectLiteralExpression(opts) ? prop(opts, "type") : undefined;
          if (!opts || (type && type.getText(f.sf).endsWith("URI"))) {
            const o = opts && ts.isObjectLiteralExpression(opts) ? opts : undefined;
            const pre = o && prop(o, "prefix");
            const dv = o && prop(o, "defaultVersion");
            const prefix = pre ? ctx.index.resolveValue(pre, f.rel) ?? "v" : "v";
            app(f.module).versioning = { prefix, ...(dv ? { defaultVersion: versions(ctx, dv, f.rel) } : {}) };
          }
        }
      }
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "transport") {
        const v = unwrap(n.initializer);
        const t = ts.isPropertyAccessExpression(v) ? v.name.text : undefined;
        const a = app(f.module);
        if (t && !a.transports.includes(t)) a.transports.push(t);
      }
    });
  }
  cache.set(ctx.project, out);
  return out;
}

/** Versions in a @Version argument or a version option: a literal, an array, or VERSION_NEUTRAL as "". */
export function versions(ctx: DetectContext, expr: ts.Expression, file: string): string[] {
  const e = unwrap(expr);
  if (ts.isArrayLiteralExpression(e)) return e.elements.flatMap((x) => versions(ctx, x, file));
  if (ts.isIdentifier(e) && e.text === "VERSION_NEUTRAL") return [""];
  const v = ctx.index.resolveValue(e, file);
  return v === undefined ? [] : [v];
}

const METHODS: Record<string, string> = { KAFKA: "KAFKA", RMQ: "RMQ", NATS: "NATS", MQTT: "MQTT", REDIS: "REDIS", TCP: "TCP" };

/** Method and protocol for Nest message handlers in a module, from the transports it listens on. */
export function messageTransport(app: NestApp | undefined, explicit?: string): { method: string; protocol: string; detail?: string } {
  const pick = (t: string) => ({ method: METHODS[t] ?? t, protocol: t.toLowerCase() });
  if (explicit) return pick(explicit);
  const ts = (app?.transports ?? []).filter((t) => t !== "GRPC");
  if (ts.length === 1) return pick(ts[0]!);
  return { method: "MESSAGE", protocol: "nest", ...(ts.length ? { detail: `transports: ${ts.join(", ")}` } : {}) };
}
