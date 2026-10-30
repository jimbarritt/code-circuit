import { expect, test } from "bun:test";

const run = (...args: string[]) =>
  Bun.spawnSync(["bun", "run", "src/cli.ts", ...args], { cwd: import.meta.dir + "/.." });

test("--help lists render and extract and exits 0", () => {
  const r = run("--help");
  const out = r.stdout.toString();
  expect(r.exitCode).toBe(0);
  expect(out).toContain("ccircuit render");
  expect(out).toContain("ccircuit extract");
});

test("an unknown command exits 1", () => {
  expect(run("nope").exitCode).toBe(1);
});

test("--version prints the package version and exits 0", () => {
  const r = run("--version");
  const pkg = require("../package.json");
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toBe(`ccircuit ${pkg.version}\n`);
});

const SHOP = "tests/fixtures/ts-shop";

test("--help lists survey and --lang", () => {
  const out = run("--help").stdout.toString();
  expect(out).toContain("ccircuit survey <dir> [--json] [--lang ts|rails] [--include");
  expect(out).toContain("--lang ts|rails");
});

test("survey prints the text survey of a TypeScript repo", () => {
  const r = run("survey", SHOP);
  const out = r.stdout.toString();
  expect(r.exitCode).toBe(0);
  expect(out).toContain("@shop/orders-api\n  entries\n    http (7)\n");
  expect(out).toMatch(/total: 19 entries, 25 exits in 5 modules\n$/);
});

test("survey --json prints modules, entries and exits", () => {
  const r = run("survey", SHOP, "--json");
  const back = JSON.parse(r.stdout.toString());
  expect(r.exitCode).toBe(0);
  expect(back.modules).toContain("@shop/orders-api");
  expect(back.entries.length).toBe(19);
  expect(back.exits.length).toBe(25);
});

test("extract detects TypeScript and writes a valid data map with a survey", () => {
  const r = run("extract", SHOP);
  const map = JSON.parse(r.stdout.toString());
  expect(r.exitCode).toBe(0);
  expect(map.language).toBe("TypeScript");
  expect(map.survey.entries.length).toBe(19);
  expect(map.edges.some((e: any) => e.rule === "grpc-call")).toBe(true);
});

test("extract --include keeps endpoints of any kind by method and target", () => {
  const r = run("extract", SHOP, "--include", "GET /api/orders/:orderId", "--include", "KAFKA order.created");
  const map = JSON.parse(r.stdout.toString());
  expect(r.exitCode).toBe(0);
  expect(map.endpoints.map((e: any) => e.id).sort()).toEqual(["@shop/inventory-svc:KAFKA:order.created", "@shop/orders-api:GET:/api/orders/:id"]);
});

test("the Rails fixture is detected, and --lang overrides detection", () => {
  const rails = run("survey", "tests/fixtures/rails-app");
  expect(rails.exitCode).toBe(0);
  expect(rails.stdout.toString()).toMatch(/POST +\/api\/v1\/statuses +Api::V1::StatusesController#create/);
  const map = JSON.parse(run("extract", "tests/fixtures/rails-app", "--lang", "rails", "--include", "POST /api/v1/statuses").stdout.toString());
  expect(map.language).toBe("ruby");
  expect(map.endpoints.map((e: any) => e.id)).toEqual(["POST /api/v1/statuses"]);
  const forced = JSON.parse(run("survey", "tests/fixtures/rails-app", "--json", "--lang", "ts").stdout.toString());
  expect(forced.entries).toEqual([]);
});

test("survey --include keeps the matching entries and the exits they reach", () => {
  const back = JSON.parse(run("survey", SHOP, "--json", "--include", "GET /api/orders/:orderId").stdout.toString());
  expect(back.entries.map((e: any) => `${e.method} ${e.target}`)).toEqual(["GET /api/orders/:id"]);
  expect(back.exits.length).toBeGreaterThan(0);
  const all = JSON.parse(run("survey", SHOP, "--json").stdout.toString());
  expect(back.exits.length).toBeLessThan(all.exits.length);
});

test("survey with a bad --lang or a missing directory exits 1", () => {
  expect(run("survey", SHOP, "--lang", "go").exitCode).toBe(1);
  expect(run("survey", "tests/fixtures/no-such-dir").exitCode).toBe(1);
});
