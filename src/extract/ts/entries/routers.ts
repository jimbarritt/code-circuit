import ts from "typescript";
import type { DetectContext, Detector, Finding, SourceFile } from "../types.ts";
import { calleeName, defaultExportName, finding, fold, handlerOwner, importsOf, joinPath, prop, specMatches, unwrap, walk } from "./util.ts";

export type Framework = "express" | "fastify" | "koa" | "hono";
type Val = { value: string; resolved: boolean };
interface Inst { key: string; fw: Framework; own: Val }
interface Mount { parent: string; path: Val }

const VERBS = new Set(["get", "post", "put", "patch", "delete", "del", "options", "head", "all"]);
const PKG: Record<Framework, (s: string) => boolean> = {
  express: (s) => s === "express",
  fastify: (s) => s === "fastify",
  koa: (s) => s === "@koa/router" || s === "koa-router",
  hono: (s) => s === "hono" || s.startsWith("hono/"),
};

const isFn = (e: ts.Expression) => ts.isArrowFunction(e) || ts.isFunctionExpression(e);
const verbOf = (v: string) => (v === "del" ? "DELETE" : v.toUpperCase());

/** Name of the top-level function that holds a node, for factories such as `function usersRouter() { const r = Router(); ... }`. */
function topFunction(n: ts.Node): string | undefined {
  let name: string | undefined;
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name && ts.isSourceFile(p.parent)) name = p.name.text;
    else if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name) && ts.isVariableStatement(p.parent.parent.parent) && ts.isSourceFile(p.parent.parent.parent.parent)) name = p.parent.name.text;
    else if (ts.isFunctionDeclaration(p) && !p.name && ts.isSourceFile(p.parent)) name = "default";
  }
  return name;
}

interface FileState { f: SourceFile; vars: Map<string, Inst>; aliases: Map<string, Inst> }

function scanFile(ctx: DetectContext, f: SourceFile): FileState {
  const imps = importsOf(f.sf);
  const fwOf = (local: string): Framework | undefined => {
    const imp = imps.get(local);
    return imp ? (Object.keys(PKG) as Framework[]).find((k) => specMatches(imp.spec, PKG[k])) : undefined;
  };
  const st: FileState = { f, vars: new Map(), aliases: new Map() };
  const add = (name: string, fw: Framework, own: Val, at: ts.Node) => {
    const inst = { key: `${f.rel}#${name}`, fw, own };
    st.vars.set(name, inst);
    const fn = topFunction(at);
    if (fn && !st.aliases.has(fn)) st.aliases.set(fn, inst);
  };
  /** The framework and own prefix of an expression that makes an app or router. */
  const create = (e: ts.Expression): { fw: Framework; own: Val } | undefined => {
    e = unwrap(e);
    const empty = { value: "", resolved: true };
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "basePath") {
      const inner = create(e.expression.expression);
      return inner && e.arguments[0] ? { fw: inner.fw, own: fold(ctx, e.arguments[0], f.rel, f.sf) } : inner;
    }
    if (!ts.isCallExpression(e) && !ts.isNewExpression(e)) return undefined;
    const c = e.expression;
    const root = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) ? c.expression.text : undefined;
    const fw = root && fwOf(root);
    if (!fw) return undefined;
    const name = calleeName(e);
    const imported = ts.isIdentifier(c) ? imps.get(root!)?.imported : name;
    if (fw === "express" && (imported === "Router" || (ts.isIdentifier(c) && ts.isCallExpression(e)))) return { fw, own: empty };
    if (fw === "fastify" && ts.isIdentifier(c) && ts.isCallExpression(e)) return { fw, own: empty };
    if (fw === "koa" && ts.isNewExpression(e)) {
      const o = e.arguments?.[0] && unwrap(e.arguments[0]);
      const p = o && ts.isObjectLiteralExpression(o) ? prop(o, "prefix") : undefined;
      return { fw, own: p ? fold(ctx, p, f.rel, f.sf) : empty };
    }
    if (fw === "hono" && ts.isNewExpression(e) && name === "Hono") return { fw, own: empty };
    return undefined;
  };
  walk(f.sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const c = create(n.initializer);
      if (c) add(n.name.text, c.fw, c.own, n);
    } else if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.type && ts.isTypeReferenceNode(n.type) && ts.isIdentifier(n.type.typeName)) {
      const t = n.type.typeName.text;
      const fw = fwOf(t);
      if ((fw === "fastify" && t === "FastifyInstance") || (fw === "express" && t === "Router") || (fw === "hono" && t === "Hono")) add(n.name.text, fw, { value: "", resolved: true }, n);
    }
  });
  return st;
}

