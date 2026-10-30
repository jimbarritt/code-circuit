import ts from "typescript";
import type { Call, ClassSym, Decorator, Dependency, FnCall, FunctionSym, MethodSym, Project, SymbolIndex } from "./types.ts";

const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

const nameText = (name: ts.PropertyName | ts.BindingName | undefined): string | undefined =>
  name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) ? name.text : undefined;

export function decoratorsOf(node: ts.Node): Decorator[] {
  if (!ts.canHaveDecorators(node)) return [];
  const sf = node.getSourceFile();
  return (ts.getDecorators(node) ?? []).flatMap((d) => {
    const e = d.expression;
    const callee = ts.isCallExpression(e) ? e.expression : e;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
    if (!name) return [];
    const out: Decorator = { name, args: ts.isCallExpression(e) ? [...e.arguments] : [], line: lineOf(sf, d) };
    if (ts.isPropertyAccessExpression(callee)) out.local = callee.getText(sf);
    return [out];
  });
}

const unwrap = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
};

const isFn = (e: ts.Expression | undefined) => !!e && (ts.isArrowFunction(unwrap(e)) || ts.isFunctionExpression(unwrap(e)));

type Decl = ts.VariableDeclaration | ts.EnumDeclaration | ts.ClassDeclaration | ts.FunctionDeclaration;
interface ImportBinding { spec: string; imported?: string; namespace?: boolean }
interface FileInfo {
  decls: Map<string, Decl>;
  defaultExpr?: ts.Expression;
  imports: Map<string, ImportBinding>;
  reexports: { spec?: string; name?: string; local?: string }[];
}

type Target = { file: string; decl: Decl } | { file: string; expr: ts.Expression } | { file: string; namespace: true };
type Obj = { file: string; enumDecl: ts.EnumDeclaration } | { file: string; lit: ts.ObjectLiteralExpression } | { file: string; namespace: true };

