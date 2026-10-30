import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripRuby } from "./ruby.ts";

export interface Route {
  method: string;
  path: string;
  /** Controller path as Rails writes it, for example "api/v1/statuses/favourites". */
  controller: string;
  action: string;
  /** Where the route was declared, for the rule record. */
  source: string;
}

interface Ctx {
  path: string[];
  module: string[];
  defaultTo?: string;
  resource?: { controller: string; module: string[]; param?: string; plural: boolean; base: string[] };
  frame?: "member" | "collection";
  skip?: boolean;
}

interface Opts { name?: string; o: Record<string, string | string[]> }

const STD = {
  plural: [["index", "GET", ""], ["new", "GET", "/new"], ["create", "POST", ""], ["show", "GET", "/:p"], ["edit", "GET", "/:p/edit"], ["update", "PATCH", "/:p"], ["update", "PUT", "/:p"], ["destroy", "DELETE", "/:p"]],
  singular: [["new", "GET", "/new"], ["create", "POST", ""], ["show", "GET", ""], ["edit", "GET", "/edit"], ["update", "PATCH", ""], ["update", "PUT", ""], ["destroy", "DELETE", ""]],
} as const;

export function pluralize(w: string): string {
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  if (/(s|x|ch|sh)$/.test(w)) return w + "es";
  return w + "s";
}

