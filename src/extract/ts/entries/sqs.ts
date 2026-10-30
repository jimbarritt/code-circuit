import ts from "typescript";
import type { Detector, Finding } from "../types.ts";
import { calleeName, fileImports, finding, fold, handlerOwner, importedFrom, prop, unwrap, walk } from "./util.ts";

const V3 = "@aws-sdk/client-sqs";
const SDK = (s: string) => s === V3 || s === "aws-sdk" || s === "aws-sdk/clients/sqs";

/** SQS pollers: ReceiveMessageCommand, v2 receiveMessage, and sqs-consumer Consumer.create. */
export const sqs: Detector = {
  name: "sqs",
  detect(ctx) {
    const out: Finding[] = [];
    const base = { kind: "queue" as const, protocol: "sqs", method: "QUEUE" };
    for (const f of ctx.project.files) {
      const sdk = fileImports(f.sf, SDK);
      const consumer = fileImports(f.sf, "sqs-consumer");
      if (!sdk && !consumer) continue;
      walk(f.sf, (n) => {
        if (!ts.isNewExpression(n) && !ts.isCallExpression(n)) return;
        const name = calleeName(n);
        const arg = n.arguments?.[0] && unwrap(n.arguments[0]);
        const obj = arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;
        if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && name === "ReceiveMessageCommand" && importedFrom(f.sf, name, V3)) {
          const url = obj && prop(obj, "QueueUrl");
          out.push(finding(ctx, f, n, { ...base, rule: "sqs-receive-command" }, url ? fold(ctx, url, f.rel, f.sf) : { value: arg?.getText(f.sf) ?? "", resolved: false }));
        } else if (sdk && ts.isCallExpression(n) && name === "receiveMessage" && ts.isPropertyAccessExpression(n.expression) && obj) {
          const url = prop(obj, "QueueUrl");
          if (url) out.push(finding(ctx, f, n, { ...base, rule: "sqs-receive-message" }, fold(ctx, url, f.rel, f.sf)));
        } else if (consumer && ts.isCallExpression(n) && name === "create" && ts.isPropertyAccessExpression(n.expression) && importedFrom(f.sf, n.expression.expression.getText(f.sf), "sqs-consumer") && obj) {
          const url = prop(obj, "queueUrl");
          if (url) out.push(finding(ctx, f, n, { ...base, rule: "sqs-consumer" }, fold(ctx, url, f.rel, f.sf), handlerOwner(ctx, f, prop(obj, "handleMessage") ?? prop(obj, "handleMessageBatch"), n)));
        }
      });
    }
    return out;
  },
};
