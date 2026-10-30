import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadProject, pnpmPackages } from "../src/extract/ts/project.ts";

const made: string[] = [];
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "ccircuit-ts-"));
  made.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const mods = (root: string) => loadProject(root).modules.map((m) => `${m.name}@${m.dir}:${m.source}`);

test("npm workspaces in object form expand globs, and skip rules apply", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "mono", workspaces: { packages: ["packages/**", "!packages/legacy"] } }),
    "packages/a/package.json": JSON.stringify({ name: "@x/a", main: "dist/index.js" }),
    "packages/a/src/index.ts": "export const A = 'a';",
    "packages/a/src/a.spec.ts": "test",
    "packages/a/src/types.d.ts": "declare const x: 1;",
    "packages/a/dist/index.ts": "export const built = 1;",
    "packages/a/test/helper.ts": "export {}",
    "packages/group/b/package.json": JSON.stringify({ name: "@x/b" }),
    "packages/group/b/src/b.ts": "import { A } from '@x/a';",
    "packages/legacy/package.json": JSON.stringify({ name: "legacy" }),
    "node_modules/dep/package.json": JSON.stringify({ name: "dep" }),
    "node_modules/dep/index.ts": "export {}",
    ".cache/x.ts": "export {}",
  });
  expect(mods(root)).toEqual(["@x/a@packages/a:workspace", "@x/b@packages/group/b:workspace", "mono@.:root"]);
  const p = loadProject(root);
  expect(p.files.map((f) => `${f.rel}=${f.module}`)).toEqual(["packages/a/src/index.ts=@x/a", "packages/group/b/src/b.ts=@x/b"]);
  expect(p.resolveImport("packages/group/b/src/b.ts", "@x/a")).toBe("packages/a/src/index.ts");
  expect(p.file("packages/a/src/index.ts")?.sf.statements.length).toBe(1);
});

test("pnpm-workspace.yaml lists packages by hand-parsed YAML", () => {
  expect(pnpmPackages("packages:\n  - 'apps/*'\n  - \"libs/*\" # comment\n  - tools\nonlyBuilt:\n  - x\n")).toEqual(["apps/*", "libs/*", "tools"]);
  expect(pnpmPackages("packages: [apps/*, 'libs/*']\n")).toEqual(["apps/*", "libs/*"]);
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "apps/api/package.json": JSON.stringify({ name: "api" }),
    "apps/api/src/main.ts": "export {}",
    "scripts/tool.ts": "export {}",
  });
  expect(mods(root)).toEqual(["api@apps/api:workspace", ".@.:root"]);
  expect(loadProject(root).file("scripts/tool.ts")?.module).toBe(".");
});

test("lerna.json packages are workspaces", () => {
  const root = repo({
    "lerna.json": JSON.stringify({ packages: ["modules/*"] }),
    "modules/m1/package.json": JSON.stringify({ name: "m1" }),
    "modules/m1/index.ts": "export {}",
  });
  expect(mods(root)).toEqual(["m1@modules/m1:workspace", ".@.:root"]);
});

test("Nx project.json files are modules, named by project.json when there is no package.json", () => {
  const root = repo({
    "nx.json": "{}",
    "apps/web/project.json": JSON.stringify({ name: "web" }),
    "apps/web/src/main.tsx": "export const App = () => <div/>;",
    "libs/shared/project.json": JSON.stringify({ name: "shared" }),
    "libs/shared/src/index.ts": "export {}",
  });
  expect(mods(root)).toEqual(["web@apps/web:nx", "shared@libs/shared:nx", ".@.:root"]);
  expect(loadProject(root).file("apps/web/src/main.tsx")?.module).toBe("web");
});

test("plain tsconfig and package.json dirs are modules when they hold .ts files, deepest wins", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "app" }),
    "server/tsconfig.json": "{}",
    "server/src/index.ts": "export {}",
    "server/worker/package.json": JSON.stringify({ name: "worker" }),
    "server/worker/job.ts": "export {}",
    "docs/package.json": JSON.stringify({ name: "docs" }),
    "docs/readme.md": "x",
    "root.ts": "export {}",
  });
  expect(mods(root)).toEqual(["server@server:manifest", "worker@server/worker:manifest", "app@.:root"]);
  const p = loadProject(root);
  expect(p.file("server/worker/job.ts")?.module).toBe("worker");
  expect(p.file("server/src/index.ts")?.module).toBe("server");
  expect(p.file("root.ts")?.module).toBe("app");
});

