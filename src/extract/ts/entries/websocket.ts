import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { fileOf, finding, fold, handlers, isDecorator, methodOwner, prop, unwrap } from "./util.ts";

type Val = { value: string; resolved: boolean };
/** A message name under its gateway namespace: `/orders order.track`. */
const withNs = (ns: Val | undefined, v: Val): Val => (ns && ns.value ? { value: `${ns.value.startsWith("/") ? "" : "/"}${ns.value} ${v.value}`, resolved: ns.resolved && v.resolved } : v);

export const websocket: Detector = {
  name: "websocket",
  detect(ctx) {
    const out: Finding[] = [];
    for (const c of ctx.index.classes) {
      const f = fileOf(ctx, c);
      const gw = c.decorators.find((d) => isDecorator(d, "WebSocketGateway", f.sf));
      if (!gw) continue;
      const opts = gw.args.map(unwrap).find(ts.isObjectLiteralExpression);
      const ns = opts && prop(opts, "namespace");
      const nsv = ns && fold(ctx, ns, c.file, f.sf);
      const detail = nsv ? `namespace: ${nsv.value}` : undefined;
      for (const { m, f: mf, file } of handlers(ctx, c)) for (const d of m.decorators) {
        if (!isDecorator(d, "SubscribeMessage", mf.sf) || !d.args[0]) continue;
        out.push(finding(ctx, mf, d.line, { kind: "websocket", protocol: "ws", method: "WS", rule: "nest-ws-subscribe", ...(detail ? { detail } : {}) }, withNs(nsv, fold(ctx, d.args[0], file, mf.sf)), methodOwner(c, m.name)));
      }
    }
    return out;
  },
};
