import { expect, test } from "bun:test";

const run = (...args: string[]) =>
  Bun.spawnSync(["bun", "run", "src/cli.ts", ...args], { cwd: import.meta.dir + "/.." });

test("--help lists render and extract and exits 0", () => {
  const r = run("--help");
  const out = r.stdout.toString();
  expect(r.exitCode).toBe(0);
  expect(out).toContain("cc render");
  expect(out).toContain("cc extract");
});

test("an unknown command exits 1", () => {
  expect(run("nope").exitCode).toBe(1);
});