test("a repo with no manifest at all has one root module", () => {
  const root = repo({ "src/a.ts": "import { b } from './b.js';", "src/b.ts": "export const b = 1;", "src/lib/index.ts": "export {}" });
  expect(mods(root)).toEqual([".@.:root"]);
  const p = loadProject(root);
  expect(p.resolveImport("src/a.ts", "./b.js")).toBe("src/b.ts");
  expect(p.resolveImport("src/a.ts", "./b")).toBe("src/b.ts");
  expect(p.resolveImport("src/a.ts", "./lib")).toBe("src/lib/index.ts");
  expect(p.resolveImport("src/a.ts", "../../outside")).toBeUndefined();
  expect(p.resolveImport("src/a.ts", "lodash")).toBeUndefined();
});

test("tsconfig paths and baseUrl follow extends chains, with comments and trailing commas", () => {
  const root = repo({
    "tsconfig.base.json": `{
      // shared options
      "compilerOptions": { "paths": { "@lib/*": ["./libs/*/src"], "@cfg": ["./libs/cfg/src/index.ts"], }, },
    }`,
    "apps/api/tsconfig.json": `{ "extends": "../../tsconfig.base", "compilerOptions": { "outDir": "dist" } }`,
    "apps/api/src/main.ts": "export {}",
    "apps/api/src/config/app.config.ts": "export {}",
    "apps/web/tsconfig.json": `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "baseUrl": "." } }`,
    "apps/web/src/main.ts": "export {}",
    "apps/web/src/config/app.config.ts": "export {}",
    "libs/util/src/index.ts": "export {}",
    "libs/cfg/src/index.ts": "export {}",
  });
  const p = loadProject(root);
  expect(p.resolveImport("apps/api/src/main.ts", "@lib/util")).toBe("libs/util/src/index.ts");
  expect(p.resolveImport("apps/api/src/main.ts", "@cfg")).toBe("libs/cfg/src/index.ts");
  expect(p.resolveImport("apps/web/src/main.ts", "src/config/app.config")).toBe("apps/web/src/config/app.config.ts");
  expect(p.resolveImport("apps/web/src/main.ts", "@lib/util")).toBeUndefined();
  expect(p.resolveImport("apps/api/src/main.ts", "src/config/app.config")).toBe("apps/api/src/config/app.config.ts");
});

test("build, out, dist, test and tests are skipped at a module root and kept deeper down", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { outDir: "lib" } }),
    "build/x.ts": "export {}",
    "test/x.ts": "export {}",
    "lib/x.ts": "export {}",
    "src/core/build/build.controller.ts": "export {}",
    "src/core/out/a.ts": "export {}",
    "src/analytics/tests/index.ts": "export {}",
  });
  expect(loadProject(root).files.map((f) => f.rel)).toEqual(["src/analytics/tests/index.ts", "src/core/build/build.controller.ts", "src/core/out/a.ts"]);
});

test("discovery merges workspaces, Nx projects and manifests outside them, with unique module names", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "@x/core", workspaces: ["packages/*"] }),
    "packages/core/package.json": JSON.stringify({ name: "@x/core" }),
    "packages/core/index.ts": "export {}",
    "packages/core/sub/tsconfig.json": "{}",
    "packages/core/sub/a.ts": "export {}",
    "jobs/project.json": JSON.stringify({ name: "jobs" }),
    "jobs/main.ts": "import '@x/core';",
    "sample/one/package.json": JSON.stringify({ name: "starter" }),
    "sample/one/src/app.ts": "export {}",
    "sample/two/package.json": JSON.stringify({ name: "starter" }),
    "sample/two/src/app.ts": "export {}",
  });
  expect(mods(root)).toEqual(["jobs@jobs:nx", "@x/core@packages/core:workspace", "starter@sample/one:manifest", "starter (sample/two)@sample/two:manifest", "@x/core (root)@.:root"]);
  const p = loadProject(root);
  expect(p.file("sample/two/src/app.ts")?.module).toBe("starter (sample/two)");
  expect(p.resolveImport("jobs/main.ts", "@x/core")).toBe("packages/core/index.ts");
});

const EXAMPLE = "/home/user/examples/nest-turbo-starter";

test.skipIf(!existsSync(EXAMPLE))("the nest-turbo-starter example has six workspace modules and resolves its imports", () => {
  const p = loadProject(EXAMPLE);
  expect(p.modules.filter((m) => m.source === "workspace").map((m) => m.dir).sort()).toEqual([
    "apps/auth-service", "apps/notification-service", "apps/user-service", "libs/common", "libs/core", "libs/email-template",
  ]);
  const main = "apps/notification-service/src/main.ts";
  expect(p.file(main)?.module).toBe("notification-service");
  expect(p.resolveImport(main, "@app/core")).toBe("libs/core/src/index.ts");
  expect(p.resolveImport(main, "@app/common")).toBe("libs/common/src/index.ts");
  expect(p.resolveImport(main, "src/config/app.config")).toBe("apps/notification-service/src/config/app.config.ts");
  expect(p.files.some((f) => f.rel.includes("node_modules") || f.rel.endsWith(".spec.ts"))).toBe(false);
});
