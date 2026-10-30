import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { fileOf, finding, fold, isDecorator, methodOwner, prop, unwrap } from "./util.ts";

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
      const detail = ns ? `namespace: ${fold(ctx, ns, c.file, f.sf).value}` : undefined;
      for (const m of c.methods) for (const d of m.decorators) {
        if (!isDecorator(d, "SubscribeMessage", f.sf) || !d.args[0]) continue;
        out.push(finding(ctx, f, d.line, { kind: "websocket", protocol: "ws", method: "WS", rule: "nest-ws-subscribe", ...(detail ? { detail } : {}) }, fold(ctx, d.args[0], c.file, f.sf), methodOwner(c, m.name)));
      }
    }
    return out;
  },
};
