# Initial bootstrap

`ccircuit` went from a seeded repo to a released binary that reads Rails apps and TypeScript monorepos in two missions. Release work ran between them, on 30 and 31 October 2026. All times are GMT, from the git log.

A mission is a unit of work in the tsk ledger, with a purpose, objectives and numbered tasks. Claude Code sessions in the cloud did the work, and Jim directed them. Each session ran as a robot actor named Ohm.

The second mission used ultracode. In ultracode one lead session writes the plan, then runs a team of subagents through a workflow. A subagent is a separate Claude session that does one task and returns its result to the lead.

## Numbers

| | M-CCT-BOOT | Release work | M-CCT-TSEXTRACT |
|---|---|---|---|
| Wall time | 45 minutes | 35 minutes | 1 hour 15 minutes to the first full result, then follow-ups the next morning |
| Tasks | 15 | none in the ledger | 11 |
| Agents | one session | one session | 1 lead and 11 subagents |
| Tests at the end | 57 | 58 | 144 |
| Result | Rails extractor and board | Homebrew tap, MIT licence | TypeScript extractor and survey |

The TypeScript mission added 114 files and 9,035 lines to the repo in 19 commits. The extractor is 30 files and 2,967 lines in `src/extract/ts`. Its tests are 1,302 lines in 7 files, and run against 40 fixture source files. `docs/typescript-rules.md` lists 81 detector rules.

## Part 1: the bootstrap mission

Jim seeded the repo at 19:19 on 30 October with a README and a hand-drawn board of six Mastodon endpoints. The mission M-CCT-BOOT asked for a product that draws such a board from source code.

This part is based on the mission report, [docs/report.md](../report.md), and on the git log. A later session replaced the session that ran the mission, so its prompts are not available.

The session scaffolded the binary at 19:50. Between 19:51 and 19:52 it committed the data map lifted from the sketch, a JSON schema, a SQLite store and reachability queries. Layout and the board page followed by 19:57, and the Rails extractor was committed at 20:00.

The first run on Mastodon found 0 endpoints. The Ruby scanner dropped the closing brace of `"#{...}"`, so every route after the first such line was lost. A fix followed at 20:01. The first layout then put 109 of 170 chips in the overflow column. A change from longest path to shortest path depth cut that to 7. The session wrote the mission report at 20:04.

The report's main result: the extracted Mastodon board for six endpoints has 169 chips. The hand-drawn sketch has 30. The extractor counts every constant in a file as a call, so it adds edges for calls that never run.

## Part 2: release work

Jim asked for a Homebrew tap like the one for tsk. tsk is a Rust binary, and `ccircuit` is a bun binary.

The session read the tsk release workflow and the existing tap. Before it wrote any code it asked Jim two questions:

- The binary was named `cc`, which is the C compiler on every Mac and Linux machine. Jim chose `ccircuit`.
- Releases run on a version bump on `main`, as in tsk.

The workflow builds with `bun build --compile` for four targets. The macOS binaries build on macOS runners so that bun signs them. Apple silicon does not run an unsigned binary. Jim then asked for the MIT licence.

Two faults appeared later. The formula job needs a token with write access to the tap repo. The token was not set, so the first two releases had binaries and no formula. Jim created the token from a step by step guide.

The next manual run built the binaries again and skipped the formula job. On a manual run the release job is skipped. GitHub then skips every job that depends on it, unless the job's condition uses `always()`. After that fix, `brew install jimbarritt/tap/ccircuit` worked.

## Part 3: the TypeScript mission with ultracode

### How Jim prompted the TypeScript mission

Jim set up the mission in three messages.

1. Jim asked whether `ccircuit` would parse a TypeScript mini repo. The answer was no: the extractor read Rails only.
2. Jim said the target was a TypeScript monorepo, and asked for a new mission and an open source example project. The session proposed three candidates. Jim picked `typv/nest-turbo-starter`: MIT, three NestJS services, gRPC, MikroORM and Redis.
3. Jim switched the session to a larger model and gave the objective in one message:
   - Run against a real world TypeScript repo.
   - Support many modules, with no dependency on pnpm or Turborepo.
   - Survey every entry point and exit point: APIs, database calls, and Kafka messages in and out.
   - "You plan it, then enter ultracode mode and fire up a team to complete the tasks. You are in charge. Build it, and I will test against a real repo."

