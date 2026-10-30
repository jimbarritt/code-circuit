import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { fileOf, finding, fold, isDecorator, methodOwner, prop, unwrap } from "./util.ts";

const GQL = (s: string) => s === "@nestjs/graphql" || s === "type-graphql" || s === "@nestjs/graphql/dist";
const OPS = ["Query", "Mutation", "Subscription"];

export const graphql: Detector = {
  name: "graphql",
  detect(ctx) {
    const out: Finding[] = [];
    for (const c of ctx.index.classes) {
      const f = fileOf(ctx, c);
      if (!c.decorators.some((d) => isDecorator(d, "Resolver", f.sf, GQL))) continue;
      for (const m of c.methods) for (const d of m.decorators) {
        if (!isDecorator(d, OPS, f.sf, GQL)) continue;
        let name = { value: m.name, resolved: true };
        for (const a of d.args) {
          const e = unwrap(a);
          if (ts.isStringLiteralLike(e)) name = fold(ctx, e, c.file, f.sf);
          else if (ts.isObjectLiteralExpression(e) && prop(e, "name")) name = fold(ctx, prop(e, "name")!, c.file, f.sf);
        }
        out.push(finding(ctx, f, d.line, { kind: "graphql", protocol: "graphql", method: "GRAPHQL", rule: "graphql-resolver" }, { value: `${d.name}.${name.value}`, resolved: name.resolved }, methodOwner(c, m.name)));
      }
    }
    return out;
  },
};
