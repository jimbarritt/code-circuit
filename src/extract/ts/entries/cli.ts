import ts from "typescript";
import type { ClassSym, Detector, Finding } from "../types.ts";
import { baseOnly, calleeName, fileOf, finding, fold, handlerOwner, importedFrom, importsOf, isDecorator, methodOwner, prop, specMatches, unwrap, walk } from "./util.ts";

const NEST_COMMANDER = "nest-commander";

/** The command word of a usage string: `serve [port]` is `serve`. */
const word = (v: { value: string; resolved: boolean }) => (v.resolved ? { value: v.value.trim().split(/\s+/)[0] || v.value, resolved: true } : v);

/** nest-commander @Command and @SubCommand classes, commander `.command()` and `new Command()`, and yargs `.command()`. */
export const cli: Detector = {
  name: "cli",
  detect(ctx) {
    const out: Finding[] = [];

    // ---- nest-commander: a sub command is named under the command that lists it ----
    const parents = new Map<string, string>();
    const options = (c: ClassSym, names: string[]) => {
      const f = fileOf(ctx, c);
      const d = c.decorators.find((x) => isDecorator(x, names, f.sf, NEST_COMMANDER));
      const arg = d?.args[0] && unwrap(d.args[0]);
      return { f, d, obj: arg && ts.isObjectLiteralExpression(arg) ? arg : undefined };
    };
    for (const c of ctx.index.classes) {
      const { f, d, obj } = options(c, ["Command"]);
      const list = d && obj && prop(obj, "subCommands");
      const name = obj && prop(obj, "name");
      if (!list || !name || !ts.isArrayLiteralExpression(unwrap(list))) continue;
      for (const el of (unwrap(list) as ts.ArrayLiteralExpression).elements) if (ts.isIdentifier(el)) parents.set(el.text, fold(ctx, name, c.file, f.sf).value);
    }
    for (const c of ctx.index.classes) {
      if (baseOnly(ctx, c)) continue;
      const { f, d, obj } = options(c, ["Command", "SubCommand"]);
      const name = d && obj && prop(obj, "name");
      if (!d || !name) continue;
      const v = fold(ctx, name, c.file, f.sf);
      const parent = d.name === "SubCommand" ? parents.get(c.name) : undefined;
      const target = parent && v.resolved ? { value: `${parent} ${v.value}`, resolved: true } : v;
      const run = c.methods.some((m) => m.name === "run") ? "run" : undefined;
      out.push(finding(ctx, f, d.line, { kind: "cli", protocol: "nest-commander", method: "CLI", rule: "nest-commander-command" }, target, methodOwner(c, run)));
    }

    // ---- commander and yargs ----
    for (const f of ctx.project.files) {
      const imps = importsOf(f.sf);
      const lib = [...imps.values()].some((i) => specMatches(i.spec, "commander")) ? "commander"
        : [...imps.values()].some((i) => specMatches(i.spec, "yargs")) ? "yargs" : undefined;
      if (!lib) continue;
      walk(f.sf, (n) => {
        if (lib === "commander" && ts.isNewExpression(n) && calleeName(n) === "Command" && importedFrom(f.sf, "Command", "commander") && n.arguments?.[0]) {
          out.push(finding(ctx, f, n, { kind: "cli", protocol: "commander", method: "CLI", rule: "commander-command" }, word(fold(ctx, n.arguments[0], f.rel, f.sf)), ctx.index.ownerOf(f.rel, n)));
          return;
        }
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "command" || !n.arguments.length) return;
        const first = unwrap(n.arguments[0]!);
        if (lib === "commander") {
          if (ts.isNewExpression(first)) return;
          const handler = actionOf(n);
          out.push(finding(ctx, f, n, { kind: "cli", protocol: "commander", method: "CLI", rule: "commander-command" }, word(fold(ctx, first, f.rel, f.sf)), handlerOwner(ctx, f, handler, n)));
          return;
        }
        // yargs: command(name, description, builder, handler), command([names], ...), command({ command, handler })
        const obj = ts.isObjectLiteralExpression(first) ? first : undefined;
        const nameExpr = obj ? prop(obj, "command") : first;
        if (!nameExpr) return;
        const ne = unwrap(nameExpr);
        const v = ts.isArrayLiteralExpression(ne) && ne.elements[0] ? fold(ctx, ne.elements[0], f.rel, f.sf) : fold(ctx, ne, f.rel, f.sf);
        const handler = obj ? prop(obj, "handler") : n.arguments[3];
        out.push(finding(ctx, f, n, { kind: "cli", protocol: "yargs", method: "CLI", rule: "yargs-command" }, word(v), handlerOwner(ctx, f, handler, n)));
      });
    }
    return out;
  },
};

/** The handler passed to `.action(...)` further along a commander chain that starts at `call`. */
function actionOf(call: ts.CallExpression): ts.Expression | undefined {
  let n: ts.Node = call;
  while (ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && ts.isCallExpression(n.parent.parent)) {
    const outer: ts.CallExpression = n.parent.parent;
    if (n.parent.name.text === "action") return outer.arguments[0];
    if (n.parent.name.text === "command") return undefined;
    n = outer;
  }
  return undefined;
}
