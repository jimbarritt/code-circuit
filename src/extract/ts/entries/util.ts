import ts from "typescript";
import { allMethods } from "../symbols.ts";
import type { ClassSym, DetectContext, Decorator, EntryKind, Finding, SourceFile } from "../types.ts";

export const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

export const unwrap = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
  return e;
};

export interface Import { spec: string; imported: string }
const importCache = new WeakMap<ts.SourceFile, Map<string, Import>>();

/** Local name to import binding. A namespace import has `imported` "*". */
export function importsOf(sf: ts.SourceFile): Map<string, Import> {
  let out = importCache.get(sf);
  if (out) return out;
  out = new Map();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text, c = st.importClause;
      if (c?.name) out.set(c.name.text, { spec, imported: "default" });
      const nb = c?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) out.set(nb.name.text, { spec, imported: "*" });
      else if (nb) for (const el of nb.elements) out.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text });
    } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference) && ts.isStringLiteral(st.moduleReference.expression)) {
      out.set(st.name.text, { spec: st.moduleReference.expression.text, imported: "*" });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer && unwrap(d.initializer);
        if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "require") continue;
        const arg = init.arguments[0];
        if (!arg || !ts.isStringLiteral(arg)) continue;
        if (ts.isIdentifier(d.name)) out.set(d.name.text, { spec: arg.text, imported: "*" });
        else if (ts.isObjectBindingPattern(d.name)) for (const el of d.name.elements) {
          if (ts.isIdentifier(el.name)) out.set(el.name.text, { spec: arg.text, imported: el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text });
        }
      }
    }
  }
  importCache.set(sf, out);
  return out;
}

export type SpecTest = string | RegExp | ((spec: string) => boolean);
export const specMatches = (spec: string, test: SpecTest) =>
  typeof test === "string" ? spec === test || spec.startsWith(`${test}/`) : test instanceof RegExp ? test.test(spec) : test(spec);

/** True when the local name `name` is imported in `sf` from a module that passes `test`. */
export function importedFrom(sf: ts.SourceFile, name: string, test: SpecTest): boolean {
  const imp = importsOf(sf).get(name);
  return !!imp && specMatches(imp.spec, test);
}

export const fileImports = (sf: ts.SourceFile, test: SpecTest) => [...importsOf(sf).values()].some((i) => specMatches(i.spec, test));

export const NEST = /^@nestjs\//;

/** The decorator is the named one and, when it is imported, comes from a module that passes `test`. */
export function isDecorator(d: Decorator, names: string | string[], sf: ts.SourceFile, test: SpecTest = NEST): boolean {
  if (!(typeof names === "string" ? d.name === names : names.includes(d.name))) return false;
  if (d.spec !== undefined) return specMatches(d.spec, test);
  if (d.local) return false;
  const imp = importsOf(sf).get(d.name);
  return !!imp && specMatches(imp.spec, test);
}

export function fold(ctx: DetectContext, expr: ts.Expression, file: string, sf: ts.SourceFile): { value: string; resolved: boolean } {
  const v = ctx.index.resolveValue(expr, file);
  return v === undefined ? { value: expr.getText(sf), resolved: false } : { value: v, resolved: true };
}

export function prop(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of [...obj.properties].reverse()) {
    if (ts.isPropertyAssignment(p) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return undefined;
}

export function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  const go = (n: ts.Node) => { visit(n); ts.forEachChild(n, go); };
  go(node);
}

export interface Base { kind: EntryKind; protocol: string; method: string; rule: string; detail?: string }

export function finding(ctx: DetectContext, f: SourceFile, at: ts.Node | number, base: Base, target: { value: string; resolved: boolean }, owner?: { id: string; symbol: string; module?: string }): Finding {
  const o = owner ?? ctx.index.ownerOf(f.rel, typeof at === "number" ? f.sf : at);
  const out: Finding = {
    direction: "entry", kind: base.kind, protocol: base.protocol, method: base.method, target: target.value, resolved: target.resolved,
    module: owner?.module ?? f.module, file: f.rel, line: typeof at === "number" ? at : lineOf(f.sf, at), symbol: o.symbol, node: o.id, rule: base.rule,
  };
  if (base.detail) out.detail = base.detail;
  return out;
}

