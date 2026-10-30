import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateDataMap } from "../src/datamap.ts";
import { SKETCH_JSON } from "./helpers/sketch.ts";

const sketch = () => JSON.parse(readFileSync(SKETCH_JSON, "utf8"));

test("the sketch data map validates", () => {
  expect(validateDataMap(sketch())).toEqual([]);
});

test("a missing top-level list is rejected", () => {
  const m = sketch();
  delete m.externals;
  expect(validateDataMap(m).join()).toContain("externals");
});

test("an edge kind outside sync, async and io is rejected", () => {
  const m = sketch();
  m.edges[0].kind = "weird";
  expect(validateDataMap(m).length).toBeGreaterThan(0);
});

test("an async edge without a queue is rejected", () => {
  const m = sketch();
  const e = m.edges.find((x: any) => x.kind === "async");
  delete e.queue;
  expect(validateDataMap(m).join()).toContain("queue");
});

test("an edge to an unknown id is rejected", () => {
  const m = sketch();
  m.edges[0].to = "nope";
  expect(validateDataMap(m).join()).toContain("unknown");
});

test("extra fields are accepted, so fields can be added", () => {
  const m = sketch();
  m.nodes[0].owner = "team-a";
  m.edges[0].rule = "controller-call";
  expect(validateDataMap(m)).toEqual([]);
});
