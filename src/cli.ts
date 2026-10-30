import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";
import { assertDataMap } from "./datamap.ts";
import { extractRails } from "./extract/rails.ts";
import { extractTypeScript } from "./extract/ts/assemble.ts";
import { formatSurvey, railsSurvey, surveyJson } from "./extract/ts/survey.ts";
import { serveBoard } from "./server.ts";
import { exportDataMap, importDataMap, openStore } from "./store.ts";

const USAGE = `ccircuit: draw a service as a circuit board

Usage:
  ccircuit render <data-map.json> [--port <n>]   Serve the board for a data map
  ccircuit extract <dir> [--lang ts|rails] [--include "METHOD target"]...
                                                 Write a data map for a TypeScript repo or a
                                                 Rails app to stdout
  ccircuit survey <dir> [--json] [--lang ts|rails]
                                                 List every entry point and exit point
  ccircuit import <data-map.json> <store.db>     Load a data map into a SQLite store
  ccircuit export <store.db>                     Write the data map held in a store to stdout
  ccircuit --version                             Show the version
  ccircuit --help                                Show this text
`;

const fail = (msg: string): never => {
  process.stderr.write(`ccircuit: ${msg}\n`);
  process.exit(1);
};

type Lang = "ts" | "rails";

function hasTs(dir: string, depth = 0): boolean {
  if (depth > 6) return false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) if (e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) return true;
  return entries.some((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && hasTs(join(dir, e.name), depth + 1));
}

function detectLang(dir: string): Lang | undefined {
  if (existsSync(join(dir, "config/routes.rb")) && existsSync(join(dir, "Gemfile"))) return "rails";
  if (existsSync(join(dir, "package.json")) || existsSync(join(dir, "tsconfig.json")) || hasTs(dir)) return "ts";
  return existsSync(join(dir, "config/routes.rb")) ? "rails" : undefined;
}

/** Splits `<dir> [flags]` and resolves the language. */
function parseArgs(args: string[], usage: string) {
  const [dir, ...rest] = args;
  if (!dir || !existsSync(dir)) fail(usage);
  const include: string[] = [];
  let lang: string | undefined, json = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--include") include.push(rest[++i] ?? "");
    else if (rest[i] === "--lang") lang = rest[++i];
    else if (rest[i] === "--json") json = true;
    else fail(`unknown option "${rest[i]}"\n${usage}`);
  }
  if (lang && lang !== "ts" && lang !== "rails") fail(`unknown language "${lang}": use ts or rails`);
  const found = (lang as Lang | undefined) ?? detectLang(dir!);
  if (!found) fail(`cannot tell the language of ${dir}: use --lang ts or --lang rails`);
  return { dir: dir!, lang: found!, include: include.length ? include : undefined, json };
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case undefined:
    process.stdout.write(USAGE);
    process.exit(1);
  case "--version":
  case "-v":
    process.stdout.write(`ccircuit ${pkg.version}\n`);
    break;
  case "--help":
  case "-h":
  case "help":
    process.stdout.write(USAGE);
    break;
  case "render": {
    const [file, ...rest] = args;
    if (!file || !existsSync(file)) fail("usage: ccircuit render <data-map.json> [--port <n>]");
    const pi = rest.indexOf("--port");
    const port = pi >= 0 ? Number(rest[pi + 1]) : 0;
    const db = openStore();
    importDataMap(db, JSON.parse(readFileSync(file, "utf8")));
    const server = serveBoard(db, { port });
    process.stdout.write(`${server.url}\n`);
    break;
  }
  case "extract": {
    const { dir, lang, include } = parseArgs(args, 'usage: ccircuit extract <dir> [--lang ts|rails] [--include "METHOD target"]...');
    const map = lang === "rails" ? extractRails(dir, { include }) : extractTypeScript(dir, { include });
    process.stdout.write(JSON.stringify(assertDataMap(map), null, 2) + "\n");
    break;
  }
  case "survey": {
    const { dir, lang, json } = parseArgs(args, "usage: ccircuit survey <dir> [--json] [--lang ts|rails]");
    const survey = lang === "rails" ? railsSurvey(extractRails(dir)) : extractTypeScript(dir).survey;
    process.stdout.write(json ? surveyJson(survey) : formatSurvey(survey));
    break;
  }
  case "import": {
    const [json, dbPath] = args;
    if (!json || !dbPath) fail("usage: ccircuit import <data-map.json> <store.db>");
    const db = openStore(dbPath);
    importDataMap(db, JSON.parse(readFileSync(json, "utf8")));
    db.close();
    break;
  }
  case "export": {
    const [dbPath] = args;
    if (!dbPath || !existsSync(dbPath)) fail("usage: ccircuit export <store.db>");
    const db = openStore(dbPath);
    process.stdout.write(JSON.stringify(exportDataMap(db), null, 2) + "\n");
    db.close();
    break;
  }
  default:
    fail(`unknown command "${command}"\n\n${USAGE}`);
}
