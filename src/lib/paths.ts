/** Next.js uses an empty string for the site root. BASE_PATH accepts / as well. */
export function normalizeBasePath(value?: string) {
  const path = value?.trim() || "/";
  if (path === "/") return "";
  const normalized = path.replace(/\/+$/, "");
  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(normalized) ||
    normalized.split("/").some(segment => segment === "." || segment === "..")) {
    throw new Error("BASE_PATH 必须为 / 或以 / 开头的 URL 安全路径，不能包含空路径段、.、..、查询参数或片段。");
  }
  return normalized;
}

/**
 * Only for browser navigation, public assets and absolute URL construction.
 * Next.js Link and redirect() already add basePath: pass them app-relative paths.
 * External ZITADEL / identity-provider redirects must remain unchanged.
 */
export function withBasePath(path: string, basePath = process.env.NEXT_PUBLIC_BASE_PATH || "") {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `${basePath}${path}`;
}

export function siteUrl(path: string, origin: string) {
  return new URL(withBasePath(path), origin);
}
