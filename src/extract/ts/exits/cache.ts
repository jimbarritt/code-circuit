import type { Detector } from "../types.ts";
import { siteDetector } from "./clients.ts";

/** Redis client methods that are not commands, or that other detectors own. */
const NOT_COMMANDS = new Set(["on", "once", "off", "emit", "addListener", "removeListener", "removeAllListeners", "setMaxListeners", "connect", "disconnect", "quit", "close", "duplicate", "ping", "pipeline", "multi", "exec", "subscribe", "psubscribe", "unsubscribe", "punsubscribe", "monitor", "defineCommand", "nodes", "publish", "sendCommand", "then", "catch", "status", "isOpen", "isReady"]);
const CACHE_MANAGER_OPS = new Set(["get", "set", "del", "mget", "mset", "mdel", "reset", "clear", "wrap", "ttl"]);
const KEYV_OPS = new Set(["get", "set", "delete", "clear", "has", "getMany", "setMany", "deleteMany"]);

export const cacheDetector: Detector = siteDetector("cache", (s, r) => {
  const { client: c, method: m, args } = s;
  const key = () => (args[0] ? r.val(args[0]) : { target: s.recv?.getText() ?? "?", resolved: false });
  if (c.lib === "ioredis" || c.lib === "redis") {
    if (m === "()" || NOT_COMMANDS.has(m)) return undefined;
    return { kind: "cache", protocol: c.lib, method: m, ...key(), rule: `${c.lib === "redis" ? "node-redis" : "ioredis"}-command` };
  }
  if (c.lib === "cache-manager" && CACHE_MANAGER_OPS.has(m)) return { kind: "cache", protocol: "cache-manager", method: m, ...key(), rule: "cache-manager" };
  if (c.lib === "keyv" && KEYV_OPS.has(m)) return { kind: "cache", protocol: "keyv", method: m, ...key(), rule: "keyv" };
  return undefined;
});