export function buildIndex(project: Project): SymbolIndex {
  const infos = new Map<string, FileInfo>();
  const info = (rel: string): FileInfo | undefined => {
    if (infos.has(rel)) return infos.get(rel);
    const f = project.file(rel);
    if (!f) return undefined;
    const out: FileInfo = { decls: new Map(), imports: new Map(), reexports: [] };
    for (const st of f.sf.statements) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.decls.set(d.name.text, d);
      } else if ((ts.isEnumDeclaration(st) || ts.isClassDeclaration(st) || ts.isFunctionDeclaration(st)) && st.name) {
        out.decls.set(st.name.text, st);
        if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) out.decls.set("default", st);
      } else if (ts.isExportAssignment(st) && !st.isExportEquals) {
        if (ts.isIdentifier(st.expression)) out.reexports.push({ name: "default", local: st.expression.text });
        else out.defaultExpr = st.expression;
      } else if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        const spec = st.moduleSpecifier.text, c = st.importClause;
        if (c?.name) out.imports.set(c.name.text, { spec, imported: "default" });
        const nb = c?.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) out.imports.set(nb.name.text, { spec, namespace: true });
        else if (nb) for (const el of nb.elements) out.imports.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text });
      } else if (ts.isExportDeclaration(st)) {
        const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined;
        const ec = st.exportClause;
        if (!ec) { if (spec) out.reexports.push({ spec }); }
        else if (ts.isNamedExports(ec)) for (const el of ec.elements) out.reexports.push({ spec, name: el.name.text, local: (el.propertyName ?? el.name).text });
        else if (spec) out.reexports.push({ spec, name: ec.name.text });
      }
    }
    infos.set(rel, out);
    return out;
  };

  /** Finds what `name` means in `file`: a top-level declaration, an import, or a re-export. */
  const lookup = (file: string, name: string, seen = new Set<string>()): Target | undefined => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const fi = info(file);
    if (!fi) return undefined;
    const d = fi.decls.get(name);
    if (d) return { file, decl: d };
    if (name === "default" && fi.defaultExpr) return { file, expr: fi.defaultExpr };
    const imp = fi.imports.get(name);
    if (imp) {
      const to = project.resolveImport(file, imp.spec);
      if (!to) return undefined;
      return imp.namespace ? { file: to, namespace: true } : lookup(to, imp.imported!, seen);
    }
    for (const r of fi.reexports) {
      if (r.name !== undefined && r.name !== name) continue;
      const to = r.spec ? project.resolveImport(file, r.spec) : file;
      if (!to) continue;
      if (r.name === undefined) { const hit = lookup(to, name, seen); if (hit) return hit; }
      else if (r.local === undefined) return { file: to, namespace: true };
      else return lookup(to, r.local, seen);
    }
    return undefined;
  };

  /** The package and exported name that `name` in `file` comes from, through aliases and local re-exports. */
  const origin = (file: string, name: string, seen = new Set<string>()): { spec: string; imported: string } | undefined => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const fi = info(file);
    if (!fi || fi.decls.has(name)) return undefined;
    const imp = fi.imports.get(name);
    if (imp) {
      if (imp.namespace) return undefined;
      const to = project.resolveImport(file, imp.spec);
      return to ? origin(to, imp.imported!, seen) : { spec: imp.spec, imported: imp.imported! };
    }
    let star: { spec: string; imported: string } | undefined;
    for (const r of fi.reexports) {
      if (r.name !== undefined && (r.name !== name || r.local === undefined)) continue;
      const inner = r.local ?? name;
      const to = r.spec ? project.resolveImport(file, r.spec) : file;
      if (!to) { if (r.name !== undefined) return { spec: r.spec!, imported: inner }; star ??= { spec: r.spec!, imported: inner }; continue; }
      const hit = origin(to, inner, seen);
      if (hit) return hit;
    }
    return star;
  };
  const nsOrigin = (file: string, ns: string, name: string) => {
    const imp = info(file)?.imports.get(ns);
    if (!imp?.namespace) return undefined;
    const to = project.resolveImport(file, imp.spec);
    return to ? origin(to, name) : { spec: imp.spec, imported: name };
  };
  const canon = (file: string, d: Decorator) => {
    const dot = d.local?.split(".");
    const o = dot ? (dot.length === 2 ? nsOrigin(file, dot[0]!, dot[1]!) : undefined) : origin(file, d.name);
    if (!o || o.imported === "default" || o.imported === "*") return;
    if (o.imported !== d.name) { d.local ??= d.name; d.name = o.imported; }
    d.spec = o.spec;
  };

  const exprOf = (t: Target | undefined): { file: string; expr: ts.Expression } | undefined =>
    !t ? undefined : "expr" in t ? t : "decl" in t && ts.isVariableDeclaration(t.decl) && isConst(t.decl) && t.decl.initializer ? { file: t.file, expr: t.decl.initializer } : undefined;

  const isConst = (d: ts.VariableDeclaration) => ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0;

  const resolveObject = (expr: ts.Expression, file: string, depth: number): Obj | undefined => {
    if (depth > 20) return undefined;
    const e = unwrap(expr);
    if (ts.isObjectLiteralExpression(e)) return { file, lit: e };
    if (ts.isIdentifier(e)) {
      const t = lookup(file, e.text);
      if (!t) return undefined;
      if ("namespace" in t) return t;
      if ("decl" in t && ts.isEnumDeclaration(t.decl)) return { file: t.file, enumDecl: t.decl };
      const x = exprOf(t);
      return x && resolveObject(x.expr, x.file, depth + 1);
    }
    const acc = access(e);
    if (!acc) return undefined;
    const parent = resolveObject(acc.obj, file, depth + 1);
    if (!parent) return undefined;
    if ("namespace" in parent) {
      const t = lookup(parent.file, acc.prop);
      if (!t) return undefined;
      if ("namespace" in t) return t;
      if ("decl" in t && ts.isEnumDeclaration(t.decl)) return { file: t.file, enumDecl: t.decl };
      const x = exprOf(t);
      return x && resolveObject(x.expr, x.file, depth + 1);
    }
    if ("lit" in parent) {
      const init = propInit(parent.lit, acc.prop, parent.file);
      return init && resolveObject(init, parent.file, depth + 1);
    }
    return undefined;
  };

  const access = (e: ts.Expression): { obj: ts.Expression; prop: string } | undefined => {
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return { obj: e.expression, prop: e.name.text };
    if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return { obj: e.expression, prop: e.argumentExpression.text };
    return undefined;
  };

  const propInit = (lit: ts.ObjectLiteralExpression, prop: string, file: string): ts.Expression | undefined => {
    for (const p of [...lit.properties].reverse()) {
      const key = ts.isPropertyAssignment(p) && ts.isComputedPropertyName(p.name) ? fold(p.name.expression, file, 1) : ts.isPropertyAssignment(p) ? nameText(p.name) : undefined;
      if (ts.isPropertyAssignment(p) && key === prop) return p.initializer;
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === prop) return p.name;
    }
    return undefined;
  };

  /** Folds an enum initializer, where earlier members can be named and numbers add up. */
  const enumInit = (e: ts.Expression, file: string, seen: Map<string, string | undefined>, depth: number): string | undefined => {
    e = unwrap(e);
    if (ts.isIdentifier(e) && seen.has(e.text)) return seen.get(e.text);
    if (ts.isBinaryExpression(e)) {
      const l = enumInit(e.left, file, seen, depth + 1), r = l === undefined ? undefined : enumInit(e.right, file, seen, depth + 1);
      if (l === undefined || r === undefined) return undefined;
      const num = /^-?\d+(\.\d+)?$/;
      if (!num.test(l) || !num.test(r)) return e.operatorToken.kind === ts.SyntaxKind.PlusToken ? l + r : undefined;
      const a = Number(l), b = Number(r);
      switch (e.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: return String(a + b);
        case ts.SyntaxKind.MinusToken: return String(a - b);
        case ts.SyntaxKind.AsteriskToken: return String(a * b);
        case ts.SyntaxKind.LessThanLessThanToken: return String(a << b);
        case ts.SyntaxKind.BarToken: return String(a | b);
      }
      return undefined;
    }
    return fold(e, file, depth + 1);
  };

  const enumMember = (decl: ts.EnumDeclaration, file: string, prop: string, depth: number): string | undefined => {
    let next: number | undefined = 0;
    const seen = new Map<string, string | undefined>();
    for (const m of decl.members) {
      let val: string | undefined;
      if (m.initializer) {
        val = enumInit(m.initializer, file, seen, depth + 1);
        next = val !== undefined && m.initializer && /^-?\d+$/.test(val) ? Number(val) + 1 : undefined;
      } else {
        val = next === undefined ? undefined : String(next);
        if (next !== undefined) next++;
      }
      if (nameText(m.name) === prop) return val;
      const n = nameText(m.name);
      if (n !== undefined) seen.set(n, val);
    }
    return undefined;
  };

  const fold = (expr: ts.Expression, file: string, depth = 0): string | undefined => {
    if (depth > 20) return undefined;
    const e = unwrap(expr);
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isNumericLiteral(e)) return String(Number(e.text));
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return String(-Number(e.operand.text));
    if (ts.isTemplateExpression(e)) {
      let out = e.head.text;
      for (const span of e.templateSpans) {
        const v = fold(span.expression, file, depth + 1);
        if (v === undefined) return undefined;
        out += v + span.literal.text;
      }
      return out;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = fold(e.left, file, depth + 1);
      const r = l === undefined ? undefined : fold(e.right, file, depth + 1);
      return l === undefined || r === undefined ? undefined : l + r;
    }
    if (ts.isIdentifier(e)) {
      const x = exprOf(lookup(file, e.text));
      return x && fold(x.expr, x.file, depth + 1);
    }
    const acc = access(e);
    if (acc) {
      const obj = resolveObject(acc.obj, file, depth + 1);
      if (!obj) return undefined;
      if ("enumDecl" in obj) return enumMember(obj.enumDecl, obj.file, acc.prop, depth);
      if ("lit" in obj) { const init = propInit(obj.lit, acc.prop, obj.file); return init && fold(init, obj.file, depth + 1); }
      const x = exprOf(lookup(obj.file, acc.prop));
      if (x) return fold(x.expr, x.file, depth + 1);
    }
    return undefined;
  };

  const classes: ClassSym[] = [];
  const functions: FunctionSym[] = [];
  const classByNode = new Map<ts.Node, ClassSym>();
  const fnByNode = new Map<ts.Node, FunctionSym>();

  const usedIds = new Set<string>();
  for (const f of project.files) {
    const sf = f.sf;
    for (const st of sf.statements) {
      if (ts.isClassDeclaration(st) && st.name) {
        let id = `${f.module}:${st.name.text}`;
        if (usedIds.has(id)) id += `@${f.rel}`;
        usedIds.add(id);
        const cls: ClassSym = {
          id, name: st.name.text, module: f.module, file: f.rel, line: lineOf(sf, st.name),
          decorators: decoratorsOf(st), deps: [], methods: methodsOf(st, sf), node: st,
        };
        const ext = st.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
        if (ext) cls.extends = ext.expression.getText(sf);
        if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)) cls.abstract = true;
        classes.push(cls);
        classByNode.set(st, cls);
      } else if (ts.isFunctionDeclaration(st) && st.name) {
        const fn = { id: `${f.module}:${f.rel}#${st.name.text}`, name: st.name.text, module: f.module, file: f.rel, line: lineOf(sf, st.name), node: st };
        functions.push(fn);
        fnByNode.set(st, fn);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !isFn(d.initializer)) continue;
          const fn = { id: `${f.module}:${f.rel}#${d.name.text}`, name: d.name.text, module: f.module, file: f.rel, line: lineOf(sf, d.name), node: d };
          functions.push(fn);
          fnByNode.set(d, fn);
        }
      }
    }
  }

  const classById = new Map<string, ClassSym>();
  const classesByName = new Map<string, ClassSym[]>();
  for (const c of classes) {
    classById.set(c.id, c);
    classesByName.set(c.name, [...(classesByName.get(c.name) ?? []), c]);
  }

  const classIdFor = (file: string, name: string): string | undefined => {
    const t = lookup(file, name);
    if (t && "decl" in t && ts.isClassDeclaration(t.decl)) {
      const c = classByNode.get(t.decl);
      if (c) return c.id;
    }
    const same = classesByName.get(name);
    return same?.length === 1 ? same[0]!.id : undefined;
  };

  for (const c of classes) {
    for (const d of c.decorators) canon(c.file, d);
    for (const m of c.methods) for (const d of m.decorators) canon(c.file, d);
    const ext = c.node.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
    const base = ext && ts.isIdentifier(ext) ? classIdFor(c.file, ext.text) : undefined;
    if (base && base !== c.id) c.base = base;
  }

  // Nest custom providers: { provide: X, useClass: Y } and { provide: X, useExisting: Y }.
  const bindings = new Map<string, string[]>();
  const tokenKey = (e: ts.Expression, file: string) => {
    const u = unwrap(e);
    const cls = ts.isIdentifier(u) ? classIdFor(file, u.text) : undefined;
    if (cls) return cls;
    const v = fold(u, file);
    return v === undefined ? undefined : `token:${v}`;
  };
  for (const f of project.files) {
    const visit = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        const get = (k: string) => propInit(n, k, f.rel);
        const provide = get("provide"), use = get("useClass") ?? get("useExisting");
        const key = provide && use ? tokenKey(provide, f.rel) : undefined;
        const u = use && unwrap(use);
        const to = key && u && ts.isIdentifier(u) ? classIdFor(f.rel, u.text) : undefined;
        if (key && to && to !== key && !bindings.get(key)?.includes(to)) bindings.set(key, [...(bindings.get(key) ?? []), to]);
      }
      ts.forEachChild(n, visit);
    };
    visit(f.sf);
  }

  for (const c of classes) {
    c.deps = depsOf(c, fold, classIdFor);
    for (const d of c.deps) {
      const bound = bindings.get(d.classId ?? (d.token !== undefined ? `token:${d.token}` : ""));
      if (bound?.length === 1) d.classId = bound[0];
    }
  }

  // Calls to top-level functions of the repo, in methods and in functions.
  const fnCallsIn = (body: ts.Node, file: string, self?: string): FnCall[] => {
    const out: FnCall[] = [];
    const sf = body.getSourceFile();
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const t = lookup(file, n.expression.text);
        const fn = t && "decl" in t ? fnByNode.get(t.decl) : undefined;
        if (fn && fn.id !== self) out.push({ fn: fn.id, line: lineOf(sf, n) });
      }
      ts.forEachChild(n, visit);
    };
    visit(body);
    return out;
  };
  for (const c of classes) for (const m of c.methods) {
    const fc = fnCallsIn(m.node, c.file);
    if (fc.length) m.fnCalls = fc;
  }
  for (const fn of functions) {
    const fc = fnCallsIn(fn.node, fn.file, fn.id);
    if (fc.length) fn.fnCalls = fc;
  }

  const ownerOf = (fileRel: string, node: ts.Node) => {
    let method: string | undefined;
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
      const c = classByNode.get(n);
      if (c) return { id: c.id, symbol: method ? `${c.name}.${method}` : c.name };
      const fn = fnByNode.get(n);
      if (fn) return { id: fn.id, symbol: fn.name };
      if (n.parent && ts.isClassDeclaration(n.parent) && (ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n))) method = nameText(n.name);
      else if (n.parent && ts.isClassDeclaration(n.parent) && ts.isConstructorDeclaration(n)) method = "constructor";
    }
    const mod = project.file(fileRel)?.module ?? ".";
    return { id: `${mod}:${fileRel}`, symbol: fileRel };
  };

  return { classes, functions, classById, classesByName, bindings, resolveValue: (expr, fileRel) => fold(expr, fileRel), ownerOf };
}

