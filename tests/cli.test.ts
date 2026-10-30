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
