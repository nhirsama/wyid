import { readFileSync } from "node:fs";
import { z } from "zod";

export class ConfigurationError extends Error {
  constructor(readonly fields: string[]) { super(`缺少或无效的服务端配置：${fields.join("、")}`); this.name = "ConfigurationError"; }
}

type ServerConfig = {
  appUrl: string;
  apiUrl: string;
  token: string;
  sessionSecret: string;
  organizationId?: string;
  externalDomain?: string;
  customRequestHeaders: Record<string, string>;
};

function isOrigin(value: string, allowInternalHttp = false) {
  try {
    const url = new URL(value);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return (url.protocol === "https:" || (url.protocol === "http:" && (local || allowInternalHttp))) &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

const origin = z.url().refine(value => isOrigin(value)).transform(value => new URL(value).origin);

function parseHost(value: string, variable: string) {
  if (!value || /[\s\\/?#@,%${}\u0000-\u001f\u007f]/.test(value)) throw new ConfigurationError([variable]);
  try {
    const parsed = new URL(`https://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("invalid host");
    return parsed.host;
  } catch {
    throw new ConfigurationError([variable]);
  }
}

function readExternalDomain(value?: string) {
  const domain = value?.trim();
  return domain ? parseHost(domain, "ZITADEL_EXTERNALDOMAIN") : undefined;
}

function readCustomRequestHeaders(value?: string): Record<string, string> {
  if (!value?.trim()) return {};

  const headers: Record<string, string> = {};
  const forbidden = new Set(["authorization", "connection", "content-length", "content-type", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
  for (const item of value.split(",")) {
    const separator = item.indexOf(":");
    if (separator <= 0) throw new ConfigurationError(["CUSTOM_REQUEST_HEADERS"]);
    const name = item.slice(0, separator).trim().toLowerCase();
    let headerValue = item.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || forbidden.has(name) || !headerValue || /[\u0000-\u001f\u007f]/.test(headerValue)) {
      throw new ConfigurationError(["CUSTOM_REQUEST_HEADERS"]);
    }
    if (name === "host") headerValue = parseHost(headerValue, "CUSTOM_REQUEST_HEADERS");
    headers[name] = headerValue;
  }
  return headers;
}

function readServiceToken() {
  const tokenFile = process.env.ZITADEL_SERVICE_USER_TOKEN_FILE?.trim();
  if (!tokenFile) return process.env.ZITADEL_SERVICE_TOKEN?.trim() || "";
  try {
    const token = readFileSync(tokenFile, "utf8").trim();
    if (!token) throw new Error("empty token file");
    return token;
  } catch {
    throw new ConfigurationError(["ZITADEL_SERVICE_USER_TOKEN_FILE"]);
  }
}

export function getConfig() {
  const externalDomain = readExternalDomain(process.env.ZITADEL_EXTERNALDOMAIN);
  const customRequestHeaders = readCustomRequestHeaders(process.env.CUSTOM_REQUEST_HEADERS);
  const publicHost = externalDomain || customRequestHeaders.host;
  const apiOrigin = z.url().refine(value => isOrigin(value, Boolean(publicHost))).transform(value => new URL(value).origin);
  const schema = z.object({
    appUrl: origin,
    apiUrl: apiOrigin,
    token: z.string().min(1),
    sessionSecret: z.string().min(32),
    organizationId: z.string().optional(),
  });
  const result = schema.safeParse({
    appUrl: process.env.APP_URL,
    apiUrl: process.env.ZITADEL_API_URL,
    token: readServiceToken(),
    sessionSecret: process.env.SESSION_SECRET,
    organizationId: process.env.ZITADEL_ORGANIZATION_ID || undefined,
  });
  if (!result.success) {
    const names: Record<string, string> = { appUrl: "APP_URL", apiUrl: "ZITADEL_API_URL", token: "ZITADEL_SERVICE_TOKEN or ZITADEL_SERVICE_USER_TOKEN_FILE", sessionSecret: "SESSION_SECRET", organizationId: "ZITADEL_ORGANIZATION_ID" };
    throw new ConfigurationError([...new Set(result.error.issues.map(issue => names[String(issue.path[0])] || "服务端配置"))]);
  }
  return { ...result.data, externalDomain, customRequestHeaders } satisfies ServerConfig;
}

export function zitadelRequestHeaders(config: Pick<ServerConfig, "apiUrl" | "externalDomain" | "customRequestHeaders">) {
  const apiUrl = new URL(config.apiUrl);
  const host = config.externalDomain || config.customRequestHeaders.host || apiUrl.host;
  const protocol = config.externalDomain || config.customRequestHeaders.host ? "https" : apiUrl.protocol.slice(0, -1);
  return {
    host,
    "x-forwarded-proto": protocol,
    "x-zitadel-instance-host": host,
    "x-zitadel-public-host": host,
    ...config.customRequestHeaders,
  };
}
