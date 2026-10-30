import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { calleeName, fileOf, finding, fold, handlerOwner, importedFrom, importsOf, isDecorator, methodOwner, prop, unwrap, walk } from "./util.ts";

const SCHEDULE = "@nestjs/schedule";

/** Nest @Cron / @Interval / @Timeout, node-cron schedule, cron CronJob, and setInterval. */
export const cron: Detector = {
  name: "cron",
  detect(ctx) {
    const out: Finding[] = [];
    for (const c of ctx.index.classes) {
      const f = fileOf(ctx, c);
      for (const m of c.methods) for (const d of m.decorators) {
        if (!isDecorator(d, ["Cron", "Interval", "Timeout"], f.sf, SCHEDULE) || !d.args.length) continue;
        const arg = d.name === "Cron" ? d.args[0]! : d.args[d.args.length - 1]!;
        const protocol = d.name === "Cron" ? "cron" : d.name.toLowerCase();
        out.push(finding(ctx, f, d.line, { kind: "cron", protocol, method: "CRON", rule: `nest-${protocol}` }, fold(ctx, arg, c.file, f.sf), methodOwner(c, m.name)));
      }
    }
    for (const f of ctx.project.files) {
      const imps = importsOf(f.sf);
      walk(f.sf, (n) => {
        if (!ts.isCallExpression(n) && !ts.isNewExpression(n)) return;
        const args = n.arguments ?? [];
        const name = calleeName(n);
        if (ts.isCallExpression(n) && name === "schedule" && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression)
          && importedFrom(f.sf, n.expression.expression.text, "node-cron") && args[0]) {
          out.push(finding(ctx, f, n, { kind: "cron", protocol: "node-cron", method: "CRON", rule: "node-cron-schedule" }, fold(ctx, args[0], f.rel, f.sf), handlerOwner(ctx, f, args[1], n)));
        } else if (ts.isCallExpression(n) && name === "schedule" && ts.isIdentifier(n.expression) && importedFrom(f.sf, name, "node-cron") && args[0]) {
          out.push(finding(ctx, f, n, { kind: "cron", protocol: "node-cron", method: "CRON", rule: "node-cron-schedule" }, fold(ctx, args[0], f.rel, f.sf), handlerOwner(ctx, f, args[1], n)));
        } else if (name === "CronJob" || (name === "from" && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(f.sf) === "CronJob")) {
          if (!importedFrom(f.sf, "CronJob", "cron") || !args[0]) return;
          const a = unwrap(args[0]);
          const obj = ts.isObjectLiteralExpression(a) ? a : undefined;
          const time = obj ? prop(obj, "cronTime") : a;
          if (!time) return;
          out.push(finding(ctx, f, n, { kind: "cron", protocol: "cron", method: "CRON", rule: "cron-job" }, fold(ctx, time, f.rel, f.sf), handlerOwner(ctx, f, obj ? prop(obj, "onTick") : args[1], n)));
        } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && name === "setInterval" && !imps.has(name) && args.length >= 2) {
          out.push(finding(ctx, f, n, { kind: "cron", protocol: "interval", method: "CRON", rule: "set-interval" }, fold(ctx, args[1]!, f.rel, f.sf), handlerOwner(ctx, f, args[0], n)));
        }
      });
    }
    return out;
  },
};
