import type { Detector } from "../types.ts";
import { cap, siteDetector } from "./clients.ts";

/** Calls on a gRPC service stub from `ClientGrpc.getService('Service')` or an injected client factory. */
export const grpcDetector: Detector = siteDetector("grpc-out", (s) => {
  const { client: c, method: m } = s;
  if (c.lib !== "grpc-service" || m === "()" || m === "pipe" || m === "toString") return undefined;
  const service = c.name ?? s.recv?.getText() ?? "?";
  return { kind: "grpc-out", protocol: "grpc", method: m, target: `${service}/${cap(m)}`, resolved: !!c.resolved, rule: c.rule ?? "nest-grpc-client" };
});
