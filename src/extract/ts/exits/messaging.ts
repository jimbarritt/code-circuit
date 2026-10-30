import ts from "typescript";
import type { Detector } from "../types.ts";
import { type Hit, siteDetector, unwrap } from "./clients.ts";

const out = (protocol: string, method: string, t: { target: string; resolved: boolean }, rule: string): Hit => ({ kind: "message-out", protocol, method, ...t, rule });

export const messagingDetector: Detector = siteDetector("message-out", (s, r) => {
  const { client: c, method: m, args } = s;
  switch (c.lib) {
    case "nest-client":
      return m === "emit" || m === "send" ? out(c.protocol ?? "nest", m, r.val(args[0]), c.rule ?? "nest-client-proxy") : undefined;
    case "kafka-producer": {
      if (m === "send") return out("kafka", m, r.val(r.prop(args[0], "topic"), args[0]?.getText()), "kafkajs-producer");
      if (m !== "sendBatch") return undefined;
      const list = r.prop(args[0], "topicMessages");
      const items = list && ts.isArrayLiteralExpression(unwrap(list)) ? (unwrap(list) as ts.ArrayLiteralExpression).elements : undefined;
      if (!items?.length) return out("kafka", m, r.val(list, args[0]?.getText()), "kafkajs-producer");
      return items.map((el) => out("kafka", m, r.val(r.prop(el, "topic"), el.getText()), "kafkajs-producer"));
    }
    case "amqp-channel": {
      if (m === "sendToQueue") return out("amqplib", m, r.val(args[0]), "amqplib-publish");
      if (m !== "publish") return undefined;
      const ex = r.val(args[0]), key = r.val(args[1]);
      return out("amqplib", m, { target: `${ex.target}/${key.target}`, resolved: ex.resolved && key.resolved }, "amqplib-publish");
    }
    case "nats":
      return m === "publish" || m === "request" ? out("nats", m, r.val(args[0]), "nats-publish") : undefined;
    case "ioredis": case "redis":
      return m === "publish" ? out("redis", m, r.val(args[0]), "redis-publish") : undefined;
    case "nodemailer":
      return m === "sendMail" ? out("smtp", m, c.name !== undefined ? { target: c.name, resolved: !!c.resolved } : { target: "smtp", resolved: false }, "nodemailer-send") : undefined;
  }
  return undefined;
});
