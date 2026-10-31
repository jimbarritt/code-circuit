import { siteDetector } from "./clients.ts";

export const smtpDetector = siteDetector("smtp-out", (s) => {
  const { client: c, method: m } = s;
  if (c.lib !== "nodemailer" || m !== "sendMail") return undefined;
  const t = c.name !== undefined ? { target: c.name, resolved: !!c.resolved } : { target: "smtp", resolved: false };
  return { kind: "smtp-out", protocol: "smtp", method: m, ...t, rule: "nodemailer-send" };
});