function methodsOf(cls: ts.ClassDeclaration, sf: ts.SourceFile): MethodSym[] {
  const out: MethodSym[] = [];
  for (const m of cls.members) {
    if (!ts.isMethodDeclaration(m) && !ts.isPropertyDeclaration(m)) continue;
    const body = ts.isMethodDeclaration(m) ? m.body : isFn(m.initializer) ? m.initializer : undefined;
    const name = nameText(m.name);
    if (!body || !name) continue;
    out.push({ name, line: lineOf(sf, m.name), decorators: decoratorsOf(m), node: m, calls: callsIn(body, sf) });
  }
  return out;
}

/** Finds this.<dep>.<method>() and this.<dep>.<a>.<method>() calls. */
function callsIn(body: ts.Node, sf: ts.SourceFile): Call[] {
  const out: Call[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      let obj: ts.Expression = n.expression.expression;
      const isAccess = (e: ts.Expression): e is ts.PropertyAccessExpression | ts.ElementAccessExpression => ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e);
      while (isAccess(obj) && !(obj.expression.kind === ts.SyntaxKind.ThisKeyword)) obj = obj.expression;
      const dep = !isAccess(obj) || obj.expression.kind !== ts.SyntaxKind.ThisKeyword ? undefined
        : ts.isPropertyAccessExpression(obj) ? obj.name.text : ts.isStringLiteralLike(obj.argumentExpression) ? obj.argumentExpression.text : undefined;
      if (dep) out.push({ dep, method, line: lineOf(sf, n.expression.name), node: n });
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return out;
}

