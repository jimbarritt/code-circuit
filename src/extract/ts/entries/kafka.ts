import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { calleeName, fileImports, finding, fold, handlerOwner, prop, unwrap, walk } from "./util.ts";

const KAFKA = (s: string) => s === "kafkajs" || s.startsWith("@confluentinc/kafka-javascript");

/**
 * kafkajs consumer.subscribe({ topic }) and subscribe({ topics: [...] }). Each topic is one finding.
 * A named function passed as `eachMessage` or `eachBatch` to the same consumer's run() owns the finding.
 */
export const kafka: Detector = {
  name: "kafka",
  detect(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.project.files) {
      if (!fileImports(f.sf, KAFKA)) continue;
      const runs = new Map<string, ts.Expression>();
      walk(f.sf, (n) => {
        if (!ts.isCallExpression(n) || calleeName(n) !== "run" || !ts.isPropertyAccessExpression(n.expression)) return;
        const arg = n.arguments[0] && unwrap(n.arguments[0]);
        const h = arg && ts.isObjectLiteralExpression(arg) ? prop(arg, "eachMessage") ?? prop(arg, "eachBatch") : undefined;
        if (h) runs.set(n.expression.expression.getText(f.sf), h);
      });
      walk(f.sf, (n) => {
        if (!ts.isCallExpression(n) || calleeName(n) !== "subscribe" || !ts.isPropertyAccessExpression(n.expression)) return;
        const arg = n.arguments[0] && unwrap(n.arguments[0]);
        if (!arg || !ts.isObjectLiteralExpression(arg)) return;
        const one = prop(arg, "topic");
        const many = prop(arg, "topics");
        const exprs = one ? [one] : many && ts.isArrayLiteralExpression(unwrap(many)) ? [...(unwrap(many) as ts.ArrayLiteralExpression).elements] : many ? [many] : [];
        const owner = handlerOwner(ctx, f, runs.get(n.expression.expression.getText(f.sf)), n);
        for (const e of exprs) out.push(finding(ctx, f, n, { kind: "message", protocol: "kafka", method: "KAFKA", rule: "kafkajs-subscribe" }, fold(ctx, e, f.rel, f.sf), owner));
      });
    }
    return out;
  },
};
