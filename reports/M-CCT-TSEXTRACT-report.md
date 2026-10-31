# M-CCT-TSEXTRACT report

Mission: Extract a data map from a TypeScript monorepo. Thread `e3978c35`. Actor: Ohm (robot). Status: all ten tasks done; the mission waits for Jim to test on a real repo and to answer Q-01 and Q-02.

## Outcome

- `ccircuit extract` reads a TypeScript repo with many modules and writes a data map that `ccircuit render` draws.
- `ccircuit survey` lists every entry point and exit point with file and line, as text or JSON.
- Module discovery does not depend on pnpm or Turborepo. It merges npm, yarn and pnpm workspaces, Lerna, Nx `project.json`, and any directory with a `package.json` or `tsconfig.json`.
- On nest-turbo-starter: 19 entries and 57 exits in 7 modules, in 0.7 s. All 12 HTTP routes carry the `/api` prefix. All 7 gRPC handlers are found. The gRPC calls from auth-service link to user-service and notification-service.
- Version 0.2.0 is released on GitHub with binaries for four targets. The Homebrew formula is not written, because `HOMEBREW_TAP_TOKEN` is not set.

Size: 17 commits, 2,960 lines in `src/extract/ts`, 6,823 lines across `src` and `tests` including fixtures, 7 new test files. `bun test`: 144 pass, 1 skip, 0 fail. Typecheck clean.

## How the work ran

1. I wrote the contract myself first (T-01): `docs/typescript-extractor.md` and `src/extract/ts/types.ts`. Every agent built against it.
2. One workflow of 11 agents in six phases:
   - Foundation, three agents in parallel: loader and symbol index; two fixture repos with ground truth in `EXPECTED.json`; renderer.
   - Detectors, two agents in parallel: entries and exits.
   - Assemble, one agent: data map, survey, CLI.
   - Review, three agents in parallel: completeness against source, unseen real repos, code correctness.
   - Fix, one agent.
   - Docs, one agent.
3. Each agent owned a disjoint set of files and committed only those, to `main`, with the task ID.

The subagents used about 837,000 tokens and 234 tool calls over 30 minutes of wall time for the resumed run.

## What went well

- Writing the contract before the fan out. The five parallel agents produced code that fitted together without an integration step. The types file grew by optional fields only.
- Ground truth fixtures. The fixture agent wrote `EXPECTED.json` before any detector existed. The detector agents tested against it, and corrected it in two places where the ground truth was wrong.
- The review on repos nobody had seen. The fixtures and nest-turbo-starter passed. amplication and immich exposed the real gaps: directories named `build` or `test` skipped at any depth (28 source files lost in amplication), Prisma clients generated to a local path, no Kysely detector (the whole immich data layer), dependencies and handlers inherited from base classes, and aliased decorators. All of these are fixed.
- Workflow resume. A container restart stopped the run in the Review phase. The resume replayed the six finished agents from cache and ran only the rest.

## What went less well

- TypeScript 7. The first install picked `typescript@latest`, which is 7.0, the native port with no JavaScript compiler API. I found it at the first typecheck and pinned 5.9.3. A later TypeScript upgrade must keep the 5.x API, or move to the API the native port offers.
- The fixtures broke the typecheck. They import packages that are not installed, and the root `tsconfig.json` included `tests`. Two agents reported it; the fix agent excluded `tests/fixtures`. I should have set the exclude in T-01.
- The README first said `brew install` works and listed no limits. I corrected both after Jim asked.
- The Review phase ran three agents with one round of fixes. A second review round would have checked the fixes on the same unseen repos.

## My view

The approach worked. The extractor reads the shape of a NestJS monorepo well, because Nest code declares its entry points and dependencies in decorators and constructors. Express and plain function code is harder: routes and clients pass through variables and helper functions, and a parser without a type checker follows only part of that.

The largest gap for real use is unresolved targets. In nest-turbo-starter all 10 HttpService URLs and all 11 Redis keys are method parameters, so they show as `?`. Following arguments from callers into a wrapper would fix most of these. That is the next step I would take.

The second gap is size. Mastodon showed that a board of every route is unreadable. A TypeScript repo of amplication's size gives the same problem. `--include` helps; grouping by module on the board helps more.

## Open

- Q-01: the exit kind for SMTP.
- Q-02: a `cli` entry kind.
- Known limits: README section "Known limits" and `docs/typescript-extractor.md`.
- `HOMEBREW_TAP_TOKEN` in the `release` environment, then rerun the release for `v0.2.0`.
