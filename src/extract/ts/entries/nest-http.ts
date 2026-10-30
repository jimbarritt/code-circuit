import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { nestApps, versions } from "./nest-app.ts";
import { fileOf, finding, handlers, isDecorator, joinPath, methodOwner, pathValues, prop, unwrap } from "./util.ts";

const VERBS = ["Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All", "Search", "Sse"];

export const nestHttp: Detector = {
  name: "nest-http",
  detect(ctx) {
    const out: Finding[] = [];
    const apps = nestApps(ctx);
    for (const c of ctx.index.classes) {
      const f = fileOf(ctx, c);
      const ctl = c.decorators.find((d) => isDecorator(d, "Controller", f.sf));
      if (!ctl) continue;
      const app = apps.get(c.module);
      const prefixes = pathValues(ctx, ctl.args[0], c.file, f.sf);
      const ctlOpts = ctl.args[0] && unwrap(ctl.args[0]);
      const ctlVersion = ctlOpts && ts.isObjectLiteralExpression(ctlOpts) ? prop(ctlOpts, "version") : undefined;
      for (const { m, f: mf, file } of handlers(ctx, c)) {
        const verb = m.decorators.find((d) => isDecorator(d, VERBS, mf.sf));
        if (!verb) continue;
        const vd = m.decorators.find((d) => isDecorator(d, "Version", mf.sf));
        let vers = [{ value: "", resolved: true }];
        if (app?.versioning) {
          const v = vd?.args[0] ? versions(ctx, vd.args[0], file) : ctlVersion ? versions(ctx, ctlVersion, c.file) : app.versioning.defaultVersion ?? vers;
          vers = (v.length ? v : vers).map((x) => (x.value ? { value: `${app.versioning!.prefix}${x.value}`, resolved: x.resolved } : x));
        }
        const global = app?.prefix ?? { value: "", resolved: true };
        const method = verb.name === "Sse" ? "GET" : verb.name.toUpperCase();
        for (const pre of prefixes) for (const route of pathValues(ctx, verb.args[0], file, mf.sf)) for (const ver of vers) {
          const target = { value: joinPath(global.value, ver.value, pre.value, route.value), resolved: global.resolved && ver.resolved && pre.resolved && route.resolved };
          out.push(finding(ctx, mf, verb.line, { kind: "http", protocol: "nest", method, rule: verb.name === "Sse" ? "nest-sse-decorator" : "nest-http-decorator" }, target, methodOwner(c, m.name)));
        }
      }
    }
    return out;
  },
};