That third message was the whole brief for the build. Jim sent no further message until the build was done.

### Planning by the lead

Before any subagent started, the lead session did this work:

- It recorded the mission in the ledger: a purpose, 3 objectives, 4 constraints and 10 tasks.
- It wrote the contract as task T-01. The contract is a design note, `docs/typescript-extractor.md`, and a file of shared types, `src/extract/ts/types.ts`. These define a project, the symbol index, a detector and a finding. A finding is one entry point or exit point, with its file and line. Every agent built against these files.
- It found that `typescript@latest` is version 7, the native port, which has no JavaScript compiler API. It pinned version 5.9.3.

### The team of subagents

The workflow ran 11 subagents in six phases. Agents in one phase ran in parallel. Each agent owned a set of files and committed only those to `main`. Each commit message starts with its task ID.

| Phase | Agents | Role |
|---|---|---|
| Foundation | 3 | Project loader and symbol index. Two fixture repos with the expected findings written down as ground truth. The board renderer for new endpoint and chip kinds and for modules. |
| Detectors | 2 | Entry detectors. Exit detectors. |
| Assemble | 1 | The data map, `ccircuit survey`, language detection and the end to end test. |
| Review | 3 | Completeness against the source. Robustness on repos that no agent built against. Code correctness. |
| Fix | 1 | Reproduce each review finding, then fix it with a test. |
| Docs | 1 | README, the rules table, the example outputs, and the version bump to 0.2.0. |

The fixture agent wrote the expected findings before any detector existed. The detector agents tested against them, and corrected them in two places where the ground truth was wrong.

### Timeline

| Time | Event |
|---|---|
| 22:23 | The lead commits the contract and the TypeScript pin. |
| 22:30 to 22:37 | Foundation: loader and index, fixtures, renderer. |
| 22:44 to 22:49 | Detectors: entries, then exits. |
| 22:54 | Assemble: data map, survey and CLI. |
| after 22:54 | The cloud container restarts during Review. The workflow stops. |
| restart | The lead resumes the workflow from its journal. The six finished agents return their cached results, and only Review, Fix and Docs run. |
| 23:08 to 23:20 | Fix: six commits. |
| 23:25 | Docs: version 0.2.0 pushed, which starts the release. |

The time from the brief to the release commit was about 1 hour 15 minutes. The resumed workflow ran for 30 minutes. Its agents used about 837,000 tokens and 234 tool calls.

### Review findings

The three reviewers reported 37 findings: 7 high, 16 medium and 14 low. The reviewer of unseen repos ran the extractor on amplication, immich and the NestJS repo. These repos showed faults that the fixtures and the example did not:

- Directories named `build`, `out` or `test` were skipped at any depth. In amplication that lost 28 source files of one feature.
- Prisma clients generated to a local path were missed.
- There was no Kysely detector, and Kysely is the whole data layer of immich.
- Dependencies and handlers inherited from a base class were missed.
- Decorators imported under another name were missed.

The fix agent reproduced each finding before it changed code. It fixed every high finding and all but one medium finding. It left eight items open, each with a reason.

### After the build

Jim asked four questions the next morning. Two of them found gaps in the lead's work:

- The README listed no known limits, and it said `brew install` worked before it did.
- The ledger had no mission report.

The lead fixed both. The report is in the ledger as `reports/M-CCT-TSEXTRACT-report.md`. Jim then answered the first open question: an SMTP exit gets its own kind, `smtp-out`, added as task T-11.

## Practices that worked

- A contract written before the parallel work. Five agents worked in parallel on separate files, and their code fitted together with no integration step. The types file grew by optional fields only.
- Ground truth written before the detectors. The expected findings gave the detector agents a test that they did not write.
- Review on repos that no agent built against. The most important faults appeared only there.
- Resume after a restart. The workflow journal let the lead continue without running the finished agents again.

## Changes for the next mission

- Exclude fixtures from the typecheck at the start. The fixtures import packages that are not installed, and they broke the typecheck until the fix agent excluded them.
- Run a second review round on the same unseen repos after the fixes.
- Check the README against the facts at release time, as well as against the code.
