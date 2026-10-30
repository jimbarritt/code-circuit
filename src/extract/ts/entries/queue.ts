import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { calleeName, fileOf, finding, fold, handlerOwner, importedFrom, isDecorator, methodOwner, pathValues, walk } from "./util.ts";

const NEST_QUEUE = (s: string) => s === "@nestjs/bullmq" || s === "@nestjs/bull";

/** Nest @Processor classes, bullmq new Worker(name, handler) and Bull queue.process(...). */
export const queue: Detector = {
  name: "queue",
  detect(ctx) {
    const out: Finding[] = [];
    for (const c of ctx.index.classes) {
      const f = fileOf(ctx, c);
      const p = c.decorators.find((d) => isDecorator(d, "Processor", f.sf, NEST_QUEUE));
      if (!p) continue;
      const protocol = importedFrom(f.sf, "Processor", "@nestjs/bull") ? "bull" : "bullmq";
      const base = { kind: "queue" as const, protocol, method: "QUEUE" };
      for (const name of pathValues(ctx, p.args[0], c.file, f.sf, "name")) {
        const handlers = c.methods.flatMap((m) => m.decorators.filter((d) => isDecorator(d, "Process", f.sf, NEST_QUEUE)).map((d) => ({ m, d })));
        for (const { m, d } of handlers) {
          const job = d.args[0] && ctx.index.resolveValue(d.args[0], c.file);
          out.push(finding(ctx, f, d.line, { ...base, rule: "nest-queue-process", ...(job ? { detail: `job: ${job}` } : {}) }, name, methodOwner(c, m.name)));
        }
        if (handlers.length) continue;
        const proc = c.methods.find((m) => m.name === "process");
        out.push(finding(ctx, f, p.line, { ...base, rule: "nest-queue-processor" }, name, methodOwner(c, proc?.name)));
      }
    }
    for (const f of ctx.project.files) {
      const bullQueues = new Map<string, ts.Expression>();
      walk(f.sf, (n) => {
        if (!ts.isNewExpression(n) && !ts.isCallExpression(n)) return;
        const name = calleeName(n);
        if (!name || !ts.isIdentifier(n.expression) || !n.arguments?.[0]) return;
        if (ts.isNewExpression(n) && name === "Worker" && importedFrom(f.sf, name, "bullmq")) {
          let owner = ctx.index.ownerOf(f.rel, n);
          if (owner.id.endsWith(`:${f.rel}`)) owner = handlerOwner(ctx, f, n.arguments[1], n);
          out.push(finding(ctx, f, n, { kind: "queue", protocol: "bullmq", method: "QUEUE", rule: "bullmq-worker" }, fold(ctx, n.arguments[0], f.rel, f.sf), owner));
        } else if (importedFrom(f.sf, name, "bull") && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) {
          bullQueues.set(n.parent.name.text, n.arguments[0]);
        }
      });
      if (!bullQueues.size) continue;
      walk(f.sf, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "process" || !ts.isIdentifier(n.expression.expression)) return;
        const q = bullQueues.get(n.expression.expression.text);
        if (!q) return;
        const job = n.arguments.length > 1 && ctx.index.resolveValue(n.arguments[0]!, f.rel);
        out.push(finding(ctx, f, n, { kind: "queue", protocol: "bull", method: "QUEUE", rule: "bull-process", ...(job ? { detail: `job: ${job}` } : {}) }, fold(ctx, q, f.rel, f.sf), handlerOwner(ctx, f, n.arguments[n.arguments.length - 1], n)));
      });
    }
    return out;
  },
};
