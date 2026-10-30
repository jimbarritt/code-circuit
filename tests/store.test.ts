import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { exportDataMap, importDataMap, openStore } from "../src/store.ts";
import { SKETCH_JSON } from "./helpers/sketch.ts";

const text = readFileSync(SKETCH_JSON, "utf8");

test("import then export gives back the sketch JSON byte for byte", () => {
  const db = openStore();
  importDataMap(db, JSON.parse(text));
  expect(JSON.stringify(exportDataMap(db), null, 2) + "\n").toBe(text);
});

test("fields the store does not know survive the round trip", () => {
  const m = JSON.parse(text);
  m.nodes[0].owner = "team-a";
  m.edges[3].rule = "service-call";
  m.edges[3].weight = 2;
  m.version = 3;
  const db = openStore();
  importDataMap(db, m);
  expect(exportDataMap(db)).toEqual(m);
});

test("importing again replaces the earlier contents", () => {
  const db = openStore();
  importDataMap(db, JSON.parse(text));
  const m = JSON.parse(text);
  m.nodes = m.nodes.slice(0, 1);
  m.edges = [];
  m.endpoints = [];
  m.externals = [];
  importDataMap(db, m);
  expect(exportDataMap(db).nodes).toHaveLength(1);
});

test("an invalid data map is refused", () => {
  expect(() => importDataMap(openStore(), { nodes: [] })).toThrow("invalid data map");
});

test("cc import and cc export round-trip the sketch through a store file", () => {
  const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
  const cwd = import.meta.dir + "/..";
  const run = (...a: string[]) => Bun.spawnSync(["bun", "run", "src/cli.ts", ...a], { cwd });
  expect(run("import", SKETCH_JSON, dir + "/s.db").exitCode).toBe(0);
  expect(run("export", dir + "/s.db").stdout.toString()).toBe(text);
});
