import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { messageTransport, nestApps } from "./nest-app.ts";
import { fileOf, finding, fold, isDecorator, methodOwner, unwrap } from "./util.ts";

export const nestMessage: Detector = {
  name: "nest-message",
  detect(ctx) {
    const out: Finding[] = [];
    const apps = nestApps(ctx);
    for (const c of ctx.index.classes) {
      const f = fileOf(ctx, c);
      for (const m of c.methods) for (const d of m.decorators) {
        if (!isDecorator(d, ["MessagePattern", "EventPattern"], f.sf) || !d.args[0]) continue;
        const t = d.args[1] && unwrap(d.args[1]);
        const explicit = t && ts.isPropertyAccessExpression(t) ? t.name.text : undefined;
        const tr = messageTransport(apps.get(c.module), explicit);
        const rule = d.name === "EventPattern" ? "nest-event-pattern" : "nest-message-pattern";
        out.push(finding(ctx, f, d.line, { kind: "message", protocol: tr.protocol, method: tr.method, rule, ...(tr.detail ? { detail: tr.detail } : {}) }, fold(ctx, d.args[0], c.file, f.sf), methodOwner(c, m.name)));
      }
    }
    return out;
  },
};