function depsOf(cls: ClassSym, fold: (e: ts.Expression, file: string) => string | undefined, classIdFor: (file: string, name: string) => string | undefined): Dependency[] {
  const ctor = cls.node.members.find((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m));
  const sf = cls.node.getSourceFile();
  const out: Dependency[] = [];
  const add = (p: ts.ParameterDeclaration | ts.PropertyDeclaration, injectOnly: boolean) => {
    if (!ts.isIdentifier(p.name)) return;
    const inject = decoratorsOf(p).find((d) => d.name.startsWith("Inject"));
    const ref = p.type && ts.isTypeReferenceNode(p.type) ? p.type : undefined;
    if (!inject && (!ref || injectOnly)) return;
    const dep: Dependency = { param: p.name.text };
    if (p.type) dep.typeName = p.type.getText(sf);
    if (inject) {
      dep.injectedBy = inject.name;
      const arg = inject.args[0];
      if (arg) dep.token = fold(arg, cls.file) ?? arg.getText(sf);
    }
    const typeId = ref && ts.isIdentifier(ref.typeName) ? ref.typeName.text : ref && ts.isQualifiedName(ref.typeName) ? ref.typeName.right.text : undefined;
    const classId = typeId ? classIdFor(cls.file, typeId) : undefined;
    if (classId) dep.classId = classId;
    else if (inject?.name === "Inject" && inject.args[0] && ts.isIdentifier(unwrap(inject.args[0]))) {
      const viaToken = classIdFor(cls.file, (unwrap(inject.args[0]) as ts.Identifier).text);
      if (viaToken) dep.classId = viaToken;
    }
    out.push(dep);
  };
  for (const p of ctor?.parameters ?? []) add(p, false);
  // Property injection: @Inject(X) private x: X.
  for (const m of cls.node.members) if (ts.isPropertyDeclaration(m) && !out.some((d) => d.param === nameText(m.name))) add(m, true);
  return out;
}

/** The class and its base classes in the repo, nearest first. */
export function classChain(index: SymbolIndex, c: ClassSym): ClassSym[] {
  const out = [c];
  for (let b = c.base ? index.classById.get(c.base) : undefined; b && !out.includes(b); b = b.base ? index.classById.get(b.base) : undefined) out.push(b);
  return out;
}

/** Own and inherited methods, each with the class that declares it. A method hides one of the same name in a base class. */
export function allMethods(index: SymbolIndex, c: ClassSym): { m: MethodSym; cls: ClassSym }[] {
  const names = new Set<string>();
  const out: { m: MethodSym; cls: ClassSym }[] = [];
  for (const cls of classChain(index, c)) for (const m of cls.methods) {
    if (cls !== c && names.has(m.name)) continue;
    names.add(m.name);
    out.push({ m, cls });
  }
  return out;
}

/** Own and inherited dependencies. A dependency hides one of the same name in a base class. */
export function allDeps(index: SymbolIndex, c: ClassSym): Dependency[] {
  const out = new Map<string, Dependency>();
  for (const cls of classChain(index, c)) for (const d of cls.deps) if (!out.has(d.param)) out.set(d.param, d);
  return [...out.values()];
}
