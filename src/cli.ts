const USAGE = `cc: draw a service as a circuit board

Usage:
  cc render <data-map.json> [--port <n>]   Serve the board for a data map
  cc extract <rails-checkout> [options]    Write a data map for a Rails app to stdout
  cc import <data-map.json> <store.db>     Load a data map into a SQLite store
  cc export <store.db>                     Write the data map held in a store to stdout
  cc --help                                Show this text
`;

const [command] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h" || command === "help") {
  process.stdout.write(USAGE);
  process.exit(command ? 0 : 1);
}

process.stderr.write(`cc: unknown command "${command}"\n\n${USAGE}`);
process.exit(1);
