/** Small helpers for reading Ruby source without a parser. */

/**
 * Removes comments. Unless keepStrings is set, it also empties string literals,
 * but keeps the code inside "#{...}" so that constants in interpolation stay visible.
 * Line breaks and indentation are kept, so line-based rules still work.
 */
export function stripRuby(src: string, keepStrings = false): string {
  let out = "";
  let i = 0;
  const n = src.length;
  // each entry is a brace depth for an open interpolation
  const interp: number[] = [];
  let mode: "code" | "sq" | "dq" = "code";
  const line = (c: string) => (c === "\n" ? "\n" : "");
  while (i < n) {
    const c = src[i];
    if (mode === "code") {
      if (c === "#") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "'") { mode = "sq"; out += keepStrings ? c : ""; i++; continue; }
      if (c === '"') { mode = "dq"; out += keepStrings ? c : ""; i++; continue; }
      if (interp.length) {
        if (c === "{") interp[interp.length - 1]++;
        if (c === "}") {
          if (interp[interp.length - 1] === 0) { interp.pop(); mode = "dq"; i++; continue; }
          interp[interp.length - 1]--;
        }
      }
      out += c; i++;
    } else if (mode === "sq") {
      if (c === "\\") { out += keepStrings ? src.slice(i, i + 2) : line(src[i + 1] ?? ""); i += 2; continue; }
      if (c === "'") { mode = "code"; out += keepStrings ? c : ""; i++; continue; }
      out += keepStrings ? c : line(c); i++;
    } else {
      if (c === "\\") { out += keepStrings ? src.slice(i, i + 2) : line(src[i + 1] ?? ""); i += 2; continue; }
      if (c === "#" && src[i + 1] === "{") {
        interp.push(0); mode = "code"; out += keepStrings ? "#{" : " "; i += 2; continue;
      }
      if (c === '"') { mode = "code"; out += keepStrings ? c : ""; i++; continue; }
      out += keepStrings ? c : line(c); i++;
    }
  }
  return out;
}

/** Method bodies by name, found by indentation: a def ends at the next `end` at the same indent. */
export function methodBodies(code: string): Map<string, string> {
  const lines = code.split("\n");
  const found = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)(.*)$/);
    if (!m) continue;
    const [, indent, name, rest] = m;
    const endless = rest.match(/^(?:\([^)]*\))?\s*=\s*(\S.*)$/);
    if (endless) { found.set(name, endless[1]); continue; }
    if (/\bend\s*$/.test(rest)) { found.set(name, rest); continue; }
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^${indent}end\\b`).test(lines[j])) body.push(lines[j++]);
    found.set(name, body.join("\n"));
  }
  return found;
}

/** The body of a method plus the bodies of the methods of the same file that it calls, directly or not. */
export function methodWithHelpers(code: string, name: string): string | null {
  const all = methodBodies(code);
  if (!all.has(name)) return null;
  const seen = new Set([name]);
  const queue = [name];
  let text = "";
  while (queue.length) {
    const cur = queue.shift()!;
    const body = all.get(cur)!;
    text += body + "\n";
    for (const id of body.match(/\b[a-z_]\w*[?!]?/g) ?? []) {
      if (all.has(id) && !seen.has(id)) { seen.add(id); queue.push(id); }
    }
  }
  return text;
}

/** Full names of the classes and modules a file declares, with nesting by indentation. */
export function declaredNames(code: string): string[] {
  const names: string[] = [];
  const stack: { indent: number; name: string }[] = [];
  for (const line of code.split("\n")) {
    const m = line.match(/^(\s*)(?:class|module)\s+((?:::)?[A-Z][\w:]*)/);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].name + "::" : "";
    const full = parent + m[2].replace(/^::/, "");
    stack.push({ indent, name: full });
    names.push(full);
  }
  return names;
}
