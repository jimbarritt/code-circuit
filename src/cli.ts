import { readFileSync, existsSync } from "node:fs";
import { assertDataMap } from "./datamap.ts";
import { extractRails } from "./extract/rails.ts";
import { serveBoard } from "./server.ts";
import { exportDataMap, importDataMap, openStore } from "./store.ts";

const USAGE = `cc: draw a service as a circuit board

Usage:
  cc render <data-map.json> [--port <n>]   Serve the board for a data map
  cc extract <rails-checkout> [--include "METHOD /path"]...
                                           Write a data map for a Rails app to stdout
  cc import <data-map.json> <store.db>     Load a data map into a SQLite store
  cc export <store.db>                     Write the data map held in a store to stdout
  cc --help                                Show this text
`;

const fail = (msg: string): never => {
  process.stderr.write(`cc: ${msg}\n`);
  process.exit(1);
};

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case undefined:
    process.stdout.write(USAGE);
    process.exit(1);
  case "--help":
  case "-h":
  case "help":
    process.stdout.write(USAGE);
    break;
  case "render": {
    const [file, ...rest] = args;
    if (!file || !existsSync(file)) fail("usage: cc render <data-map.json> [--port <n>]");
    const pi = rest.indexOf("--port");
    const port = pi >= 0 ? Number(rest[pi + 1]) : 0;
    const db = openStore();
    importDataMap(db, JSON.parse(readFileSync(file, "utf8")));
    const server = serveBoard(db, { port });
    process.stdout.write(`${server.url}\n`);
    break;
  }
  case "extract": {
    const [dir, ...rest] = args;
    if (!dir || !existsSync(dir)) fail('usage: cc extract <rails-checkout> [--include "METHOD /path"]...');
    const include: string[] = [];
    for (let i = 0; i < rest.length; i++) if (rest[i] === "--include") include.push(rest[++i]);
    const map = extractRails(dir, { include: include.length ? include : undefined });
    process.stdout.write(JSON.stringify(assertDataMap(map), null, 2) + "\n");
    break;
  }
  case "import": {
    const [json, dbPath] = args;
    if (!json || !dbPath) fail("usage: cc import <data-map.json> <store.db>");
    const db = openStore(dbPath);
    importDataMap(db, JSON.parse(readFileSync(json, "utf8")));
    db.close();
    break;
  }
  case "export": {
    const [dbPath] = args;
    if (!dbPath || !existsSync(dbPath)) fail("usage: cc export <store.db>");
    const db = openStore(dbPath);
    process.stdout.write(JSON.stringify(exportDataMap(db), null, 2) + "\n");
    db.close();
    break;
  }
  default:
    fail(`unknown command "${command}"\n\n${USAGE}`);
}
