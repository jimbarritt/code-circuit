import type { Detector, Finding } from "../types.ts";
import { fileOf, finding, fold, isDecorator, methodOwner } from "./util.ts";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const grpc: Detector = {
  name: "grpc",
  detect(ctx) {
    const out: Finding[] = [];
    for (const c of ctx.index.classes) {
      const f = fileOf(ctx, c);
      for (const m of c.methods) for (const d of m.decorators) {
        if (!isDecorator(d, ["GrpcMethod", "GrpcStreamMethod", "GrpcStreamCall"], f.sf)) continue;
        const svc = d.args[0] ? fold(ctx, d.args[0], c.file, f.sf) : { value: c.name, resolved: true };
        const meth = d.args[1] ? fold(ctx, d.args[1], c.file, f.sf) : { value: cap(m.name), resolved: true };
        const rule = d.name === "GrpcMethod" ? "nest-grpc-method" : "nest-grpc-stream";
        out.push(finding(ctx, f, d.line, { kind: "grpc", protocol: "grpc", method: "GRPC", rule }, { value: `${svc.value}/${meth.value}`, resolved: svc.resolved && meth.resolved }, methodOwner(c, m.name)));
      }
    }
    return out;
  },
};
