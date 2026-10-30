import { expect, test } from "bun:test";
import { validateDataMap } from "../src/datamap.ts";
import { extractRails } from "../src/extract/rails.ts";
import { parseRoutes, routeKey } from "../src/extract/routes.ts";
import { methodBodies, methodWithHelpers, stripRuby } from "../src/extract/ruby.ts";
import { findCrossings, layoutBoard } from "../src/layout.ts";
import { reachFrom } from "../src/reach.ts";
import { importDataMap, openStore } from "../src/store.ts";

const FIXTURE = new URL("./fixtures/rails-app", import.meta.url).pathname;
const map = extractRails(FIXTURE);
const edge = (from: string, to: string) => map.edges.find((e) => e.from === from && e.to === to);

test("the extracted data map validates against the schema", () => {
  expect(validateDataMap(map)).toEqual([]);
});

test("routes come out of namespace, scope, resources, resource, member and collection", () => {
  const got = parseRoutes(FIXTURE).map((r) => `${r.method} ${r.path} ${r.controller}#${r.action}`);
  expect(got).toContain("POST /api/v1/statuses api/v1/statuses#create");
  expect(got).toContain("POST /api/v1/statuses/:status_id/favourite api/v1/statuses/favourites#create");
  expect(got).toContain("POST /api/v1/statuses/:status_id/unfavourite api/v1/statuses/favourites#destroy");
  expect(got).toContain("GET /api/v1/timelines/home api/v1/timelines/home#show");
  expect(got).toContain("POST /api/v1/accounts/:id/follow api/v1/accounts#follow");
  expect(got).toContain("POST /api/v1/notifications/clear api/v1/notifications#clear");
  expect(got).toContain("POST /inbox activitypub/inboxes#create");
  expect(got).toContain("GET / home#index");
});

test("an endpoint exists for each route whose controller defines the action", () => {
  const ids = map.endpoints.map((e) => e.id);
  expect(ids).toContain("POST /api/v1/statuses");
  expect(ids).toContain("POST /inbox");
  expect(ids).not.toContain("GET /"); // home_controller.rb does not exist
  expect(ids).not.toContain("PATCH /api/v1/statuses/:id"); // only: excludes it
});

test("--include keeps the endpoints named, ignoring parameter names", () => {
  const m = extractRails(FIXTURE, { include: ["POST /api/v1/statuses/:id/favourite"] });
  expect(m.endpoints.map((e) => e.id)).toEqual(["POST /api/v1/statuses/:status_id/favourite"]);
  expect(m.nodes.map((n) => n.id)).toContain("FavouriteService");
  expect(m.nodes.map((n) => n.id)).not.toContain("PostStatusService");
});

test("a controller action calls the services it names, through its own helper methods too", () => {
  expect(edge("Api::V1::StatusesController#create", "PostStatusService")?.kind).toBe("sync");
  expect(edge("Api::V1::Timelines::HomeController#show", "HomeFeed")?.rule).toBe("controller-uses-model");
  expect(edge("Api::V1::Statuses::FavouritesController#destroy", "FavouriteService")).toBeUndefined();
});

test("a perform_async call is an async edge that names the queue of the worker", () => {
  expect(edge("PostStatusService", "DistributionWorker")).toMatchObject({ kind: "async", queue: "default", rule: "sidekiq-enqueue" });
  expect(edge("PostStatusService", "ActivityPub::DistributionWorker")).toMatchObject({ kind: "async", queue: "push" });
  expect(edge("PostStatusService", "LinkCrawlWorker")).toMatchObject({ kind: "async", queue: "pull" });
  expect(edge("ActivityPub::InboxesController#create", "ActivityPub::ProcessingWorker")).toMatchObject({ kind: "async", queue: "ingress" });
  expect(edge("ActivityPub::DistributionWorker", "ActivityPub::DeliveryWorker")?.queue).toBe("push");
});

test("worker nodes carry their queue; a worker without sidekiq_options is on default", () => {
  const q = (id: string) => map.nodes.find((n) => n.id === id)?.queue;
  expect(q("LinkCrawlWorker")).toBe("pull");
  expect(q("ActivityPub::DeliveryWorker")).toBe("push");
  expect(q("DistributionWorker")).toBe("default");
});

test("models reach PostgreSQL; Redis, HTTP and Web Push come from the code that calls them", () => {
  expect(edge("Status", "postgresql")).toMatchObject({ kind: "io", rule: "activerecord-model" });
  expect(edge("HomeFeed", "postgresql")).toBeUndefined();
  expect(edge("FeedManager", "redis")?.rule).toBe("redis-call");
  expect(edge("Request", "remote-http")?.rule).toBe("http-client");
  expect(edge("NotifyService", "web-push")?.rule).toBe("webpush-call");
});

test("every edge names the rule that produced it", () => {
  expect(map.edges.length).toBeGreaterThan(30);
  for (const e of map.edges) expect(typeof e.rule).toBe("string");
});

test("a model follows adapters but not services", () => {
  expect(edge("HomeFeed", "FeedManager")?.rule).toBe("model-uses-adapter");
  expect(map.edges.some((e) => e.from === "Status" && e.kind === "sync")).toBe(false);
});

test("the extracted map imports, answers reachability and lays out with no crossing", () => {
  const db = openStore();
  importDataMap(db, map);
  const r = reachFrom(db, "POST /api/v1/statuses")!;
  for (const id of ["PostStatusService", "DistributionWorker", "FanOutOnWriteWorker", "FeedManager", "redis", "postgresql"]) expect(r.nodes).toContain(id);
  expect(findCrossings(layoutBoard(map))).toEqual([]);
});

test("extraction is deterministic", () => {
  expect(JSON.stringify(extractRails(FIXTURE))).toBe(JSON.stringify(map));
});

test("stripRuby drops comments and string contents but keeps interpolated code", () => {
  const code = stripRuby(`x = "Foo #{Bar.baz} 'q'" # Baz\ny = 'Qux'`);
  expect(code).toContain("Bar.baz");
  expect(code).not.toContain("Foo");
  expect(code).not.toContain("Baz");
  expect(code).not.toContain("Qux");
});

test("methodBodies finds a def by indentation and methodWithHelpers adds local calls", () => {
  const src = `class A\n  def a\n    b\n  end\n\n  private\n\n  def b\n    Foo.new\n  end\n\n  def c\n    Bar\n  end\nend\n`;
  expect([...methodBodies(src).keys()]).toEqual(["a", "b", "c"]);
  const t = methodWithHelpers(src, "a")!;
  expect(t).toContain("Foo");
  expect(t).not.toContain("Bar");
});

test("routeKey treats parameter names as equal", () => {
  expect(routeKey("post", "/a/:status_id/b")).toBe(routeKey("POST", "/a/:id/b"));
});

test("stripRuby keeps the braces around an interpolation when it keeps strings", () => {
  expect(stripRuby(`x = "a #{b} c"`, true)).toBe(`x = "a #{b} c"`);
});

test("a superclass in a class declaration is not a call", () => {
  expect(map.nodes.some((n) => n.id === "BaseService")).toBe(false);
  expect(map.edges.some((e) => e.to === "BaseService" || e.to === "ApplicationRecord")).toBe(false);
});