interface Route { inst: Inst; f: SourceFile; at: ts.Node; method: string; path: Val; handler?: ts.Expression; rule: string }

function analyse(ctx: DetectContext): { routes: Route[]; prefixes: (inst: Inst) => Val[] | undefined } {
  const files = new Map<string, FileState>();
  const state = (rel: string) => {
    let s = files.get(rel);
    if (!s) { const f = ctx.project.file(rel); if (!f) return undefined; files.set(rel, (s = scanFile(ctx, f))); }
    return s;
  };
  const resolve = (rel: string, name: string, depth = 0): Inst | undefined => {
    const s = state(rel);
    if (!s || depth > 6) return undefined;
    const hit = s.vars.get(name) ?? s.aliases.get(name);
    if (hit) return hit;
    if (name === "default") { const d = defaultExportName(s.f.sf); return d && d !== "default" ? resolve(rel, d, depth + 1) : undefined; }
    const imp = importsOf(s.f.sf).get(name);
    const to = imp && imp.imported !== "*" ? ctx.project.resolveImport(rel, imp.spec) : undefined;
    return to ? resolve(to, imp!.imported, depth + 1) : undefined;
  };
  const instOf = (rel: string, e: ts.Expression): Inst | undefined => {
    e = unwrap(e);
    if (ts.isIdentifier(e)) return resolve(rel, e.text);
    if (ts.isCallExpression(e)) {
      if (ts.isPropertyAccessExpression(e.expression) && ["routes", "middleware"].includes(e.expression.name.text)) return instOf(rel, e.expression.expression);
      if (ts.isIdentifier(e.expression)) return resolve(rel, e.expression.text);
    }
    return undefined;
  };

  const routes: Route[] = [];
  const mounts = new Map<string, Mount[]>();
  const mount = (child: Inst, parent: Inst, path: Val) => mounts.set(child.key, [...(mounts.get(child.key) ?? []), { parent: parent.key, path }]);
  const insts = new Map<string, Inst>();

  for (const f of ctx.project.files) {
    const s = state(f.rel)!;
    if (!s.vars.size && ![...importsOf(f.sf).values()].some((i) => Object.values(PKG).some((t) => specMatches(i.spec, t)))) continue;
    for (const i of s.vars.values()) insts.set(i.key, i);
    walk(f.sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      const verb = n.expression.name.text;
      const recv = n.expression.expression;
      const args = n.arguments;
      // router.route('/x').get(h).post(h)
      let chain: ts.Expression = recv;
      while (ts.isCallExpression(chain) && ts.isPropertyAccessExpression(chain.expression) && VERBS.has(chain.expression.name.text)) chain = chain.expression.expression;
      if (VERBS.has(verb) && ts.isCallExpression(chain) && ts.isPropertyAccessExpression(chain.expression) && chain.expression.name.text === "route" && chain.arguments[0]) {
        const inst = instOf(f.rel, chain.expression.expression);
        if (inst?.fw === "express") routes.push({ inst, f, at: chain, method: verbOf(verb), path: fold(ctx, chain.arguments[0], f.rel, f.sf), handler: args[args.length - 1], rule: "express-route-chain" });
        return;
      }
      const inst = instOf(f.rel, chain);
      if (!inst) return;
      if (VERBS.has(verb) && args.length >= 2) {
        const p = unwrap(args[0]!);
        if (isFn(p) || ts.isObjectLiteralExpression(p) || ts.isArrayLiteralExpression(p) && inst.fw !== "express") return;
        const last = unwrap(args[args.length - 1]!);
        const handler = ts.isObjectLiteralExpression(last) ? prop(last, "handler") : last;
        for (const path of ts.isArrayLiteralExpression(p) ? p.elements.map((x) => fold(ctx, x, f.rel, f.sf)) : [fold(ctx, p, f.rel, f.sf)])
          routes.push({ inst, f, at: n, method: verbOf(verb), path, handler, rule: `${inst.fw}-route` });
      } else if (verb === "route" && inst.fw === "fastify" && args[0] && ts.isObjectLiteralExpression(unwrap(args[0]))) {
        const o = unwrap(args[0]) as ts.ObjectLiteralExpression;
        const url = prop(o, "url") ?? prop(o, "path");
        const m = prop(o, "method");
        if (!url || !m) return;
        const me = unwrap(m);
        const methods = ts.isArrayLiteralExpression(me) ? [...me.elements] : [me];
        for (const x of methods) {
          const v = fold(ctx, x, f.rel, f.sf);
          routes.push({ inst, f, at: n, method: v.resolved ? v.value.toUpperCase() : v.value, path: fold(ctx, url, f.rel, f.sf), handler: prop(o, "handler"), rule: "fastify-route-options" });
        }
      } else if ((verb === "use" && (inst.fw === "express" || inst.fw === "koa")) || (verb === "route" && inst.fw === "hono")) {
        const first = args[0] && unwrap(args[0]);
        const hasPath = !!first && !isFn(first) && ts.isStringLiteralLike(first) || (!!first && ctx.index.resolveValue(first, f.rel) !== undefined);
        const path = hasPath ? fold(ctx, first!, f.rel, f.sf) : { value: "", resolved: true };
        for (const a of args.slice(hasPath ? 1 : 0)) { const child = instOf(f.rel, a); if (child && child !== inst) mount(child, inst, path); }
      } else if (verb === "register" && inst.fw === "fastify" && args[0]) {
        const child = instOf(f.rel, args[0]);
        const o = args[1] && unwrap(args[1]);
        const pre = o && ts.isObjectLiteralExpression(o) ? prop(o, "prefix") : undefined;
        if (child && child !== inst) mount(child, inst, pre ? fold(ctx, pre, f.rel, f.sf) : { value: "", resolved: true });
      }
    });
  }

  // A mount that closes a cycle is dropped. Results computed inside a cycle are not kept, as they depend on where the walk started.
  const memo = new Map<string, Val[]>();
  const prefixes = (inst: Inst, seen: string[] = []): Val[] | undefined => {
    const hit = memo.get(inst.key);
    if (hit) return hit;
    if (seen.includes(inst.key)) { cut = Math.min(cut, seen.indexOf(inst.key)); return undefined; }
    const depth = seen.length;
    seen = [...seen, inst.key];
    const ms = mounts.get(inst.key) ?? [];
    const out: Val[] = [];
    let mounted = false;
    for (const m of ms) {
      const parent = insts.get(m.parent);
      const pps = parent ? prefixes(parent, seen) : [{ value: "", resolved: true }];
      if (!pps) continue;
      mounted = true;
      for (const pp of pps) out.push({ value: joinPath(pp.value, m.path.value, inst.own.value), resolved: pp.resolved && m.path.resolved && inst.own.resolved });
    }
    if (ms.length && !mounted) return undefined;
    const res = out.length ? [...new Map(out.map((v) => [v.value, v])).values()] : [inst.own];
    if (cut >= depth) cut = Infinity;
    if (cut === Infinity) memo.set(inst.key, res);
    return res;
  };
  let cut = Infinity;
  return { routes, prefixes };
}

const cache = new WeakMap<DetectContext["project"], ReturnType<typeof analyse>>();

function routesFor(ctx: DetectContext, fw: Framework): Finding[] {
  let a = cache.get(ctx.project);
  if (!a) cache.set(ctx.project, (a = analyse(ctx)));
  const out: Finding[] = [];
  for (const r of a.routes) {
    if (r.inst.fw !== fw) continue;
    const owner = handlerOwner(ctx, r.f, r.handler, r.at);
    for (const pre of a.prefixes(r.inst) ?? [r.inst.own]) {
      out.push(finding(ctx, r.f, r.at, { kind: "http", protocol: fw, method: r.method, rule: r.rule }, { value: joinPath(pre.value, r.path.value), resolved: pre.resolved && r.path.resolved }, owner));
    }
  }
  return out;
}

export const express: Detector = { name: "express", detect: (ctx) => routesFor(ctx, "express") };
export const fastify: Detector = { name: "fastify", detect: (ctx) => routesFor(ctx, "fastify") };
export const koa: Detector = { name: "koa", detect: (ctx) => routesFor(ctx, "koa") };
export const hono: Detector = { name: "hono", detect: (ctx) => routesFor(ctx, "hono") };
