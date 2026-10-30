import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SKETCH_JSON, runSketchModel } from "./helpers/sketch.ts";

test("the committed data map is the sketch's own model, byte for byte", () => {
  expect(readFileSync(SKETCH_JSON, "utf8")).toBe(runSketchModel() + "\n");
});

test("the data map holds the six endpoints, four externals, 30 nodes and 42 edges", () => {
  const m = JSON.parse(readFileSync(SKETCH_JSON, "utf8"));
  expect(m.endpoints).toHaveLength(6);
  expect(m.externals).toHaveLength(4);
  expect(m.nodes).toHaveLength(30);
  expect(m.edges.length).toBe(42);
});
