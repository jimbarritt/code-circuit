import { expect, test } from "bun:test";
import { join } from "node:path";
import { extractRails } from "../src/extract/rails.ts";
import { extractTypeScript } from "../src/extract/ts/assemble.ts";
import { formatSurvey, railsSurvey, surveyJson } from "../src/extract/ts/survey.ts";
import type { Finding } from "../src/extract/ts/types.ts";

const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const f = (o: Partial<Finding>): Finding => ({
  direction: "entry", kind: "http", protocol: "nest", method: "GET", target: "/", resolved: true,
  module: "api", file: "src/a.ts", line: 1, symbol: "A.get", node: "api:A", rule: "r", ...o,
});

test("text groups by module, direction and kind, with counts", () => {
  const text = formatSurvey({
    modules: ["api", "lib", "worker"],
    entries: [f({ target: "/users", line: 3 }), f({ kind: "grpc", method: "GRPC", target: "Users/Get", symbol: "A.grpc", line: 9 }), f({ module: "worker", kind: "cron", method: "CRON", target: "0 * * * *", symbol: "tick", file: "w.ts", line: 2 })],
    exits: [f({ direction: "exit", kind: "cache", protocol: "ioredis", method: "get", target: "`k:${id}`", resolved: false, symbol: "A.get", line: 5 })],
  });
  expect(text).toBe([
    "api",
    "  entries",
    "    http (1)",
    "      GET     /users      A.get   src/a.ts:3",
    "    grpc (1)",
    "      GRPC    Users/Get   A.grpc  src/a.ts:9",
    "  exits",
    "    cache (1)",
    "      get     `k:${id}`?  A.get   src/a.ts:5",
    "  api: 2 entries, 1 exit",
    "",
    "lib",
    "  lib: 0 entries, 0 exits",
    "",
    "worker",
    "  entries",
    "    cron (1)",
    "      CRON    0 * * * *   tick    w.ts:2",
    "  worker: 1 entry, 0 exits",
    "",
    "total: 3 entries, 1 exit in 3 modules",
    "",
  ].join("\n"));
});

test("ts-shop: every finding is listed once and unresolved targets carry a ?", () => {
  const survey = extractTypeScript(fixture("ts-shop")).survey;
  const text = formatSurvey(survey);
  const rows = text.split("\n").filter((l) => l.startsWith("      "));
  expect(rows.length).toBe(survey.entries.length + survey.exits.length);
  expect(text).toContain("@shop/orders-api\n  entries\n    http (7)\n");
  expect(text).toMatch(/POST +`\$\{process\.env\.FRAUD_URL\}\/check`\? +PricingClient\.screen +services\/orders-api\/src\/pricing\/pricing\.client\.ts:16/);
  expect(text).toMatch(/GRPC +InventoryService\/ReserveStock +InventoryController\.reserveStock +services\/inventory-svc\/src\/inventory\.controller\.ts:10/);
  expect(text).toContain("  @shop/orders-api: 11 entries, 15 exits\n");
  expect(text.trimEnd().split("\n").pop()).toBe(`total: ${survey.entries.length} entries, ${survey.exits.length} exits in 5 modules`);
  // entries come before exits within a module
  const mod = text.split("\n\n").find((b) => b.startsWith("@shop/orders-api"))!;
  expect(mod.indexOf("  entries")).toBeLessThan(mod.indexOf("  exits"));
});

test("JSON holds modules, entries and exits", () => {
  const survey = extractTypeScript(fixture("ts-shop")).survey;
  const back = JSON.parse(surveyJson(survey));
  expect(Object.keys(back)).toEqual(["modules", "entries", "exits"]);
  expect(back.entries.length).toBe(survey.entries.length);
  expect(back.exits[0]).toMatchObject({ direction: "exit", module: "@shop/inventory-svc" });
});

test("rails: the survey lists the endpoints and the io edges", () => {
  const survey = railsSurvey(extractRails(fixture("rails-app")));
  expect(survey.entries.map((e) => `${e.method} ${e.target}`)).toContain("POST /api/v1/statuses");
  expect(survey.exits.some((e) => e.kind === "database" && e.target === "PostgreSQL")).toBe(true);
  const text = formatSurvey(survey);
  expect(text).toMatch(/POST +\/api\/v1\/statuses +Api::V1::StatusesController#create +app\/controllers\/api\/v1\/statuses_controller\.rb\n/);
});
