import { z } from "zod";

const origin = z.url().refine(value => {
  const url = new URL(value);
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
  return (url.protocol === "https:" || (local && url.protocol === "http:")) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
});
const schema = z.object({ appUrl: origin.transform(value => new URL(value).origin), apiUrl: origin, token: z.string().min(1), sessionSecret: z.string().min(32), organizationId: z.string().optional() });

export class ConfigurationError extends Error {
  constructor(readonly fields: string[]) { super(`缺少或无效的服务端配置：${fields.join("、")}`); this.name = "ConfigurationError"; }
}
export function getConfig() {
  const result = schema.safeParse({ appUrl: process.env.APP_URL, apiUrl: process.env.ZITADEL_API_URL, token: process.env.ZITADEL_SERVICE_TOKEN, sessionSecret: process.env.SESSION_SECRET, organizationId: process.env.ZITADEL_ORGANIZATION_ID || undefined });
  if (!result.success) {
    const names: Record<string, string> = { appUrl: "APP_URL", apiUrl: "ZITADEL_API_URL", token: "ZITADEL_SERVICE_TOKEN", sessionSecret: "SESSION_SECRET", organizationId: "ZITADEL_ORGANIZATION_ID" };
    throw new ConfigurationError([...new Set(result.error.issues.map(issue => names[String(issue.path[0])] || "服务端配置"))]);
  }
  return result.data;
}
