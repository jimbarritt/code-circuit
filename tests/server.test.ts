import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { findCrossings } from "../src/layout.ts";
import { serveBoard } from "../src/server.ts";
import { importDataMap, openStore } from "../src/store.ts";
import { SKETCH_JSON } from "./helpers/sketch.ts";

const db = openStore();
importDataMap(db, JSON.parse(readFileSync(SKETCH_JSON, "utf8")));
const server = serveBoard(db);
afterAll(() => server.stop(true));
const get = (p: string) => fetch(new URL(p, server.url));

test("the page is served and loads nothing from the network", async () => {
  const r = await get("/");
  const html = await r.text();
  expect(r.headers.get("content-type")).toContain("text/html");
  expect(html).toContain('id="board"');
  expect(html.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
  expect(html).not.toMatch(/<link|@import|<script[^>]*src=/);
});

test("/api/board gives a board with no crossing", async () => {
  const b: any = await (await get("/api/board")).json();
  expect(b.nodes).toHaveLength(30);
  expect(findCrossings(b)).toEqual([]);
});

test("/api/reach answers from the store", async () => {
  const r: any = await (await get("/api/reach?endpoint=e_notif")).json();
  expect(r.nodes.sort()).toEqual(["c_notif", "m_notification", "x_pg"]);
  expect((await get("/api/reach?endpoint=nope")).status).toBe(404);
});

test("/api/reached-by lists the endpoints that reach a chip", async () => {
  const r: any = await (await get("/api/reached-by?id=m_status")).json();
  expect(r.endpoints).toEqual(["e_statuses", "e_inbox"]);
});

test("/api/seams counts the endpoints per chip", async () => {
  const c: any = await (await get("/api/seams")).json();
  expect(c.x_pg).toBe(6);
});

test("a data map change in the store shows in the next query, so no copy is cached", async () => {
  db.exec("DELETE FROM edges WHERE src = 'c_notif'");
  const r: any = await (await get("/api/reach?endpoint=e_notif")).json();
  expect(r.nodes).toEqual(["c_notif"]);
});
