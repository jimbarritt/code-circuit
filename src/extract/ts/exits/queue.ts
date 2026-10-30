import type { Detector } from "../types.ts";
import { siteDetector } from "./clients.ts";

/** BullMQ and Bull: `queue.add` on a queue from `new Queue('name')` or `@InjectQueue('name')`. */
export const queueDetector: Detector = siteDetector("queue-out", (s) => {
  const { client: c, method: m } = s;
  if (c.lib !== "queue" || (m !== "add" && m !== "addBulk")) return undefined;
  const t = c.name !== undefined ? { target: c.name, resolved: !!c.resolved } : { target: s.recv?.getText() ?? "?", resolved: false };
  return { kind: "queue-out", protocol: c.protocol ?? "bullmq", method: m, ...t, rule: `${c.protocol ?? "bullmq"}-queue-add` };
});
