import ts from "typescript";
import type { Call, ClassSym, Decorator, Dependency, FunctionSym, MethodSym, Project, SymbolIndex } from "./types.ts";

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
    return name ? [{ name, args: ts.isCallExpression(e) ? [...e.arguments] : [], line: lineOf(sf, d) }] : [];
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
  imports: Map<string, ImportBinding>;
  reexports: { spec?: string; name?: string; local?: string }[];
}

type Target = { file: string; decl: Decl } | { file: string; namespace: true };
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

  const isConst = (d: ts.VariableDeclaration) => ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0;

  const resolveObject = (expr: ts.Expression, file: string, depth: number): Obj | undefined => {
    if (depth > 20) return undefined;
    const e = unwrap(expr);
    if (ts.isObjectLiteralExpression(e)) return { file, lit: e };
    if (ts.isIdentifier(e)) {
      const t = lookup(file, e.text);
      if (!t) return undefined;
      if ("namespace" in t) return t;
      if (ts.isEnumDeclaration(t.decl)) return { file: t.file, enumDecl: t.decl };
      if (ts.isVariableDeclaration(t.decl) && isConst(t.decl) && t.decl.initializer) return resolveObject(t.decl.initializer, t.file, depth + 1);
      return undefined;
    }
    const acc = access(e);
    if (!acc) return undefined;
    const parent = resolveObject(acc.obj, file, depth + 1);
    if (!parent) return undefined;
    if ("namespace" in parent) {
      const t = lookup(parent.file, acc.prop);
      if (!t) return undefined;
      if ("namespace" in t) return t;
      if (ts.isEnumDeclaration(t.decl)) return { file: t.file, enumDecl: t.decl };
      if (ts.isVariableDeclaration(t.decl) && isConst(t.decl) && t.decl.initializer) return resolveObject(t.decl.initializer, t.file, depth + 1);
      return undefined;
    }
    if ("lit" in parent) {
      const init = propInit(parent.lit, acc.prop);
      return init && resolveObject(init, parent.file, depth + 1);
    }
    return undefined;
  };

  const access = (e: ts.Expression): { obj: ts.Expression; prop: string } | undefined => {
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return { obj: e.expression, prop: e.name.text };
    if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return { obj: e.expression, prop: e.argumentExpression.text };
    return undefined;
  };

  const propInit = (lit: ts.ObjectLiteralExpression, prop: string): ts.Expression | undefined => {
    for (const p of [...lit.properties].reverse()) {
      if (ts.isPropertyAssignment(p) && nameText(p.name) === prop) return p.initializer;
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === prop) return p.name;
    }
    return undefined;
  };

  const enumMember = (decl: ts.EnumDeclaration, file: string, prop: string, depth: number): string | undefined => {
    let next: number | undefined = 0;
    for (const m of decl.members) {
      let val: string | undefined;
      if (m.initializer) {
        val = fold(m.initializer, file, depth + 1);
        next = val !== undefined && m.initializer && /^-?\d+$/.test(val) ? Number(val) + 1 : undefined;
      } else {
        val = next === undefined ? undefined : String(next);
        if (next !== undefined) next++;
      }
      if (nameText(m.name) === prop) return val;
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
      const t = lookup(file, e.text);
      if (t && "decl" in t && ts.isVariableDeclaration(t.decl) && isConst(t.decl) && t.decl.initializer) return fold(t.decl.initializer, t.file, depth + 1);
      return undefined;
    }
    const acc = access(e);
    if (acc) {
      const obj = resolveObject(acc.obj, file, depth + 1);
      if (!obj) return undefined;
      if ("enumDecl" in obj) return enumMember(obj.enumDecl, obj.file, acc.prop, depth);
      if ("lit" in obj) { const init = propInit(obj.lit, acc.prop); return init && fold(init, obj.file, depth + 1); }
      const t = lookup(obj.file, acc.prop);
      if (t && "decl" in t && ts.isVariableDeclaration(t.decl) && isConst(t.decl) && t.decl.initializer) return fold(t.decl.initializer, t.file, depth + 1);
    }
    return undefined;
  };

  const classes: ClassSym[] = [];
  const functions: FunctionSym[] = [];
  const classByNode = new Map<ts.Node, ClassSym>();
  const fnByNode = new Map<ts.Node, FunctionSym>();

  for (const f of project.files) {
    const sf = f.sf;
    for (const st of sf.statements) {
      if (ts.isClassDeclaration(st) && st.name) {
        const cls: ClassSym = {
          id: `${f.module}:${st.name.text}`, name: st.name.text, module: f.module, file: f.rel, line: lineOf(sf, st.name),
          decorators: decoratorsOf(st), deps: [], methods: methodsOf(st, sf), node: st,
        };
        const ext = st.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
        if (ext) cls.extends = ext.expression.getText(sf);
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
    if (!classById.has(c.id)) classById.set(c.id, c);
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

  for (const c of classes) c.deps = depsOf(c, fold, classIdFor);

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

  return { classes, functions, classById, classesByName, resolveValue: (expr, fileRel) => fold(expr, fileRel), ownerOf };
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
      while (ts.isPropertyAccessExpression(obj) && !(obj.expression.kind === ts.SyntaxKind.ThisKeyword)) obj = obj.expression;
      if (ts.isPropertyAccessExpression(obj) && obj.expression.kind === ts.SyntaxKind.ThisKeyword) {
        out.push({ dep: obj.name.text, method, line: lineOf(sf, n.expression.name), node: n });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return out;
}

function depsOf(cls: ClassSym, fold: (e: ts.Expression, file: string) => string | undefined, classIdFor: (file: string, name: string) => string | undefined): Dependency[] {
  const ctor = cls.node.members.find((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m));
  if (!ctor) return [];
  const sf = cls.node.getSourceFile();
  const out: Dependency[] = [];
  for (const p of ctor.parameters) {
    if (!ts.isIdentifier(p.name)) continue;
    const inject = decoratorsOf(p).find((d) => d.name.startsWith("Inject"));
    const ref = p.type && ts.isTypeReferenceNode(p.type) ? p.type : undefined;
    if (!inject && !ref) continue;
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
  }
  return out;
}
