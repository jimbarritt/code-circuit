import ts from "typescript";
import type { Detector } from "../types.ts";
import { type Resolver, siteDetector, unwrap } from "./clients.ts";

const VERBS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const PROTOCOL: Record<string, string> = { axios: "axios", got: "got", fetch: "fetch", "nest-http": "nest-http", undici: "undici" };
const RULE: Record<string, string> = { axios: "axios-call", got: "got-call", fetch: "fetch-call", "nest-http": "nest-http-service", undici: "undici-request" };

const verbOf = (r: Resolver, opts: ts.Expression | undefined) => {
  const m = r.prop(opts, "method");
  const v = m && r.val(m);
  return v?.resolved ? v.target.toUpperCase() : m ? m.getText() : "GET";
};

const isObj = (e: ts.Expression | undefined) => !!e && ts.isObjectLiteralExpression(unwrap(e));

export const httpDetector: Detector = siteDetector("http-out", (s, r) => {
  const { client: c, method: m, args } = s;
  if (c.lib === "octokit" && m === "request") return { kind: "http-out", protocol: "octokit", method: "REQUEST", ...r.val(args[0]), rule: "octokit-request", detail: "host: api.github.com" };
  if (c.lib === "octokit-ns") return { kind: "http-out", protocol: "octokit", method: m, target: `${c.name}.${m}`, resolved: true, rule: "octokit-rest", detail: "host: api.github.com" };
  const protocol = PROTOCOL[c.lib];
  if (!protocol) return undefined;
  let verb: string, url: ts.Expression | undefined;
  const form = /^(post|put|patch)Form$/.exec(m);
  if (VERBS.has(m) || form) { verb = (form ? form[1]! : m).toUpperCase(); url = args[0]; }
  else if (m === "()" || m === "request") {
    if (c.lib === "nest-http" && m === "()") return undefined;
    const config = isObj(args[0]) ? args[0] : args[1];
    verb = verbOf(r, config);
    url = isObj(args[0]) ? r.prop(args[0], "url") : args[0];
  } else return undefined;
  let t = r.val(url);
  if (c.base && t.resolved && !/^[a-z]+:\/\//i.test(t.target)) t = { target: c.base.replace(/\/+$/, "") + "/" + t.target.replace(/^\/+/, ""), resolved: true };
  return { kind: "http-out", protocol, method: verb, ...t, rule: RULE[c.lib]! };
});