/** Owner for a decorated class method. */
export const methodOwner = (c: ClassSym, method?: string) => ({ id: c.id, symbol: method ? `${c.name}.${method}` : c.name, module: c.module });

const bases = new WeakMap<DetectContext["index"], Set<string>>();
/** A base class with no class decorator, or an abstract one: its handlers are reported under each subclass. */
export function baseOnly(ctx: DetectContext, c: ClassSym): boolean {
  let b = bases.get(ctx.index);
  if (!b) bases.set(ctx.index, (b = new Set(ctx.index.classes.flatMap((x) => (x.base ? [x.base] : [])))));
  return b.has(c.id) && (!!c.abstract || !c.decorators.length);
}

/** Own and inherited methods of a class, each with the source file that declares it. */
export const handlers = (ctx: DetectContext, c: ClassSym) => allMethods(ctx.index, c).map(({ m, cls }) => ({ m, f: fileOf(ctx, cls), file: cls.file }));

export const fileOf = (ctx: DetectContext, c: ClassSym) => ctx.project.file(c.file)!;

/**
 * Owner for a handler argument. A named function, local or imported, owns the finding under its own name.
 * Anything else falls back to the code that holds the call.
 */
export function handlerOwner(ctx: DetectContext, f: SourceFile, handler: ts.Expression | undefined, at: ts.Node): { id: string; symbol: string } {
  const h = handler && unwrap(handler);
  if (h && ts.isIdentifier(h)) {
    const fn = functionNamed(ctx, f.rel, h.text);
    if (fn) return fn;
  }
  return ctx.index.ownerOf(f.rel, at);
}

const fnCache = new WeakMap<DetectContext["index"], Map<string, DetectContext["index"]["functions"][number]>>();

function functionNamed(ctx: DetectContext, file: string, name: string, depth = 0): { id: string; symbol: string } | undefined {
  if (depth > 5) return undefined;
  let fns = fnCache.get(ctx.index);
  if (!fns) fnCache.set(ctx.index, (fns = new Map(ctx.index.functions.map((fn) => [`${fn.file}#${fn.name}`, fn]))));
  const local = fns.get(`${file}#${name}`);
  if (local) return { id: local.id, symbol: local.name };
  const f = ctx.project.file(file);
  const imp = f && importsOf(f.sf).get(name);
  if (!imp || imp.imported === "*") return undefined;
  const to = ctx.project.resolveImport(file, imp.spec);
  if (!to) return undefined;
  if (imp.imported === "default") {
    const def = defaultExportName(ctx.project.file(to)?.sf);
    return def ? functionNamed(ctx, to, def, depth + 1) : undefined;
  }
  return functionNamed(ctx, to, imp.imported, depth + 1);
}

/** Name of the declaration a file exports as default, when it has a name. */
export function defaultExportName(sf: ts.SourceFile | undefined): string | undefined {
  if (!sf) return undefined;
  for (const st of sf.statements) {
    if (ts.isExportAssignment(st) && !st.isExportEquals && ts.isIdentifier(st.expression)) return st.expression.text;
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return st.name.text;
  }
  return undefined;
}

/** Joins path segments with single slashes, a leading slash and no trailing slash. */
export function joinPath(...parts: string[]): string {
  const p = parts.filter((s) => s !== "").join("/").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return p.startsWith("/") ? p || "/" : `/${p}`;
}

/** The string or strings in a path argument: a literal, an array of literals, or an object with `path`. */
export function pathValues(ctx: DetectContext, expr: ts.Expression | undefined, file: string, sf: ts.SourceFile, key = "path"): { value: string; resolved: boolean }[] {
  if (!expr) return [{ value: "", resolved: true }];
  const e = unwrap(expr);
  if (ts.isArrayLiteralExpression(e)) return e.elements.length ? e.elements.flatMap((x) => pathValues(ctx, x, file, sf, key)) : [{ value: "", resolved: true }];
  if (ts.isObjectLiteralExpression(e)) return pathValues(ctx, prop(e, key), file, sf, key);
  return [fold(ctx, e, file, sf)];
}

export const calleeName = (call: ts.CallExpression | ts.NewExpression): string | undefined => {
  const c = call.expression;
  return ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : undefined;
};
