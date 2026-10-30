import type { Detector } from "../types.ts";
import { type Hit, awsService, cap, siteDetector } from "./clients.ts";

const NOT_OPS = new Set(["send", "destroy", "config", "middlewareStack", "promise", "on", "makeRequest", "makeUnauthenticatedRequest", "waitFor", "()"]);
const OAUTH_OPS = new Set(["getToken", "verifyIdToken", "refreshAccessToken", "getTokenInfo", "revokeToken", "getAccessToken", "request"]);

export const cloudDetector: Detector = siteDetector("cloud", (s, r) => {
  const { client: c, method: m, args } = s;
  if (c.lib === "google-oauth") return OAUTH_OPS.has(m) ? { kind: "cloud", protocol: "google-oauth2", method: m, target: `OAuth2/${cap(m)}`, resolved: true, rule: "google-auth-library" } : undefined;
  let op: string | undefined, params, svc: { key: string; name: string } | undefined, rule: string;
  const known = c.name && c.protocol ? { key: c.protocol.replace(/^aws-/, ""), name: c.name } : undefined;
  if ((c.lib === "aws3" || c.lib === "aws3-any") && m === "send") {
    const cmd = r.commandOf(args[0]);
    svc = known ?? (cmd ? awsService(cmd.spec) : undefined);
    if (!svc) return undefined;
    op = cmd?.op;
    params = cmd?.params;
    rule = "aws-sdk-v3-command";
    if (!op) return { kind: "cloud", protocol: `aws-${svc.key}`, method: "send", target: `${svc.name}/${args[0]?.getText() ?? "?"}`, resolved: false, rule };
  } else if ((c.lib === "aws3-agg" || c.lib === "aws2") && known && !NOT_OPS.has(m)) {
    svc = known;
    op = cap(m);
    params = args[0];
    rule = c.lib === "aws2" ? "aws-sdk-v2" : "aws-sdk-v3-client";
  } else return undefined;
  const protocol = `aws-${svc.key}`;
  const hit = (kind: Hit["kind"], key: string): Hit => ({ kind, protocol, method: op!, ...r.val(r.prop(params, key)), rule });
  if (svc.key === "sqs" && op === "ReceiveMessage") return undefined;
  if (svc.key === "sqs" && (op === "SendMessage" || op === "SendMessageBatch")) return hit("queue-out", "QueueUrl");
  if (svc.key === "sns" && (op === "Publish" || op === "PublishBatch")) return hit("message-out", r.prop(params, "TopicArn") ? "TopicArn" : r.prop(params, "TargetArn") ? "TargetArn" : "TopicArn");
  if (svc.key === "kinesis" && (op === "PutRecord" || op === "PutRecords")) return hit("message-out", "StreamName");
  return { kind: "cloud", protocol, method: op, target: `${svc.name}/${op}`, resolved: true, rule };
});