export function singularize(w: string): string {
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/sses$/.test(w)) return w.slice(0, -2);
  if (/uses$/.test(w)) return w.slice(0, -2);
  if (/(x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Joins physical lines into statements: a line continues while brackets are open or it ends in a comma. */
function statements(code: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    cur += (cur ? " " : "") + line;
    for (const c of line) depth += "([{".includes(c) ? 1 : ")]}".includes(c) ? -1 : 0;
    if (depth <= 0 && !/[,\\]$/.test(line)) { out.push(cur); cur = ""; depth = 0; }
  }
  if (cur) out.push(cur);
  return out;
}

function parseOpts(text: string): Opts {
  const o: Record<string, string | string[]> = {};
  let rest = text.replace(/^\s*\(/, "").replace(/\)\s*$/, "");
  const first = rest.match(/^\s*(?::([\w]+)|'([^']*)'|"([^"]*)")/);
  const name = first ? (first[1] ?? first[2] ?? first[3]) : undefined;
  if (first) rest = rest.slice(first[0].length);
  const re = /(\w+):\s*(?::(\w+)|'([^']*)'|"([^"]*)"|\[([^\]]*)\]|(true|false))/g;
  for (let m; (m = re.exec(rest)); ) {
    o[m[1]] = m[5] !== undefined ? [...m[5].matchAll(/:(\w+)|'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2] ?? x[3]) : (m[2] ?? m[3] ?? m[4] ?? m[6]);
  }
  return { name, o };
}

const asList = (v: string | string[] | undefined): string[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
const seg = (s: string) => s.split("/").filter(Boolean);
const joinPath = (parts: string[]) => "/" + parts.flatMap(seg).join("/");

/** Reads Rails route files. It follows `draw(:name)` into config/routes/name.rb. */
export function parseRoutes(root: string): Route[] {
  const routes: Route[] = [];
  const parseFile = (rel: string, base: Ctx) => {
    const file = join(root, rel);
    if (!existsSync(file)) return;
    const stack: Ctx[] = [base];
    for (const st of statements(stripRuby(readFileSync(file, "utf8"), true))) {
      const ctx = stack[stack.length - 1];
      if (/^end\b/.test(st)) { if (stack.length > 1) stack.pop(); continue; }
      const draw = st.match(/^draw\s*\(?\s*:(\w+)/);
      if (draw) { parseFile(`config/routes/${draw[1]}.rb`, ctx); continue; }
      const opensBlock = /\bdo(\s*\|[^|]*\|)?\s*$/.test(st);
      const head = st.replace(/\s*\bdo(\s*\|[^|]*\|)?\s*$/, "");
      const word = head.match(/^(\w+)/)?.[1] ?? "";
      const args = head.slice(word.length);
      const here = `${rel}: ${head}`;
      let next: Ctx | null = null;

      if (word === "namespace" || word === "scope") {
        const { name, o } = parseOpts(args);
        const n: Ctx = { ...ctx, frame: undefined };
        if (word === "namespace" && name) { n.path = [...ctx.path, name]; n.module = [...ctx.module, name]; }
        else {
          const p = (o.path as string) ?? (word === "scope" ? name : undefined);
          if (p) n.path = [...ctx.path, ...seg(p)];
          if (o.module) n.module = [...ctx.module, ...seg(String(o.module))];
        }
        next = n;
      } else if (word === "resources" || word === "resource") {
        const { name, o } = parseOpts(args);
        if (name) next = resource(word === "resources", name, o, ctx, here, routes);
        if (!opensBlock) continue;
      } else if (word === "member" || word === "collection") {
        const n: Ctx = { ...ctx, frame: word };
        if (ctx.resource) n.path = word === "member" && ctx.resource.param ? [...ctx.resource.base, ":" + ctx.resource.param] : ctx.resource.base;
        next = n;
      } else if (word === "concern") {
        next = { ...ctx, skip: true };
      } else if (word === "with_options") {
        const { o } = parseOpts(args.replace(/^\s*/, ":x, "));
        next = { ...ctx, defaultTo: (o.to as string) ?? ctx.defaultTo };
      } else if (/^(get|post|put|patch|delete|match|root)$/.test(word)) {
        if (!ctx.skip) verb(word, args, ctx, here, routes);
        continue;
      } else if (opensBlock || /^(if|unless|case|begin|while|def)$/.test(word)) {
        next = { ...ctx };
      }
      if (next && (opensBlock || /^(if|unless|case|begin|while|def)$/.test(word))) stack.push(next);
    }
  };
  parseFile("config/routes.rb", { path: [], module: [] });
  return routes;
}

function resource(plural: boolean, name: string, o: Opts["o"], ctx: Ctx, source: string, routes: Route[]): Ctx {
  const modulePath = [...ctx.module, ...seg(String(o.module ?? ""))];
  const controller = String(o.controller ?? (plural ? name : pluralize(name)));
  const only = asList(o.only), except = asList(o.except);
  const param = String(o.param ?? "id");
  const base = [...ctx.path, ...seg(String(o.path ?? name))];
  if (!ctx.skip) {
    for (const [action, method, tail] of STD[plural ? "plural" : "singular"]) {
      if (only && !only.includes(action)) continue;
      if (except?.includes(action)) continue;
      routes.push({ method, path: joinPath([...base, tail.replace(":p", ":" + param)]), controller: joinPath([...modulePath, controller]).slice(1), action, source });
    }
  }
  const nestedParam = plural ? `${singularize(name)}_${param}` : undefined;
  return {
    ...ctx,
    path: plural ? [...base, ":" + nestedParam] : base,
    module: modulePath,
    frame: undefined,
    resource: { controller, module: modulePath, param: plural ? param : undefined, plural, base },
  };
}

function verb(word: string, args: string, ctx: Ctx, source: string, routes: Route[]) {
  const { name, o } = parseOpts(word === "root" ? ":x, to: " + args.replace(/[()]/g, "").trim() : args);
  const to = String(o.to ?? ctx.defaultTo ?? "");
  let methods = [word.toUpperCase()];
  if (word === "match") methods = (asList(o.via) ?? ["get"]).map((m) => m.toUpperCase());
  if (word === "root") methods = ["GET"];
  const path = word === "root" ? ctx.path : name ? [...ctx.path, ...seg(name)] : ctx.path;
  let controller: string, action: string;
  const hash = to.match(/^([\w/]+)#(\w+)$/);
  if (hash) { controller = joinPath([...ctx.module, hash[1]]).slice(1); action = hash[2]; }
  else if (!to && name && ctx.resource && !/[/:]/.test(name)) { controller = joinPath([...ctx.resource.module, ctx.resource.controller]).slice(1); action = name; }
  else return;
  for (const method of methods) routes.push({ method, path: joinPath(path), controller, action, source });
}

/** Lower-case a route with each :param renamed, so `:id` and `:status_id` compare equal. */
export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.replace(/:\w+/g, ":p")}`;
}
