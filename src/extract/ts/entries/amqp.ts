import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { calleeName, fileImports, finding, fold, handlerOwner, unwrap, walk } from "./util.ts";

const AMQP = (s: string) => s === "amqplib" || s.startsWith("amqplib/") || s === "amqp-connection-manager";
const isFn = (e: ts.Expression) => ts.isArrowFunction(e) || ts.isFunctionExpression(e);

/** amqplib channel.consume(queue, handler). */
export const amqp: Detector = {
  name: "amqp",
  detect(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.project.files) {
      if (!fileImports(f.sf, AMQP)) continue;
      walk(f.sf, (n) => {
        if (!ts.isCallExpression(n) || calleeName(n) !== "consume" || !ts.isPropertyAccessExpression(n.expression) || n.arguments.length < 2) return;
        const q = unwrap(n.arguments[0]!);
        if (isFn(q) || ts.isObjectLiteralExpression(q)) return;
        out.push(finding(ctx, f, n, { kind: "message", protocol: "amqplib", method: "RMQ", rule: "amqplib-consume" }, fold(ctx, q, f.rel, f.sf), handlerOwner(ctx, f, n.arguments[1], n)));
      });
    }
    return out;
  },
};
