import { readFileSync } from "node:fs";

export const SKETCH_HTML = new URL("../../src/html/sketch/mastodon-circuit-board.html", import.meta.url).pathname;
export const SKETCH_JSON = new URL("../../src/html/sketch/mastodon-circuit-board.json", import.meta.url).pathname;

// A stand-in for any DOM object: every property read and call returns another stand-in.
function sink(): any {
  const f: any = function () {};
  return new Proxy(f, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => "" : k === "length" ? 0 : sink()),
    apply: () => sink(),
    set: () => true,
  });
}

/** Runs the sketch's own script against a stub DOM and returns what it writes to #data-json. */
export function runSketchModel(): string {
  const html = readFileSync(SKETCH_HTML, "utf8");
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  let captured = "";
  const dataEl = new Proxy({}, { set: (_t, k, v) => { if (k === "textContent") captured = v; return true; }, get: () => sink() });
  const document = {
    getElementById: (id: string) => (id === "data-json" ? dataEl : sink()),
    createElementNS: () => sink(),
    createElement: () => sink(),
  };
  new Function("document", script)(document);
  return captured;
}
