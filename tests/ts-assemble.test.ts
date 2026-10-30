import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateDataMap } from "../src/datamap.ts";
import { extractTypeScript } from "../src/extract/ts/assemble.ts";

const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ccircuit-assemble-"));
  made.push(root);
  for (const [rel, text] of Object.entries({ "package.json": '{"name":"app"}', ...files })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

describe("fixtures", () => {
  for (const name of ["ts-shop", "ts-plain"]) {
    test(`${name}: the map validates and every EXPECTED link is an edge`, () => {
      const map = extractTypeScript(fixture(name));
      expect(validateDataMap(map)).toEqual([]);
      const expected = JSON.parse(readFileSync(join(fixture(name), "EXPECTED.json"), "utf8"));
      const findings = [...map.survey.entries, ...map.survey.exits];
      const nodeOf = (symbol: string) => findings.find((f) => f.symbol === symbol)?.node;
      for (const l of expected.links) {
        const from = nodeOf(l.from_symbol), to = nodeOf(l.to_symbol);
        expect(from && to).toBeTruthy();
        const edge = map.edges.find((e) => e.from === from && e.to === to && e.kind === l.kind && (l.kind === "sync" || e.queue === l.via));
        expect(edge ? `${l.from_symbol} -> ${l.to_symbol}` : `missing ${l.from_symbol} -> ${l.to_symbol} via ${l.via}`).toBe(`${l.from_symbol} -> ${l.to_symbol}`);
      }
      expect(map.endpoints.length).toBe(map.survey.entries.length);
      expect(map.language).toBe("TypeScript");
      expect(map.system).toBe(name);
    });
  }

  test("ts-shop: nodes, kinds, edges and externals", () => {
    const map = extractTypeScript(fixture("ts-shop"));
    const kind = (id: string) => map.nodes.find((n) => n.id === id)?.kind;
    expect(map.framework).toBe("NestJS");
    expect(kind("@shop/orders-api:OrdersController")).toBe("controller");
    expect(kind("@shop/orders-api:OrdersResolver")).toBe("resolver");
    expect(kind("@shop/orders-api:OrdersGateway")).toBe("gateway");
    expect(kind("@shop/orders-api:OrdersService")).toBe("service");
    expect(kind("@shop/orders-api:InventoryClient")).toBe("client");
    expect(kind("@shop/mailer-worker:EmailProcessor")).toBe("worker");
    expect(map.nodes.find((n) => n.id === "@shop/mailer-worker:EmailProcessor")?.queue).toBe("emails");
    for (const n of map.nodes) expect(typeof n.module).toBe("string");
    expect(map.edges).toContainEqual({ from: "@shop/orders-api:OrdersController", to: "@shop/orders-api:OrdersService", kind: "sync", rule: "di-call" });
    expect(map.edges).toContainEqual({ from: "@shop/orders-api:InventoryClient", to: "@shop/inventory-svc:InventoryController", kind: "sync", rule: "grpc-call" });
    expect(map.edges).toContainEqual({ from: "@shop/orders-api:OrdersService", to: "database:typeorm", kind: "io", rule: "typeorm-repository" });
    expect(map.externals).toContainEqual({ id: "cloud:aws-ses", name: "AWS SES", kind: "cloud", protocol: "aws-ses" });
    expect(map.externals.map((x) => x.id)).toContain("database:prisma");
    // a matched producer links to its consumer, not to an external
    expect(map.externals.map((x) => x.id)).not.toContain("message-out:kafka");
    const ep = map.endpoints.find((e) => e.path === "/api/orders/:id" && e.method === "GET")!;
    expect(ep).toMatchObject({ entry: "@shop/orders-api:OrdersController", kind: "http", protocol: "nest", module: "@shop/orders-api", file: "services/orders-api/src/orders/orders.controller.ts", line: 14 });
    expect(map.survey.modules).toEqual(JSON.parse(readFileSync(join(fixture("ts-shop"), "EXPECTED.json"), "utf8")).modules);
  });

  test("the output is the same on every run", () => {
    expect(JSON.stringify(extractTypeScript(fixture("ts-shop")))).toBe(JSON.stringify(extractTypeScript(fixture("ts-shop"))));
  });

  test("--include keeps the matching endpoints and what they reach", () => {
    const map = extractTypeScript(fixture("ts-shop"), { include: ["GET /api/orders/:orderId"] });
    expect(validateDataMap(map)).toEqual([]);
    expect(map.endpoints.map((e) => e.id)).toEqual(["@shop/orders-api:GET:/api/orders/:id"]);
    const ids = map.nodes.map((n) => n.id);
    expect(ids).toContain("@shop/orders-api:OrdersService");
    expect(ids).toContain("@shop/inventory-svc:InventoryController");
    expect(ids).not.toContain("@shop/orders-api:OrdersResolver");
    expect(map.survey.entries.length).toBe(1);
  });
});

test("an injected dependency that is never called makes no node and no edge", () => {
  const root = repo({
    "src/a.controller.ts": `import { Controller, Get } from "@nestjs/common";
import { UsedService } from "./used.service";
import { UnusedService } from "./unused.service";
@Controller("a")
export class AController {
  constructor(private readonly used: UsedService, private readonly unused: UnusedService) {}
  @Get() list() { return this.used.all(); }
}`,
    "src/used.service.ts": `export class UsedService { all() { return []; } }`,
    "src/unused.service.ts": `export class UnusedService { other() { return 1; } }`,
  });
  const map = extractTypeScript(root);
  expect(validateDataMap(map)).toEqual([]);
  expect(map.nodes.map((n) => n.id)).toEqual(["app:AController", "app:UsedService"]);
  expect(map.edges).toEqual([{ from: "app:AController", to: "app:UsedService", kind: "sync", rule: "di-call" }]);
  expect(map.endpoints).toEqual([{ id: "app:GET:/a", method: "GET", path: "/a", entry: "app:AController", kind: "http", protocol: "nest", module: "app", file: "src/a.controller.ts", line: 7 }]);
});

test("the system name falls back to the directory name", () => {
  const root = repo({ "package.json": "{}", "src/x.ts": "export const x = 1;" });
  const map = extractTypeScript(root);
  expect(map.system).toBe(root.split("/").pop()!);
  expect(map.framework).toBeUndefined();
  expect(map.endpoints).toEqual([]);
});
