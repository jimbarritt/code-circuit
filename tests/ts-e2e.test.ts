import { expect, test } from "bun:test";
import { validateDataMap } from "../src/datamap.ts";
import { extractTypeScript } from "../src/extract/ts/assemble.ts";
import { formatSurvey } from "../src/extract/ts/survey.ts";

// Set CC_NEST to a nest-turbo-starter checkout to run the extractor against it.
const NEST = process.env.CC_NEST;

test.skipIf(!NEST)("nest-turbo-starter: gRPC links, /api endpoints, MikroORM, Redis and SES", () => {
  const map = extractTypeScript(NEST!);
  expect(validateDataMap(map)).toEqual([]);
  expect(map.framework).toBe("NestJS");
  expect(map.survey.modules).toEqual(expect.arrayContaining(["auth-service", "user-service", "notification-service", "@app/core"]));

  const grpc = map.edges.filter((e) => e.rule === "grpc-call");
  expect(grpc).toContainEqual({ from: "auth-service:AuthService", to: "user-service:UserConsumer", kind: "sync", rule: "grpc-call" });
  expect(grpc).toContainEqual({ from: "auth-service:AuthService", to: "notification-service:SendMailConsumer", kind: "sync", rule: "grpc-call" });

  const http = map.endpoints.filter((e) => e.kind === "http");
  expect(http.length).toBeGreaterThan(5);
  for (const e of http) expect(e.path.startsWith("/api")).toBe(true);
  expect(http.map((e) => `${e.method} ${e.path}`)).toEqual(expect.arrayContaining(["POST /api/login", "POST /api/sign-up", "GET /api/info"]));

  const ext = map.externals.map((x) => x.id);
  for (const id of ["database:mikro-orm", "cache:ioredis", "cloud:aws-ses"]) expect(ext).toContain(id);
  expect(map.edges).toContainEqual({ from: "user-service:UserService", to: "database:mikro-orm", kind: "io", rule: "mikro-orm-repository" });
  expect(map.edges.some((e) => e.to === "cache:ioredis")).toBe(true);
  expect(map.edges.some((e) => e.to === "cloud:aws-ses")).toBe(true);

  const text = formatSurvey(map.survey);
  expect(text).toMatch(/GRPC +UserService\/GetUser +UserConsumer\.getUser/);
  expect(text).toMatch(/total: \d+ entries, \d+ exits in \d+ modules\n$/);
});
